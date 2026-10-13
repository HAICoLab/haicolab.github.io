import {chromium} from '@playwright/test';
import {fixture} from './database.test.mjs';
import {config} from '../../courses/eng3510/2026-fall/team-building/config.js';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const base='http://eng3510-preview.test/';
const appDir=new URL('../../courses/eng3510/2026-fall/team-building/',import.meta.url);
const artifacts=new URL('../../../artifacts/team-building-eng3510/single-application/',import.meta.url);await mkdir(artifacts,{recursive:true});
const f=await fixture('eng3510',{notifications:true,singleApplication:true});const {db,users:[leader,applicant,otherLeader],post,act,read}=f;
const id=(await post(leader,{title:'공개 리뷰 데이터 분석 프로젝트'})).id;
const otherId=(await post(otherLeader,{title:'두 번째 데이터 분석 프로젝트'})).id;
await db.exec("update team_private.settings set offers_open_at=now()+interval '10 years'");
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
 const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(base+'#activity');await p.getByRole('heading',{name:'우리 팀에 온 지원'}).waitFor();return p;
}
try{
 const pl=await userPage(leader),pa=await userPage(applicant);
 pa.on('dialog',d=>d.accept());
 await pa.goto(base+'#idea/'+id);
 await pa.getByRole('button',{name:'이 팀에 합류 지원하기 →'}).click();
 await pa.getByLabel('지원 동기와 기여할 수 있는 역할').fill('Pandas를 활용한 데이터 정제와 시각화를 맡고 싶습니다.');
 await pa.getByRole('button',{name:'지원 보내기'}).click();
 await pa.getByRole('button',{name:'지원 취소',exact:true}).waitFor();
 await pa.goto(base+'#idea/'+otherId);
 await pa.getByText('한 번에 한 팀에만 지원할 수 있습니다.',{exact:false}).waitFor();
 assert.equal(await pa.getByRole('button',{name:'이 팀에 합류 지원하기 →'}).count(),0);
 await pa.goto(base+'#activity');
 await pa.getByRole('button',{name:'지원 취소',exact:true}).click();
 await pa.waitForFunction(()=>!document.querySelector('[data-decision="withdraw"]'));
 await pa.goto(base+'#idea/'+otherId);
 assert(await pa.getByRole('button',{name:'이 팀에 합류 지원하기 →'}).isVisible());
 console.log('PASS: applying locks other team buttons; withdrawal enables a new application.');
 await pa.goto(base+'#idea/'+id);
 await pa.getByRole('button',{name:'이 팀에 합류 지원하기 →'}).click();
 await pa.getByLabel('지원 동기와 기여할 수 있는 역할').fill('Pandas를 활용한 데이터 정제와 시각화를 맡고 싶습니다.');
 await pa.getByRole('button',{name:'지원 보내기'}).click();
 await pa.getByRole('button',{name:'지원 취소',exact:true}).waitFor();
 await pl.getByRole('button',{name:'활동 새로고침'}).click();
 const offer=pl.getByRole('button',{name:'합류 제안',exact:true});await offer.waitFor();assert(await offer.isEnabled());
 await pl.getByLabel('지원자에게 전할 말 (비공개)').fill('분석해 본 데이터가 있다면 알려 주세요.');
 await pl.getByRole('button',{name:'답변만 보내기'}).click();await pl.getByText('팀장 답변',{exact:true}).waitFor();
 await pl.locator('#toast').evaluate(el=>el.style.display='none');
 await pl.locator('.two-col > section').nth(1).screenshot({path:fileURLToPath(new URL('leader.png',artifacts))});
 await offer.click();await pl.getByText('지원자에게 전달했습니다.').waitFor();
 await pa.getByRole('button',{name:'활동 새로고침'}).click();
 const accept=pa.getByRole('button',{name:'제안 수락 · 합류 확정'});await accept.waitFor();assert(await accept.isEnabled());
 await accept.click();await pa.getByText('합류 확정',{exact:true}).waitFor();
 assert.equal((await read(leader)).members.filter(m=>m.idea_id===id).length,2);
 console.log('PASS: leader offers and student accepts immediately despite the legacy future date.');
 await sequential(()=>db.exec('update team_private.settings set matching_open=false'));
 await pl.getByRole('button',{name:'활동 새로고침'}).click();
 await pl.getByText('최신 활동을 불러왔습니다.').waitFor();
 assert.equal(await pl.getByRole('button',{name:'합류 제안',exact:true}).count(),0);
 await pl.setViewportSize({width:390,height:844});assert(await pl.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);console.log('PASS: matching closure, mobile layout and browser runtime errors checked.');
}finally{await browser.close();await db.close();}
