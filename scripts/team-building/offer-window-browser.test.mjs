import {chromium} from '@playwright/test';
import {fixture} from './database.test.mjs';
import {config} from '../../courses/eng3510/2026-fall/team-building/config.js';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const base='http://eng3510-preview.test/';
const appDir=new URL('../../courses/eng3510/2026-fall/team-building/',import.meta.url);
const artifacts=new URL('../../../artifacts/team-building-eng3510/offer-window/',import.meta.url);await mkdir(artifacts,{recursive:true});
const f=await fixture('eng3510',{notifications:true});const {db,users:[leader,applicant],post,act,read}=f;
const id=(await post(leader,{title:'공개 리뷰 데이터 분석 프로젝트'})).id;
await act(applicant,'apply',{idea_id:id,message:'Pandas를 활용한 데이터 정제와 시각화를 맡고 싶습니다. 화요일 저녁 회의에 참여할 수 있습니다.'});
await db.exec("update team_private.settings set offers_open_at=now()+interval '1 day'");
const browser=await chromium.launch({headless:true});const errors=[];
let chain=Promise.resolve();const sequential=fn=>{const p=chain.then(fn);chain=p.catch(()=>{});return p;};
async function userPage(user){
 const context=await browser.newContext({viewport:{width:1280,height:1100}});
 const session={access_token:'preview-'+user,refresh_token:'preview',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:user,aud:'authenticated',role:'authenticated',email:'example@example.invalid',app_metadata:{provider:'email'},user_metadata:{}}};
 await context.addInitScript(({session,key})=>{localStorage.setItem(key,JSON.stringify(session));const now=Date.now.bind(Date);Date.now=()=>now()+365*24*3600*1000;},{session,key:config.authStorageKey});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  try{
   if(url.origin===new URL(config.supabaseUrl).origin){
    if(url.pathname.endsWith('/rpc/tb_read'))return json(await sequential(()=>read(user)));
    if(url.pathname.endsWith('/rpc/tb_action')){const {action,payload}=req.postDataJSON();return json(await sequential(()=>act(user,action,payload)));}
    if(url.pathname==='/storage/v1/object/sign/team-images')return json(req.postDataJSON().paths.map(path=>({path,signedURL:'/object/sign/team-images/'+path+'?token=local',error:null})));
    if(url.pathname.startsWith('/storage/v1/object/sign/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420"><rect width="720" height="420" fill="#e2eee1"/></svg>'});
    if(url.pathname.endsWith('/auth/v1/user'))return json(session.user);
    // Deliberately skewed client clock makes Supabase refresh its test-only token.
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
 const offer=pl.getByRole('button',{name:'합류 제안',exact:true});assert(await offer.isDisabled());
 assert(await pl.getByRole('button',{name:'답변만 보내기'}).isEnabled());
 await pl.getByLabel('지원자에게 전할 말 (비공개)').fill('분석해 본 데이터가 있다면 알려 주세요.');
 await pl.getByRole('button',{name:'답변만 보내기'}).click();await pl.getByText('팀장 답변',{exact:true}).waitFor();assert(await offer.isDisabled());
 console.log('PASS: even with a future client clock, offer stays disabled; reply is allowed and does not unlock offer.');
 const app=(await read(leader)).applications[0];
 await sequential(()=>db.query("update team_private.applications set status='offered' where id=$1",[app.id]));
 await pa.getByRole('button',{name:'활동 새로고침'}).click();const accept=pa.getByRole('button',{name:'제안 수락 · 합류 확정'});await accept.waitFor();assert(await accept.isDisabled());
 // Restore a pending application and the announced date for the review screenshot.
 await sequential(()=>db.query("update team_private.applications set status='pending' where id=$1",[app.id]));
 await sequential(()=>db.exec("update team_private.settings set offers_open_at='2026-10-14 09:00:00+09'"));
 await pl.getByRole('button',{name:'활동 새로고침'}).click();await pl.getByText('최신 활동을 불러왔습니다.').waitFor();
 await pl.locator('#toast').evaluate(el=>el.style.display='none');
 await pl.locator('.two-col > section').nth(1).screenshot({path:fileURLToPath(new URL('leader.png',artifacts))});
 // Move the test server boundary two seconds ahead; no page reload and no draft loss.
 await sequential(()=>db.exec("update team_private.settings set offers_open_at=clock_timestamp()+interval '2 seconds'"));
 const previousField=await pl.getByLabel('지원자에게 전할 말 (비공개)').elementHandle();
 await pl.getByRole('button',{name:'활동 새로고침'}).click();await pl.waitForFunction(el=>!el.isConnected,previousField);
 await pl.getByLabel('지원자에게 전할 말 (비공개)').fill('시작 시간이 되어도 이 입력은 유지되어야 합니다.');
 await pl.waitForFunction(()=>!document.querySelector('[data-offer-gated]').disabled,{},{timeout:7000});
 assert.equal(await pl.getByLabel('지원자에게 전할 말 (비공개)').inputValue(),'시작 시간이 되어도 이 입력은 유지되어야 합니다.');
 console.log('PASS: server boundary automatically enables offer and preserves the draft.');
 await pl.getByRole('button',{name:'합류 제안',exact:true}).click();await pl.getByText('지원자에게 전달했습니다.').waitFor();
 await pa.getByRole('button',{name:'활동 새로고침'}).click();await pa.waitForFunction(()=>!document.querySelector('[data-offer-gated]').disabled);
 pa.on('dialog',d=>d.accept());await accept.click();await pa.getByText('합류 확정',{exact:true}).waitFor();assert.equal((await read(leader)).members.filter(m=>m.idea_id===id).length,2);
 await pl.setViewportSize({width:390,height:844});assert(await pl.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);console.log('PASS: applicant accepts after opening; team membership, mobile layout and runtime errors checked.');
}finally{await browser.close();await db.close();}
