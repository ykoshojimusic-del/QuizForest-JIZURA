// Phase 2: fixed-region policy, actual placements, non-destructive edits and UI persistence.
// Run with the existing Playwright runtime and preview_server.py. No dependencies added.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),cp=require('node:child_process'),path=require('node:path');
const {proMode,closeSettings}=require('./ui_helpers.cjs');
const root=path.join(__dirname,'..'),checkpoint='210d90270d0430ba62d75e194deef20bd116fbf1';
const base=process.env.JIZURA_TEST_URL||'http://127.0.0.1:8765/';
const executablePath=process.env.JIZURA_BROWSER_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
async function openPage(browser,locale,baseline=false){
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
 if(baseline){const html=cp.execFileSync('git',['show',checkpoint+':'+locale+'index.html'],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});await page.route(base+locale,r=>r.fulfill({contentType:'text/html',body:html}));}
 await page.goto(base+locale);await proMode(page);return {page,errors};
}
async function normalSnapshots(page){return page.evaluate(async()=>{
 const hashes=[],cases=['[00:00]神さまが大好き\n[00:03]*幸せになる*\n[00:06]~心配しないで~','[00:00]{神さま/大好き/愛いっぱい/幸せになる}','[00:00]{-神さま/大好き/*愛いっぱい*/幸せになる-}'];
 const canvas=document.createElement('canvas');canvas.width=300;canvas.height=500;J.mediaAssets.set('normal-centre',{element:canvas,type:'image'});
 for(let seed=1;seed<=64;seed++){
  const plans=[];for(const lyrics of cases)for(const foreground of [false,true]){
   const p=J.defaultProject();p.seed=seed;p.lyrics=lyrics;
   if(foreground)p.foreground={...p.foreground,items:[{id:'normal-centre',name:'centre.png',type:'image',width:300,height:500}],manualCuts:true,cutCount:1,cutOverrides:{0:{itemId:'normal-centre',technique:'none',placement:{cx:.5,cy:.5,w:.38,h:.68,lockAspect:false,angle:0}}}};
   plans.push(J.plan(p));
  }
  const p=J.defaultProject(),look=J.omakase(p,J.rng(seed));
  const bytes=new TextEncoder().encode(JSON.stringify({look,plans})),digest=await crypto.subtle.digest('SHA-256',bytes);
  hashes.push([...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join(''));
 }
 J.mediaAssets.delete('normal-centre');return hashes;
});}
async function explicitGroupSnapshots(page){return page.evaluate(()=>{
 const out=[];
 for(const seed of [1,17,42,64])for(const separate of [false,true])for(const mixed of [false,true]){
  const p=J.defaultProject();p.seed=seed;
  const text=mixed?'神さま/大好き\n愛いっぱい\n幸せになる':'神さま/大好き/愛いっぱい/幸せになる';
  p.lyrics='[00:00]'+(separate?'{-':'{')+text+(separate?'-}':'}');
  p.overrides={0:{layout:'center'}};J.quizForest.activate(p);
  const plan=J.plan(p),manual=plan.cuts.filter(c=>c.line===0&&Number.isInteger(c.part));
  if(!manual.length)throw Error('Explicit group comparison requires actual cuts');
  if(mixed&&J.quizForest.safeAreaSettings){
   const C=J.quizForest.safeAreaSettings(p).region,free=plan.cuts.filter(c=>c.line>0&&Number.isInteger(c.part));
   if(!free.length)throw Error('Mixed group comparison requires automatic neighbours');
   for(const c of free)if(!c.area||Math.max(0,Math.min(c.area.x+c.area.w,C.x+C.w)-Math.max(c.area.x,C.x))*Math.max(0,Math.min(c.area.y+c.area.h,C.y+C.h)-Math.max(c.area.y,C.y))>1e-9)throw Error('Automatic neighbour crossed character region');
  }
  out.push(manual.map(c=>({line:c.line,part:c.part,layout:c.layout,area:c.area,params:c.params,contentScale:c.contentScale,arrangement:c.arrangement,lyricPattern:c.lyricPattern})));
 }
 return out;
});}
(async()=>{
 const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 try{for(const locale of ['', 'en/']){
  const baseline=await openPage(browser,locale,true),before=await normalSnapshots(baseline.page);
  const explicitBefore=await explicitGroupSnapshots(baseline.page);
  assert.equal(before.length,64);assert.deepEqual(baseline.errors,[]);await baseline.page.close();
  const {page,errors}=await openPage(browser,locale),after=await normalSnapshots(page);
  assert.equal(after.length,64);assert.deepEqual(after,before,'normal-mode plans/randomizer must match Phase 1 exactly');
  const explicitAfter=await explicitGroupSnapshots(page);
  assert.equal(explicitAfter.length,16);assert.deepEqual(explicitAfter,explicitBefore,'explicit group layouts must retain Phase-1 geometry and parameters');
  const result=await page.evaluate(()=>{
   const failures=[],check=(ok,label)=>{if(!ok)failures.push(label);},overlap=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
   const plain=J.defaultProject();check(J.quizForest.safeAreaSettings(plain)===null,'normal has no QF constraint');
   const p=J.defaultProject();J.quizForest.activate(p);const policy=J.quizForest.safeAreaSettings(p),C=policy.region;
   check(JSON.stringify(C)===JSON.stringify({x:.31,y:.16,w:.38,h:.68}),'adopted ratios');
   check(JSON.stringify(J.CENTER_AVOID)===JSON.stringify({x:.32,y:.3,w:.36,h:.4}),'ordinary region unchanged');
   check(policy.zones.length>=4,'nonempty policy candidate set');
   for(const z of policy.zones){check(z.zone.w>0&&z.zone.h>0,'positive candidate area '+z.id);check(overlap(z.zone,C)<=1e-9,'candidate intersects character '+z.id);}
   check(policy.zones.filter(z=>['left','right'].includes(z.id)).reduce((n,z)=>n+z.weight,0)>policy.zones.filter(z=>['top','bottom'].includes(z.id)).reduce((n,z)=>n+z.weight,0),'side priority encoded in candidate weights');
   const cases={plain:'[00:00]神さまが大好き\n[00:03]幸せになる\n[00:06]心配しないで',emphasis:'[00:00]*神さまが大好き*\n[00:03]*幸せになる*',soft:'[00:00]~心配しないで~\n[00:03]~みんな幸せ~',shared:'[00:00]{神さま/大好き/*愛いっぱい*/幸せになる}',separate:'[00:00]{-神さま/大好き/*愛いっぱい*/幸せになる-}'};
   const canvas=document.createElement('canvas');canvas.width=300;canvas.height=500;J.mediaAssets.set('qf-centre',{element:canvas,type:'image'});
   let total=0,emphasised=0,clippedEvents=0,centreOff=0;const stats={},patterns=new Set();
   for(const aspect of ['16:9','9:16'])for(const [name,lyrics]of Object.entries(cases))for(const fg of ['none','centre','full']){
    const key=[aspect,name,fg].join('/');let count=0;
    for(let seed=1;seed<=64;seed++){
     const q=J.defaultProject();q.seed=seed;q.lyrics=lyrics;q.aspect=aspect;
     if(fg!=='none')q.foreground={...q.foreground,items:[{id:'qf-centre',name:'centre.png',type:'image',width:300,height:500}],manualCuts:true,cutCount:1,cutOverrides:{0:{itemId:'qf-centre',technique:'none',placement:{cx:.5,cy:.5,w:fg==='full'?1:.38,h:fg==='full'?1:.68,lockAspect:false,angle:0}}}};
     const zone=J.pickSoloZone({seed,emphasis:true},{avoidCenter:true,safeArea:policy});check(policy.zones.includes(zone),'solo selects only approved zones');
     J.quizForest.activate(q);const plan=J.plan(q),cuts=plan.cuts.filter(c=>c.line>=0&&Number.isInteger(c.part));
     check(cuts.length>0,'nonempty '+key+' seed '+seed);
     for(const c of cuts){count++;total++;if(c.emphasis)emphasised++;if(c.arrangement)patterns.add(c.arrangement);
      check(!!c.area,'missing automatic area '+key+' seed '+seed);
      if(c.area){check(overlap(c.area,C)<=1e-9,'character collision '+key+' seed '+seed+' '+c.text);check(c.area.x>=-1e-9&&c.area.y>=-1e-9&&c.area.x+c.area.w<=1+1e-9&&c.area.y+c.area.h<=1+1e-9,'outside stage '+key);}
     }
     for(const event of plan.events){const r=plan.qfEffectAreas?.[event.cutOwner];check(!!r,'auto effect must use its lyric clip');if(r){clippedEvents++;check(overlap(r,C)<=1e-9,'effect clip collision');}}
     if(aspect==='16:9'&&name==='plain'&&fg==='none'){
      J.quizForest.deactivate(q);check(J.quizForest.safeAreaSettings(q)===null,'OFF releases policy');
      for(const c of J.plan(q).cuts)if(c.area&&overlap(c.area,C)>1e-9)centreOff++;
     }
    }
    check(count>0,'non-vacuous scenario '+key);stats[key]=count;
   }
   check(total>0&&emphasised>0&&clippedEvents>0&&patterns.size>0,'coverage includes emphasis, effects and group arrangements');check(centreOff>0,'OFF can use centre again');
   // Explicit central area, hand-picked layout, cut details and notation retain Phase-1 rules.
   const central={x:.35,y:.23,w:.3,h:.54,angle:0,lockAspect:true};
   for(const kind of ['area','layout','cut','lock','notation']){
    const q=J.defaultProject();q.lyrics='[00:00]神さま大好き';q.overrides={0:{single:true}};
    if(kind==='area')q.overrides[0].area=central;
    if(kind==='layout')q.overrides[0].layout='center';
    if(kind==='cut')q.lyricCutOptions={'0:0':{untilNext:false,endTime:2,details:{area:central,layout:'center',hold:'still',palette:{bg:'#000000',fg:'#FFFFFF'}}}};
    if(kind==='notation')q.lyrics='[00:00]60:神さま大好き';
    if(kind==='lock')q.overrides[0]={...q.overrides[0],lock:true,layout:'center',lockedAreas:{0:central},lockedEffects:{0:{layout:'center',hold:'still'}}};
    const data=JSON.stringify([q.overrides,q.lyricCutOptions,q.lyrics]);J.quizForest.activate(q);
    const cut=J.plan(q).cuts.find(c=>c.line===0);check(!!cut,'manual cut exists '+kind);
    if(['area','cut','lock'].includes(kind))check(JSON.stringify(cut.area)===JSON.stringify(central),'explicit centre retained '+kind);
    if(kind==='layout')check(cut.layout==='center'&&J.quizForest.keepPlacement(q,cut),'manual central layout exempt');
    if(kind==='notation')check(Math.abs(cut.area.w-.6)<1e-9&&Math.abs(cut.area.h-.6)<1e-9,'explicit oversized notation unchanged');
    check(JSON.stringify([q.overrides,q.lyricCutOptions,q.lyrics])===data,'ON preserves explicit data '+kind);
    J.quizForest.deactivate(q);check(JSON.stringify([q.overrides,q.lyricCutOptions,q.lyrics])===data,'OFF preserves explicit data '+kind);
   }
   const disabled=J.defaultProject();disabled.lyricEffects.autoPlacement=false;J.quizForest.activate(disabled);const disabledCuts=J.plan(disabled).cuts.filter(c=>c.line>=0&&Number.isInteger(c.part));
   check(disabledCuts.length>0,'manual-placement-only scenario nonempty');check(disabledCuts.every(c=>!c.area),'explicit automatic-placement OFF retained');
   // Exercise the actual Canvas clip, including a positive draw control and OFF.
   const previousFX=J.FXE.qf_test_fill;J.FXE.qf_test_fill={draw(ctx,ev,k,I){ctx.fillStyle='#FF0000';ctx.fillRect(0,0,I.cw,I.ch);}};
   try{
    const q=J.defaultProject();q.lyrics='[00:00]神さま大好き';J.quizForest.activate(q);let plan=J.plan(q);J.captureAutoEffects(q,plan);
    check(!JSON.stringify(q).includes('qfEffectAreas'),'clip policy not persisted in automatic cache');
    const cv=document.createElement('canvas');cv.width=320;cv.height=180;const renderer=new J.Renderer(),ctx=cv.getContext('2d');
    const render=pl=>{const cut=pl.cuts.find(c=>c.line>=0);ctx.clearRect(0,0,320,180);renderer.post(ctx,{...pl,events:[{type:'qf_test_fill',t:0,dur:1,amp:1,cutOwner:`${cut.line}:${cut.part}`}]},.5,.5,12,pl.style.schemes[0],1,{fast:true,transparent:true},false);return ctx.getImageData(0,0,320,180).data;};
    const pixels=render(plan);let drawn=0,centralPaint=0;
    for(let y=0;y<180;y++)for(let x=0;x<320;x++){const alpha=pixels[(y*320+x)*4+3];if(alpha)drawn++;if(x>=Math.ceil(C.x*320)&&x<Math.floor((C.x+C.w)*320)&&y>=Math.ceil(C.y*180)&&y<Math.floor((C.y+C.h)*180)&&alpha)centralPaint++;}
    check(drawn>0,'effect clip positive draw control');check(centralPaint===0,'effect did not paint character region');
    J.quizForest.deactivate(q);plan=J.plan(q);check(!plan.qfEffectAreas,'OFF removes effect clip map');check(render(plan)[(90*320+160)*4+3]===255,'OFF removes raster clip even with cached effects');
    q.overrides={0:{single:true,area:central}};J.quizForest.activate(q);plan=J.plan(q);check(!plan.qfEffectAreas['0:0'],'explicit area not clipped');check(render(plan)[(90*320+160)*4+3]===255,'manual effect may occupy centre');
   }finally{if(previousFX)J.FXE.qf_test_fill=previousFX;else delete J.FXE.qf_test_fill;}
   J.mediaAssets.delete('qf-centre');return {failures:[...new Set(failures)],total,emphasised,clippedEvents,centreOff,scenarios:Object.keys(stats).length,patterns:patterns.size};
  });
  assert.ok(result.total>0&&result.scenarios===30);assert.deepEqual(result.failures,[]);
  // Real UI lock, manual area, explicit cut, ON/OFF, undo/redo and local/portable persistence.
  await page.locator('#lyrics').fill('[00:00]神さま大好き\n[00:03]愛いっぱい\n[00:06]みんな幸せ');
  await page.evaluate(()=>{const a={x:.35,y:.23,w:.3,h:.54,angle:0,lockAspect:true};J.ui.project.overrides={0:{single:true,layout:'center',area:a},1:{single:true},2:{single:true}};J.ui.project.lyricCutOptions={'2:0':{untilNext:false,endTime:8,details:{area:a,layout:'center',hold:'still'}}};J.uiApi.replan();});
  assert.ok(await page.locator('#lineList .tools select').count()>0);
  await page.locator('#lineList li').nth(1).locator('.lock').click();
  const saved=await page.evaluate(()=>({overrides:J.ui.project.overrides,options:J.ui.project.lyricCutOptions,settings:J.ui.project.lyricEffects,areas:J.ui.plan.cuts.filter(c=>c.line>=0).map(c=>[c.line,c.part,c.area,c.layout])}));
  assert.equal(saved.overrides[1].lock,true);assert.ok(Object.keys(saved.overrides[1].lockedAreas).length>0);
  await page.locator('#btnQuizForest').click();
  assert.equal(await page.locator('#lyricAvoidCenter').isChecked(),true);assert.equal(await page.locator('#lyricAvoidCenter').isDisabled(),true);
  assert.deepEqual(await page.evaluate(()=>J.ui.project.overrides),saved.overrides);
  assert.deepEqual(await page.evaluate(()=>J.ui.project.lyricCutOptions),saved.options);
  assert.deepEqual(await page.evaluate(()=>J.ui.project.lyricEffects),saved.settings,'QF policy does not rewrite underlying settings');
  assert.deepEqual(await page.evaluate(()=>J.ui.plan.cuts.filter(c=>c.line>=0).map(c=>[c.line,c.part,c.area,c.layout])),saved.areas);
  const note=await page.locator('label:has(#lyricAvoidCenter) small').textContent();assert.ok(locale?note.includes('emphasised'):note.includes('強調'),note);
  await page.locator('#btnUndo').click();assert.equal(await page.locator('#btnQuizForest').getAttribute('aria-pressed'),'false');assert.equal(await page.locator('#lyricAvoidCenter').isChecked(),false);
  await page.locator('#btnRedo').click();assert.equal(await page.locator('#btnQuizForest').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#lyricAvoidCenter').isChecked(),true);
  const portable=await page.evaluate(async()=>{const p=J.ui.project,loaded=(await J.unpackProject(await J.packProject(p,null))).project,settings=J.applyProjectSettings(J.defaultProject(),J.projectSettings(p));return {mode:loaded.quizForestMode,region:J.quizForest.safeAreaSettings(loaded).region,settingsMode:settings.quizForestMode,overrides:loaded.overrides,options:loaded.lyricCutOptions,version:loaded.version};});
  assert.equal(portable.mode,true);assert.equal(portable.settingsMode,true);assert.equal(portable.version,1);assert.deepEqual(portable.region,{x:.31,y:.16,w:.38,h:.68});assert.deepEqual(portable.overrides,saved.overrides);assert.deepEqual(portable.options,saved.options);
  await page.evaluate(()=>J.uiApi.flushSave());await page.reload();assert.equal(await page.locator('#btnQuizForest').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#lyricAvoidCenter').isChecked(),true);
  assert.deepEqual(await page.evaluate(()=>J.ui.plan.cuts.filter(c=>c.line>=0).map(c=>[c.line,c.part,c.area,c.layout])),saved.areas);
  await page.locator('#btnQuizForestOff').click();assert.equal(await page.locator('#lyricAvoidCenter').isChecked(),false);assert.equal(await page.locator('#lyricAvoidCenter').isDisabled(),false);
  assert.deepEqual(await page.evaluate(()=>J.ui.project.overrides),saved.overrides);assert.deepEqual(await page.evaluate(()=>J.ui.project.lyricCutOptions),saved.options);
  assert.deepEqual(await page.evaluate(()=>J.ui.plan.cuts.filter(c=>c.line>=0).map(c=>[c.line,c.part,c.area,c.layout])),saved.areas);
  await page.evaluate(()=>J.uiApi.flushSave());await page.reload();assert.equal(await page.locator('#btnQuizForest').getAttribute('aria-pressed'),'false');assert.equal(await page.evaluate(()=>J.quizForest.safeAreaSettings(J.ui.project)),null);
  await closeSettings(page);assert.deepEqual(errors,[]);
  console.log(locale||'ja',{normalSeeds:64,qfSeedsPerScenario:64,...result,errors});await page.close();
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
