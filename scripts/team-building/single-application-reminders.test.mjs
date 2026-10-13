import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture as baseFixture} from './database.test.mjs';
import {fixture as sharedFixture} from './eng2112.test.mjs';
const migrations=await Promise.all(['notifications_and_offer_window','gmail_delivery','single_application_reminders'].map(name=>readFile(new URL(`./migrations/20261013_eng3510_${name}.sql`,import.meta.url),'utf8')));
const shared=await sharedFixture(),f=shared.old;
const {db,users:[leader,applicant,otherLeader,otherApplicant],admin,post,read,act}=f;
let count=0;const test=async(name,fn)=>{await fn();console.log(`PASS ${++count}: ${name}`);};
async function worker(name,args=[]){await db.exec('set role service_role');try{return (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;}finally{await db.exec('reset role');}}
const queue=()=>worker('tb_queue_due_application_reminders');
const app=async()=>(await db.query('select * from team_private.applications where applicant_id=$1 and idea_id=$2',[applicant,ideaA])).rows[0];
const reminders=async()=>(await db.query("select * from team_private.notification_outbox where event in ('application_review_reminder','application_offer_reminder') order by created_at")).rows;
const age=async(id,interval)=>db.query('update team_private.applications set response_started_at=clock_timestamp()-$2::interval where id=$1',[id,interval]);
let ideaA,ideaB,application;
try{
 for(const migration of migrations.slice(0,2))await db.exec(migration);
 ideaA=(await post(leader)).id;ideaB=(await post(otherLeader)).id;
 await act(applicant,'apply',{idea_id:ideaA,message:'분석과 자료 정리에 참여하고 싶습니다.'});
 const old=await read(admin),sibling=await shared.read(shared.admin);
 await db.exec(migrations[2]);application=(await app()).id;
 await test('upgrade preserves applications, memberships and sibling course; starts existing response clocks now',async()=>{
  const latest=await read(admin);
  for(const key of ['ideas','members','comments','profiles','invites','roster'])assert.deepEqual(latest[key],old[key]);
  assert.deepEqual(latest.applications.map(({response_started_at,...rest})=>rest),old.applications);
  assert.equal(latest.offers_open,true);assert(!JSON.stringify(latest).includes('response_cycle'));
  assert(new Date((await app()).response_started_at)>new Date(Date.now()-10000));
  assert.deepEqual(await shared.read(shared.admin),sibling);
 });
 await test('a pending application blocks another team and same-team edits do not reset its clock',async()=>{
  const before=await app();
  await assert.rejects(act(applicant,'apply',{idea_id:ideaB,message:'다른 팀에도 동시에 지원합니다.'}),/한 번에 한 팀/);
  await act(applicant,'apply',{idea_id:ideaA,message:'같은 팀의 지원 내용만 수정합니다.'});
  assert.equal((await app()).response_cycle,before.response_cycle);assert.deepEqual((await app()).response_started_at,before.response_started_at);
 });
 await test('offer is immediate even when the legacy date is years away; offered applications remain exclusive',async()=>{
  await db.exec("update team_private.settings set offers_open_at=now()+interval '10 years',email_notifications_enabled=true");
  assert.equal((await read(applicant)).offers_open,true);
  await act(leader,'application',{id:application,decision:'offer',reply:'함께해요.'});
  await assert.rejects(act(applicant,'apply',{idea_id:ideaB,message:'제안을 받은 중 다른 팀 지원입니다.'}),/한 번에 한 팀/);
  await assert.rejects(act(applicant,'apply',{idea_id:ideaA,message:'제안을 덮어쓰려는 지원입니다.'}),/합류 제안이 도착/);
 });
 await test('withdrawal and rejection release the application lock, without automatic expiry',async()=>{
  await act(applicant,'application',{id:application,decision:'withdraw'});
  await act(applicant,'apply',{idea_id:ideaB,message:'지원 취소 후 다른 팀 지원입니다.'});
  const b=(await read(applicant)).applications.find(x=>x.idea_id===ideaB);
  await age(b.id,'1 day');
  await assert.rejects(act(applicant,'apply',{idea_id:ideaA,message:'시간 경과만으로 잠금은 풀리지 않습니다.'}),/한 번에 한 팀/);
  await act(otherLeader,'application',{id:b.id,decision:'reject'});
  await act(applicant,'apply',{idea_id:ideaA,message:'거절 후 이 팀에 다시 지원합니다.'});
  assert.equal((await app()).status,'pending');
 });
 await test('review reminder starts at two hours, selects the leader, and is queued only once',async()=>{
  assert.equal(await queue(),0);
  await age(application,'119 minutes');assert.equal(await queue(),0);
  await age(application,'2 hours');assert.equal(await queue(),1);assert.equal(await queue(),0);
  const r=(await reminders())[0];assert.equal(r.event,'application_review_reminder');assert.equal(r.recipient_id,leader);
  const before=await app();
  await act(leader,'application',{id:application,decision:'reply',reply:'자료를 살펴보고 있습니다.'});
  assert.equal((await app()).response_cycle,before.response_cycle);assert.deepEqual((await app()).response_started_at,before.response_started_at);
  assert.equal(await queue(),0);assert.equal((await reminders()).length,1);
 });
 await test('offering invalidates the old review reminder and starts a separate student response clock',async()=>{
  const before=await app();await act(leader,'application',{id:application,decision:'offer'});
  const after=await app();assert.notEqual(after.response_cycle,before.response_cycle);assert(new Date(after.response_started_at)>new Date(before.response_started_at));
  assert.equal(await queue(),0);
  const jobs=await worker('tb_claim_notifications',[10]);assert(!jobs.some(x=>x.event==='application_review_reminder'));
  assert.equal((await reminders())[0].last_error,'reminder_obsolete');
  await age(application,'119 minutes');assert.equal(await queue(),0);
  await age(application,'2 hours');assert.equal(await queue(),1);assert.equal(await queue(),0);
  const r=(await reminders()).find(x=>x.event==='application_offer_reminder');assert.equal(r.recipient_id,applicant);
  // Sending the same offer or another reply must not postpone or duplicate it.
  await act(leader,'application',{id:application,decision:'offer',reply:'제안은 그대로입니다.'});
  assert.equal((await app()).response_cycle,after.response_cycle);assert.equal(await queue(),0);
 });
 await test('withdrawal after a reminder was claimed prevents SMTP dispatch',async()=>{
  const j=(await worker('tb_claim_notifications',[10])).find(x=>x.event==='application_offer_reminder');assert(j);
  await act(applicant,'application',{id:application,decision:'withdraw'});
  assert.equal(await worker('tb_begin_notification_delivery',[j.id,j.lease_token]),false);
  await worker('tb_claim_notifications',[10]);assert.equal((await reminders()).find(x=>x.id===j.id).last_error,'reminder_obsolete');
 });
 await test('a new application cycle may get one new reminder, without reviving the earlier one',async()=>{
  await act(applicant,'apply',{idea_id:ideaA,message:'새로운 지원 주기에서 다시 지원합니다.'});
  await age(application,'2 hours');assert.equal(await queue(),1);assert.equal(await queue(),0);
  const reviews=(await reminders()).filter(x=>x.event==='application_review_reminder');assert.equal(reviews.length,2);assert.notEqual(reviews[0].application_cycle,reviews[1].application_cycle);
 });
 await test('student final acceptance is immediate, exclusive, and cancels obsolete reminders',async()=>{
  await act(leader,'application',{id:application,decision:'offer'});await age(application,'2 hours');assert.equal(await queue(),1);
  await act(applicant,'application',{id:application,decision:'accept'});
  assert.equal((await app()).status,'accepted');assert.equal((await read(applicant)).members.filter(x=>x.user_id===applicant).length,1);
  await assert.rejects(act(applicant,'apply',{idea_id:ideaB,message:'이미 합류한 뒤 다른 팀 지원입니다.'}),/이미 구성된 팀/);
  const jobs=await worker('tb_claim_notifications',[10]);assert(!jobs.some(x=>x.event.endsWith('_reminder')));assert.equal(await queue(),0);
 });
 await test('the unique index blocks conflicting writes even without the RPC guard',async()=>{
  await db.query("insert into team_private.applications(idea_id,applicant_id,message) values($1,$2,'직접 삽입하는 테스트 지원')",[ideaA,otherApplicant]);
  await assert.rejects(db.query("insert into team_private.applications(idea_id,applicant_id,message) values($1,$2,'충돌하는 다른 팀의 지원')",[ideaB,otherApplicant]),/one_active_application_per_student/);
 });
 await test('disabled matching or email stops reminder generation; browsers cannot call reminder RPCs',async()=>{
  const id=(await db.query('select id from team_private.applications where applicant_id=$1',[otherApplicant])).rows[0].id;await age(id,'2 hours');
  await db.exec('update team_private.settings set matching_open=false');assert.equal(await queue(),0);
  await db.exec('update team_private.settings set matching_open=true,email_notifications_enabled=false');assert.equal(await queue(),0);
  await db.exec('update team_private.settings set email_notifications_enabled=true');assert.equal(await queue(),1);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);try{await assert.rejects(db.query('select public.tb_queue_due_application_reminders()'),/permission denied/);}finally{await db.exec('reset role');}}
 });
 await test('re-running preserves clocks, cycles, reminders, settings and sibling course',async()=>{
  const before=await app(),jobs=await reminders(),settings=(await read(admin)).settings;
  await db.exec(migrations[2]);assert.deepEqual(await app(),before);assert.deepEqual(await reminders(),jobs);assert.deepEqual((await read(admin)).settings,settings);assert.deepEqual(await shared.read(shared.admin),sibling);
 });
 await test('fresh setup includes the exact latest migration',async()=>{
  const setup=await readFile(new URL('../../courses/eng3510/2026-fall/team-building/setup.sql',import.meta.url),'utf8');assert(setup.includes(migrations[2]));
  const fresh=await baseFixture('eng3510',{notifications:true,singleApplication:true});try{assert.equal((await fresh.read(fresh.admin)).offers_open,true);}finally{await fresh.db.close();}
 });
 console.log(`${count} single-application and reminder scenarios passed.`);
}finally{await db.close();}

const conflict=await baseFixture('eng3510',{notifications:true});
try{
 const {users:[a,b,c],post,act,db}=conflict;
 const first=(await post(a)).id,second=(await post(b)).id;
 await act(c,'apply',{idea_id:first,message:'첫 번째 팀에 지원합니다.'});await act(c,'apply',{idea_id:second,message:'두 번째 팀에도 지원합니다.'});
 await assert.rejects(db.exec(migrations[2]),/Resolve existing multiple/);await db.exec('rollback');
 assert.equal((await conflict.read(c)).applications.length,2);
 console.log('PASS: conflicting legacy applications stop the upgrade without discarding either choice.');
}finally{await conflict.db.close();}
