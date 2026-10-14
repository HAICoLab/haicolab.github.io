import {chromium} from '@playwright/test';
import {fixture} from './database.test.mjs';
import {config} from '../../courses/eng3510/2026-fall/team-building/config.js';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const base='http://eng3510-preview.test/';
const appDir=new URL('../../courses/eng3510/2026-fall/team-building/',import.meta.url);
const artifacts=new URL('../../../artifacts/team-building-eng3510/admin-teams/',import.meta.url);await mkdir(artifacts,{recursive:true});
const f=await fixture('eng3510',{notifications:true,singleApplication:true});const {db,admin,users:[leader,applicant,otherLeader,pendingStudent],post,act,read}=f;
const id=(await post(leader,{title:'공개 리뷰 데이터 분석 프로젝트'})).id;
const otherId=(await post(otherLeader,{title:'두 번째 데이터 분석 프로젝트'})).id;
await act(leader,'invite_member',{idea_id:id,student_number:'20260002'});
let invitation=(await read(applicant)).invites.find(v=>v.is_mine);
await act(applicant,'respond_invite',{id:invitation.id,decision:'accept'});
await act(otherLeader,'invite_member',{idea_id:otherId,student_number:'20260004'});
await act(admin,'admin_roster',{students:['20260007']});
await act(otherLeader,'invite_member',{idea_id:otherId,student_number:'20260007'});
await db.query("update team_private.ideas set status='closed' where id=$1",[otherId]);
const archived=(await post(f.users[4],{title:'보관된 예전 아이디어'})).id;
await act(admin,'admin_remove_member',{user_id:f.users[4]});
const browser=await chromium.launch({headless:true});const errors=[];
let chain=Promise.resolve();const sequential=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;};
async function userPage(user){
 const context=await browser.newContext({viewport:{width:1280,height:1100}});
 const session={access_token:'preview-'+user,refresh_token:'preview',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',role:'authenticated',email:'example@example.invalid',app_metadata:{provider:'email'},user_metadata:{}}};
 await context.addInitScript(({session,key})=>{localStorage.setItem(key,JSON.stringify(session));},{session,key:config.authStorageKey});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  try{
   if(url.origin===new URL(config.supabaseUrl).origin){
    if(url.pathname.endsWith('/rpc/tb_read'))return json(await sequential(()=>read(user)));
    if(url.pathname.endsWith('/rpc/tb_action')){const {action,payload}=req.postDataJSON();return json(await sequential(()=>act(user,action,payload)));}
    if(url.pathname==='/storage/v1/object/sign/team-images')return json(req.postDataJSON().paths.map(path=>({path,signedURL:'/object/sign/team-images/'+path+'?token=local',error:null})));
    if(url.pathname.startsWith('/storage/v1/object/sign/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420"><rect width="720" height="420" fill="#e2eee1"/></svg>'});
    if(url.pathname.endsWith('/auth/v1/user'))return json(session.user);
    if(url.pathname.endsWith('/auth/v1/token'))return json({...session,expires_at:Math.floor(Date.now()/1000)+400*86400});
    throw Error('Unexpected route '+url.pathname);
   }
   if(url.origin===new URL(base).origin){
    const path=url.pathname==='/'?'index.html':url.pathname.slice(1),ext=path.split('.').at(-1);
    return route.fulfill({body:await readFile(new URL(path,appDir)),contentType:({js:'application/javascript',css:'text/css',html:'text/html'})[ext]});
   }
   return route.abort();
  }catch(e){return json({message:e.message},400);}
 });
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'#admin');if(user===admin)await p.getByRole('heading',{name:'팀빌딩 운영 현황',exact:true}).waitFor();else await p.getByText('교수자만 볼 수 있는 화면입니다.',{exact:true}).waitFor();return p;
}
try{
 const p=await userPage(admin);
 const section=p.locator('.admin-teams');
 assert.equal(await section.locator('.team-overview-card').count(),2);
 const first=section.locator('.team-overview-card').filter({hasText:'공개 리뷰 데이터 분석 프로젝트'});
 assert.match(await first.innerText(),/20260001[\s\S]*팀장[\s\S]*20260002[\s\S]*팀원/);
 const second=section.locator('.team-overview-card').filter({hasText:'두 번째 데이터 분석 프로젝트'});
 assert.match(await second.innerText(),/모집 종료[\s\S]*확정 1명[\s\S]*확인 대기 · 2명/);
 assert.match(await second.locator('.team-pending').innerText(),/20260004/);
 assert.match(await second.locator('.team-pending').innerText(),/미가입 학생/);
 assert(!await section.innerText().then(t=>t.includes('보관된 예전 아이디어')));
 assert.match(await section.locator('.team-unassigned').innerText(),/소속 미확정 학생\s+4명/);
 assert.match(await section.locator('.team-unassigned').innerText(),/20260007[\s\S]*미가입/);
 await p.screenshot({path:fileURLToPath(new URL('desktop.png',artifacts)),fullPage:true});
 await p.setViewportSize({width:390,height:844});
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await section.screenshot({path:fileURLToPath(new URL('mobile.png',artifacts))});
 invitation=(await read(pendingStudent)).invites.find(v=>v.is_mine);
 await act(pendingStudent,'respond_invite',{id:invitation.id,decision:'accept'});
 await p.getByRole('button',{name:'현황 새로고침',exact:true}).click();
 await p.getByText('최신 활동을 불러왔습니다.').waitFor();
 assert.match(await second.innerText(),/확정 2명/);
 assert.match(await second.locator('.team-person-list').first().innerText(),/20260004/);
 assert(!await section.locator('.team-unassigned').innerText().then(t=>t.includes('20260004')));
 const student=await userPage(leader);
 assert.equal(await student.locator('.admin-teams').count(),0);
 const payload=await read(leader);
 assert.equal(payload.roster,undefined);
 assert(!JSON.stringify({...payload,me:null}).includes('20260002'));
 assert.deepEqual(errors,[]);
 console.log('PASS: confirmed members, leader labels, closed teams with pending invites, unregistered students, archived exclusion, refresh, mobile layout and student privacy.');
}finally{await browser.close();await db.close();}
