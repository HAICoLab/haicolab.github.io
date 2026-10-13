import assert from 'node:assert/strict';
import { createHandler, emailFor } from './worker.ts';
import { smtpFailure } from './gmail.ts';
const secret='test-secret-for-notifications-32-characters';
const config: Record<string,string>={TEAM_NOTIFICATION_SECRET:secret,SUPABASE_URL:'https://database.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-service-key',RESEND_API_KEY:'test-resend-key',TEAM_MAIL_FROM:'ENG3510 <class@example.invalid>'};
const job={id:'00000000-0000-0000-0000-000000000001',lease_token:'lease-one',recipient_email:'student@example.edu',event:'application_received',idea_id:'idea-1',idea_title:'<img src=x onerror=bad()> & "제목"',actor_label:'학생 02'};
const request=(token=secret)=>new Request('https://worker.example.invalid',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({to:'attacker@example.invalid',text:'untrusted'})});
function setup(provider: (init: RequestInit)=>Response|Promise<Response>, overrides: Record<string,string>={},failAck=false,gmailSend?: Parameters<typeof createHandler>[0]['gmailSend']){
 const calls: {url:string,body:Record<string,unknown>,headers:Headers}[]=[];
 const fetchMock: typeof fetch=async(input,init={})=>{
  const url=String(input),body=JSON.parse(String(init.body));calls.push({url,body,headers:new Headers(init.headers)});
  if(url.endsWith('/tb_queue_due_application_reminders'))return Response.json(0);
  if(url.endsWith('/tb_claim_notifications'))return Response.json([job]);
  if(url.endsWith('/tb_begin_notification_delivery'))return Response.json(true);
  if(url==='https://api.resend.com/emails')return provider(init);
  if(url.endsWith('/tb_finish_notification'))return failAck?new Response('',{status:503}):Response.json(true);
  throw Error('Unexpected endpoint');
 };
 return {calls,handler:createHandler({env:name=>({...config,...overrides})[name],fetch:fetchMock,pause:()=>Promise.resolve(),gmailSend})};
}
Deno.test('unauthorized and unconfigured calls do not read recipients or send mail',async()=>{
 const x=setup(()=>Response.json({id:'mail'}));assert.equal((await x.handler(request('student-jwt'))).status,401);assert.equal(x.calls.length,0);
 const y=setup(()=>Response.json({id:'mail'}),{RESEND_API_KEY:''});assert.equal((await y.handler(request())).status,503);assert.equal(y.calls.length,0);
 assert.equal((await x.handler(new Request('https://worker.example.invalid'))).status,405);
});
Deno.test('server-selected recipient, escaped HTML, no private body, fixed destination and stable deduplication key',async()=>{
 const x=setup(()=>Response.json({id:'mail-one'}));const res=await x.handler(request());assert.equal(res.status,200);assert.deepEqual(await res.json(),{processed:1,sent:1,deferred:0});
 const send=x.calls.find(c=>c.url==='https://api.resend.com/emails')!;
 assert.deepEqual(send.body.to,['student@example.edu']);assert(!String(send.body.html).includes('<img'));
 assert(String(send.body.html).includes('&lt;img'));assert(!JSON.stringify(send.body).includes('attacker'));
 assert(String(send.body.text).includes('#activity'));assert.equal(send.headers.get('Idempotency-Key'),'eng3510-notification/'+job.id);
 const ack=x.calls.at(-1)!;assert.equal(ack.body.token,'lease-one');assert.equal(ack.body.provider_id,'mail-one');
});
Deno.test('temporary provider failures are retried; configuration failures are terminal',async()=>{
 for(const [status,retryable] of [[429,true],[503,true],[403,false],[422,false]] as const){
  const x=setup(()=>new Response('provider details that must not leak',{status}));const response=await x.handler(request());
  assert.equal(response.status,200);assert(!JSON.stringify(await response.json()).includes('provider details'));
  assert.equal(x.calls.at(-1)!.body.retryable,retryable);assert.equal(x.calls.at(-1)!.body.error_code,'provider_http_'+status);
 }
});
Deno.test('network ambiguity retries the same event ID without exposing provider errors',async()=>{
 const x=setup(()=>{throw new Error('sensitive provider contents');});const r=await x.handler(request());
 assert.equal(r.status,200);assert.equal(x.calls.at(-1)!.body.error_code,'provider_network_error');assert.equal(x.calls.at(-1)!.body.retryable,true);
});
Deno.test('acknowledgement failure does not produce a second send or cancel the lease',async()=>{
 const x=setup(()=>Response.json({id:'delivered-once'}),{},true);assert.equal((await x.handler(request())).status,503);
 assert.equal(x.calls.filter(c=>c.url==='https://api.resend.com/emails').length,1);
 assert.equal(x.calls.filter(c=>c.url.endsWith('/tb_finish_notification')).length,1);
});
Deno.test('comment links open their idea; invalid recipients and event names cannot send',()=>{
 assert(emailFor({...job,event:'project_comment'},config.TEAM_MAIL_FROM).text.includes('#idea/idea-1'));
 assert.throws(()=>emailFor({...job,recipient_email:null},config.TEAM_MAIL_FROM));
 assert.throws(()=>emailFor({...job,recipient_email:'one,two@example.edu'},config.TEAM_MAIL_FROM));
 assert.throws(()=>emailFor({...job,recipient_email:'Someone <one@example.edu>'},config.TEAM_MAIL_FROM));
 assert.throws(()=>emailFor({...job,event:'made-up'},config.TEAM_MAIL_FROM));
});
const gmailConfig={TEAM_MAIL_PROVIDER:'gmail',GMAIL_USER:'professor@gmail.com',GMAIL_APP_PASSWORD:'abcd efgh ijkl mnop',RESEND_API_KEY:''};
Deno.test('Gmail persists dispatch before sending and uses only the configured account and queued recipient',async()=>{
 const x=setup(()=>{throw Error('Resend must not be used');},gmailConfig,false,async(mail,id,user,password)=>{
  assert(x.calls.at(-1)!.url.endsWith('/tb_begin_notification_delivery'));
  assert.deepEqual(x.calls.at(-1)!.body,{job_id:job.id,token:job.lease_token});
  assert.equal(id,job.id);assert.equal(user,'professor@gmail.com');assert.equal(password,'abcdefghijklmnop');
  assert.deepEqual(mail.to,['student@example.edu']);assert.equal(mail.from,'ENG3510 팀빌딩 <professor@gmail.com>');
  return {providerID:'smtp-message',errorCode:null,retryable:false};
 });
 assert.deepEqual(await (await x.handler(request())).json(),{processed:1,sent:1,deferred:0});
 assert.equal(x.calls.at(-1)!.body.provider_id,'smtp-message');
});
Deno.test('Gmail requires separate server credentials and never falls back to another provider',async()=>{
 for(const overrides of [{GMAIL_APP_PASSWORD:''},{GMAIL_USER:'bad\r\nBcc: someone@gmail.com'},{TEAM_MAIL_PROVIDER:'unknown'}]){
  const x=setup(()=>{throw Error('no sends');},{...gmailConfig,...overrides},false,async()=>{throw Error('no sends');});
  assert.equal((await x.handler(request())).status,503);assert.equal(x.calls.length,0);
 }
});
Deno.test('SMTP explicit temporary rejections retry but ambiguous DATA/socket failures require review',()=>{
 assert.equal(smtpFailure({responseCode:421}).retryable,true);
 assert.equal(smtpFailure({responseCode:550}).retryable,false);
 assert.equal(smtpFailure({code:'EDNS'}).retryable,true);
 assert.equal(smtpFailure({code:'ETIMEDOUT',timeoutType:'CONNECT_TIMEOUT'}).retryable,true);
 for(const e of [{code:'ESOCKET',command:'CONN'},{code:'ETIMEDOUT',command:'DATA'},{message:'sensitive data'}]){
  assert.deepEqual(smtpFailure(e),{providerID:null,errorCode:'smtp_delivery_unconfirmed',retryable:false});
 }
});
Deno.test('Gmail unexpected failure is terminal; failed DB acknowledgement cannot trigger another SMTP send',async()=>{
 const x=setup(()=>Response.json({}),gmailConfig,false,async()=>{throw Error('sensitive details');});
 assert.equal((await x.handler(request())).status,200);
 assert.equal(x.calls.at(-1)!.body.error_code,'smtp_delivery_unconfirmed');assert.equal(x.calls.at(-1)!.body.retryable,false);
 let sends=0;
 const y=setup(()=>Response.json({}),gmailConfig,true,async()=>{sends++;return {providerID:'delivered',errorCode:null,retryable:false};});
 assert.equal((await y.handler(request())).status,503);assert.equal(sends,1);
});
Deno.test('Gmail self-test is authenticated, fixed to its own account, and reads no student data',async()=>{
 let sends=0;
 const x=setup(()=>{throw Error('No API calls');},gmailConfig,false,async(mail)=>{
  sends++;assert.deepEqual(mail.to,['professor@gmail.com']);assert(mail.subject.includes('연결 확인'));
  return {providerID:'test-mail',errorCode:null,retryable:false};
 });
 const req=(token:string)=>new Request('https://worker.example.invalid?self_test=1',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({to:'attacker@example.invalid'})});
 assert.equal((await x.handler(req('bad'))).status,401);assert.equal(sends,0);
 assert.equal((await x.handler(req(secret))).status,200);assert.equal(sends,1);assert.equal(x.calls.length,0);
});
Deno.test('a lost or stale SMTP dispatch lease never calls the provider',async()=>{
 const handler=createHandler({env:name=>({...config,...gmailConfig})[name],fetch:async(input)=>{
  if(String(input).endsWith('/tb_queue_due_application_reminders'))return Response.json(0);
  if(String(input).endsWith('/tb_claim_notifications'))return Response.json([job]);
  if(String(input).endsWith('/tb_begin_notification_delivery'))return Response.json(false);
  throw Error('Unexpected call');
 },gmailSend:async()=>{throw Error('Must not send');}});
 assert.deepEqual(await (await handler(request())).json(),{processed:1,sent:0,deferred:1});
});
Deno.test('reminders direct the correct party to their private activity without exposing application text',()=>{
 const leader=emailFor({...job,event:'application_review_reminder'},config.TEAM_MAIL_FROM);
 const applicant=emailFor({...job,event:'application_offer_reminder'},config.TEAM_MAIL_FROM);
 assert(leader.subject.includes('2시간'));assert(leader.text.includes('합류를 제안하거나 지원을 거절'));
 assert(applicant.text.includes('제안을 수락하거나 지원을 취소'));assert(applicant.text.includes('#activity'));
});
