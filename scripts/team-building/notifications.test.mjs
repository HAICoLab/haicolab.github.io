import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture as baseFixture} from './database.test.mjs';
import {fixture as sharedFixture} from './eng2112.test.mjs';
const migration=await readFile(new URL('./migrations/20261013_eng3510_notifications_and_offer_window.sql',import.meta.url),'utf8');
const shared=await sharedFixture();
const f=shared.old;const {db,users:[leader,applicant,outsider,other],admin,post,read,act}=f;
let count=0;
const test=async(name,fn)=>{await fn();console.log(`PASS ${++count}: ${name}`);};
const jobs=async()=>(await db.query('select * from team_private.notification_outbox order by created_at,id')).rows;
async function worker(fn,args=[]){await db.exec('set role service_role');try{return (await db.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;}finally{await db.exec('reset role');}}
try{
 const idea=(await post(leader)).id;
 await act(applicant,'apply',{idea_id:idea,message:'기존 지원서는 그대로 보존되어야 합니다.'});
 const original=await read(admin),sibling=await shared.read(shared.admin);
 await db.exec(migration);
 await test('additive upgrade preserves real existing rows, shared course and does not queue old activity',async()=>{
  const now=await read(admin);
  for(const key of ['ideas','applications','members','comments','profiles','invites','roster'])assert.deepEqual(now[key],original[key]);
  assert.deepEqual(await shared.read(shared.admin),sibling);
  assert.equal(new Date(now.settings.offers_open_at).toISOString(),'2026-10-14T00:00:00.000Z');
  assert.equal(now.settings.email_notifications_enabled,false);assert.equal((await jobs()).length,0);
 });
 await db.exec("update team_private.settings set offers_open_at=now()+interval '1 day',email_notifications_enabled=true");
 const application=(await read(leader)).applications[0].id;
 await test('before opening, application and questions/replies work while offer RPC is blocked atomically',async()=>{
  await act(other,'apply',{idea_id:idea,message:'데이터 전처리와 시각화에 기여하고 싶습니다.'});
  await act(applicant,'comment',{idea_id:idea,body:'공개 질문입니다.'});
  await act(leader,'comment',{idea_id:idea,body:'팀장이 자기 글에 남긴 댓글입니다.'});
  await act(leader,'application',{id:application,decision:'reply',reply:'회의 가능한 시간을 알려 주세요.'});
  const before=await jobs();
  await assert.rejects(act(leader,'application',{id:application,decision:'offer',reply:'함께해요.'}),/한국 시간/);
  assert.deepEqual(await jobs(),before);
  assert.equal((await read(leader)).offers_open,false);
  const byEvent=Object.fromEntries(before.map(j=>[j.event,j]));
  assert.equal(byEvent.application_received.recipient_id,leader);
  assert.equal(byEvent.project_comment.recipient_id,leader);
  assert.equal(byEvent.application_reply.recipient_id,applicant);
  assert.equal(before.length,3);assert.equal(before.some(j=>'message' in j||'reply' in j),false);
 });
 await test('an already outstanding offer cannot be accepted early',async()=>{
  await db.exec("update team_private.settings set email_notifications_enabled=false");
  await db.query("update team_private.applications set status='offered' where id=$1",[application]);
  await assert.rejects(act(applicant,'application',{id:application,decision:'accept'}),/한국 시간/);
  assert.equal((await read(leader)).members.filter(m=>m.idea_id===idea).length,1);
  await db.query("update team_private.applications set status='pending' where id=$1",[application]);
  await db.exec("update team_private.settings set email_notifications_enabled=true");
 });
 await test('at/past opening, offer and acceptance work; offer with reply queues only one applicant mail',async()=>{
  await db.exec('update team_private.settings set offers_open_at=clock_timestamp()');
  assert.equal((await read(leader)).offers_open,true);
  const before=(await jobs()).length;
  await act(leader,'application',{id:application,decision:'offer',reply:'합류를 제안합니다.'});
  assert.equal((await jobs()).length,before+1);
  assert.equal((await jobs()).find(j=>j.event==='application_offer').recipient_id,applicant);
  assert.equal((await read(leader)).members.filter(m=>m.idea_id===idea).length,1);
  await act(applicant,'application',{id:application,decision:'accept'});
  assert.equal((await read(leader)).members.filter(m=>m.idea_id===idea).length,2);
  assert.equal((await jobs()).find(j=>j.event==='application_accepted').recipient_id,leader);
 });
 await test('duplicate same-text reply is not a new event; declined result reaches its applicant',async()=>{
  const id=(await read(leader)).applications.find(a=>a.applicant_id===other).id;
  await act(leader,'application',{id,decision:'reply',reply:'질문드립니다.'});const before=(await jobs()).length;
  await act(leader,'application',{id,decision:'reply',reply:'질문드립니다.'});assert.equal((await jobs()).length,before);
  await act(leader,'application',{id,decision:'reject',reply:'이번에는 함께하기 어렵습니다.'});
  assert.equal((await jobs()).find(j=>j.event==='application_declined').recipient_id,other);
 });
 await test('mail addresses and queues are inaccessible to students, including RPCs',async()=>{
  const s=await read(outsider);assert.equal(s.applications.length,0);
  assert(!JSON.stringify(s).includes('@example.edu'));
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);try{
    await assert.rejects(db.query('select * from team_private.notification_outbox'),/permission denied/);
    await assert.rejects(db.query('select public.tb_claim_notifications(10)'),/permission denied/);
    await assert.rejects(db.query("select public.tb_finish_notification(gen_random_uuid(),gen_random_uuid(),'fake',null,true)"),/permission denied/);
   }finally{await db.exec('reset role');}
  }
 });
 await test('worker claims server-chosen recipient and concurrent claims cannot return same job',async()=>{
  const first=await worker('tb_claim_notifications',[2]),second=await worker('tb_claim_notifications',[2]);
  assert.equal(first.length,2);assert.equal(second.length,2);
  assert(!first.some(j=>second.some(k=>k.id===j.id)));
  assert(first.every(j=>j.recipient_email.endsWith('@example.edu')));
  const j=first[0];
  assert.equal(await worker('tb_finish_notification',[j.id,crypto.randomUUID(),'wrong',null,true]),false);
  assert.equal(await worker('tb_finish_notification',[j.id,j.lease_token,'provider-one',null,true]),true);
  assert.equal(await worker('tb_finish_notification',[j.id,j.lease_token,'provider-one',null,true]),false);
  const retry=first[1];await worker('tb_finish_notification',[retry.id,retry.lease_token,null,'provider_http_429',true]);
  let row=(await jobs()).find(q=>q.id===retry.id);assert.equal(row.state,'pending');assert(new Date(row.available_at)>new Date());
  await db.query("update team_private.notification_outbox set available_at=now()-interval '1 second' where id=$1",[retry.id]);
  const again=(await worker('tb_claim_notifications',[10])).find(q=>q.id===retry.id);
  assert(again);assert.notEqual(again.lease_token,retry.lease_token);
  assert.equal(await worker('tb_finish_notification',[retry.id,retry.lease_token,'stale',null,true]),false);
  await worker('tb_finish_notification',[again.id,again.lease_token,'provider-two',null,true]);
 });
 await test('expired lease reclaims same event ID and stale work is bounded below provider idempotency TTL',async()=>{
  const sending=(await jobs()).find(j=>j.state==='sending');
  await db.query("update team_private.notification_outbox set lease_until=now()-interval '1 minute' where id=$1",[sending.id]);
  const reclaimed=(await worker('tb_claim_notifications',[10])).find(j=>j.id===sending.id);assert(reclaimed);
  assert.notEqual(reclaimed.lease_token,sending.lease_token);
  await db.query("update team_private.notification_outbox set created_at=now()-interval '24 hours' where id=$1",[sending.id]);
  assert(!(await worker('tb_claim_notifications',[10])).some(j=>j.id===sending.id));
  assert.equal((await jobs()).find(j=>j.id===sending.id).state,'failed');
 });
 await test('disabled notifications skip new events and claims; migration rerun preserves configured settings',async()=>{
  await db.exec('update team_private.settings set email_notifications_enabled=false');const before=(await jobs()).length;
  await act(outsider,'comment',{idea_id:idea,body:'알림 중지 상태의 댓글입니다.'});
  assert.equal((await jobs()).length,before);assert.deepEqual(await worker('tb_claim_notifications',[10]),[]);
  const settings=(await read(admin)).settings;await db.exec(migration);assert.deepEqual((await read(admin)).settings,settings);
  assert.deepEqual(await shared.read(shared.admin),sibling);
 });
 await test('fresh setup embeds the same migration with the approved KST time',async()=>{
  const setup=await readFile(new URL('../../courses/eng3510/2026-fall/team-building/setup.sql',import.meta.url),'utf8');assert(setup.includes(migration));
  const fresh=await baseFixture('eng3510',{notifications:true});try{assert.equal(new Date((await fresh.read(fresh.admin)).settings.offers_open_at).toISOString(),'2026-10-14T00:00:00.000Z');}finally{await fresh.db.close();}
 });
 console.log(`${count} notification and opening-window database scenarios passed.`);
}finally{await db.close();}
