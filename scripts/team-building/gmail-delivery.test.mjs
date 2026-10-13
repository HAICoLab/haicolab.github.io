import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './database.test.mjs';
const base=await readFile(new URL('./migrations/20261013_eng3510_notifications_and_offer_window.sql',import.meta.url),'utf8');
const migration=await readFile(new URL('./migrations/20261013_eng3510_gmail_delivery.sql',import.meta.url),'utf8');
const f=await fixture('eng3510');const {db,users:[leader,applicant],post,act}=f;
let count=0;const test=async(name,fn)=>{await fn();console.log(`PASS ${++count}: ${name}`);};
async function worker(fn,args=[]){await db.exec('set role service_role');try{return (await db.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;}finally{await db.exec('reset role');}}
const row=async id=>(await db.query('select * from team_private.notification_outbox where id=$1',[id])).rows[0];
try{
 await db.exec(base);await db.exec('update team_private.settings set email_notifications_enabled=true');
 const idea=(await post(leader)).id;
 await act(applicant,'comment',{idea_id:idea,body:'기존 대기열을 보존해야 합니다.'});
 const before=(await db.query('select * from team_private.notification_outbox')).rows;
 await db.exec(migration);
 await test('Gmail upgrade preserves existing jobs and configured settings',async()=>{
  const after=(await db.query('select * from team_private.notification_outbox')).rows.map(({smtp_started_at,...rest})=>rest);
  assert.deepEqual(after,before);assert.equal((await f.read(f.admin)).settings.email_notifications_enabled,true);
 });
 const first=(await worker('tb_claim_notifications',[1]))[0];
 await test('SMTP dispatch requires current lease and can start only once',async()=>{
  assert.equal(await worker('tb_begin_notification_delivery',[first.id,crypto.randomUUID()]),false);
  assert.equal(await worker('tb_begin_notification_delivery',[first.id,first.lease_token]),true);
  assert.equal(await worker('tb_begin_notification_delivery',[first.id,first.lease_token]),false);
 });
 await test('crash after SMTP starts is held for review rather than sending the same mail again',async()=>{
  await db.query("update team_private.notification_outbox set lease_until=now()-interval '1 second' where id=$1",[first.id]);
  assert.deepEqual(await worker('tb_claim_notifications',[5]),[]);
  assert.equal((await row(first.id)).state,'failed');assert.equal((await row(first.id)).last_error,'smtp_delivery_unconfirmed');
  assert.equal(await worker('tb_finish_notification',[first.id,first.lease_token,'late',null,false]),false);
 });
 await test('definite temporary SMTP rejection releases the marker for a new safe attempt',async()=>{
  await act(applicant,'comment',{idea_id:idea,body:'일시적 거절 재시도 시험입니다.'});
  const j=(await worker('tb_claim_notifications',[1]))[0];
  assert.equal(await worker('tb_begin_notification_delivery',[j.id,j.lease_token]),true);
  await worker('tb_finish_notification',[j.id,j.lease_token,null,'smtp_421',true]);
  assert.equal((await row(j.id)).smtp_started_at,null);assert.equal((await row(j.id)).state,'pending');
  await db.query("update team_private.notification_outbox set available_at=now()-interval '1 second' where id=$1",[j.id]);
  const next=(await worker('tb_claim_notifications',[1]))[0];assert.equal(next.id,j.id);assert.notEqual(next.lease_token,j.lease_token);
  assert.equal(await worker('tb_begin_notification_delivery',[j.id,j.lease_token]),false);
  assert.equal(await worker('tb_begin_notification_delivery',[j.id,next.lease_token]),true);
  assert.equal(await worker('tb_finish_notification',[j.id,next.lease_token,'gmail-message-id',null,false]),true);
  assert.equal((await row(j.id)).state,'sent');
 });
 await test('student and anonymous callers cannot mark or manipulate delivery',async()=>{
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);try{await assert.rejects(db.query('select public.tb_begin_notification_delivery($1,$2)',[first.id,first.lease_token]),/permission denied/);}finally{await db.exec('reset role');}
  }
 });
 await test('migration reruns and fresh installs keep the same delivery protection',async()=>{
  await db.exec(migration);assert.equal((await row(first.id)).last_error,'smtp_delivery_unconfirmed');
  const setup=await readFile(new URL('../../courses/eng3510/2026-fall/team-building/setup.sql',import.meta.url),'utf8');assert(setup.includes(migration));
  const fresh=await fixture('eng3510',{notifications:true});try{await fresh.db.query('select smtp_started_at from team_private.notification_outbox');}finally{await fresh.db.close();}
 });
 console.log(`${count} Gmail delivery database scenarios passed.`);
}finally{await db.close();}
