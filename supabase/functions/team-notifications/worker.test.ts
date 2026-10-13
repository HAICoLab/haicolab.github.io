import assert from 'node:assert/strict';
import { createHandler, emailFor } from './worker.ts';
const secret='test-secret-for-notifications-32-characters';
const config: Record<string,string>={TEAM_NOTIFICATION_SECRET:secret,SUPABASE_URL:'https://database.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-service-key',RESEND_API_KEY:'test-resend-key',TEAM_MAIL_FROM:'ENG3510 <class@example.invalid>'};
const job={id:'00000000-0000-0000-0000-000000000001',lease_token:'lease-one',recipient_email:'student@example.edu',event:'application_received',idea_id:'idea-1',idea_title:'<img src=x onerror=bad()> & "제목"',actor_label:'학생 02'};
const request=(token=secret)=>new Request('https://worker.example.invalid',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({to:'attacker@example.invalid',text:'untrusted'})});
function setup(provider: (init: RequestInit)=>Response|Promise<Response>, overrides: Record<string,string>={},failAck=false){
 const calls: {url:string,body:Record<string,unknown>,headers:Headers}[]=[];
 const fetchMock: typeof fetch=async(input,init={})=>{
  const url=String(input),body=JSON.parse(String(init.body));calls.push({url,body,headers:new Headers(init.headers)});
  if(url.endsWith('/tb_claim_notifications'))return Response.json([job]);
  if(url==='https://api.resend.com/emails')return provider(init);
  if(url.endsWith('/tb_finish_notification'))return failAck?new Response('',{status:503}):Response.json(true);
  throw Error('Unexpected endpoint');
 };
 return {calls,handler:createHandler({env:name=>({...config,...overrides})[name],fetch:fetchMock,pause:()=>Promise.resolve()})};
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
 assert.throws(()=>emailFor({...job,event:'made-up'},config.TEAM_MAIL_FROM));
});
