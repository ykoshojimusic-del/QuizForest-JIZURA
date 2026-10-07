// Run against `python3 -B preview_server.py` with the existing Playwright runtime.
// No project assets or repository files are created by this test.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {proMode,closeSettings}=require('./ui_helpers.cjs');
const url=process.env.JIZURA_TEST_URL||'http://127.0.0.1:8765/';
const executablePath=process.env.JIZURA_BROWSER_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
(async()=>{
 const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 try {for(const locale of ['', 'en/']){
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
  await page.goto(url+locale);await proMode(page);
  assert.equal(await page.locator('#btnQuizForest').getAttribute('aria-pressed'),'false');
  const original=await page.evaluate(()=>JSON.stringify(J.ui.project));
  const registry=await page.evaluate(()=>JSON.stringify([...J.GROUP_KEYS.map(g=>[g,J.order(g)]),['media',Object.keys(J.MEDIA_TECH)],['themes',Object.keys(J.THEMES)]]));
  const normalCount=await page.locator('#techLists input[type=checkbox]').count();
  await page.locator('#btnThemes').click();
  assert.equal(await page.locator('[data-theme="horror"]').count(),1);
  await page.locator('#themesDlg button[value="cancel"]').click();
  await page.locator('#btnQuizForest').click();
  assert.equal(await page.locator('#btnQuizForest').getAttribute('aria-pressed'),'true');
  const first=await page.evaluate(()=>({colors:J.ui.project.colors,style:J.ui.project.style,
    unchanged:['lyrics','timing','aspect','res','fps','keyBg','overrides','lyricCutOptions','lyricEffects'].map(k=>[k,JSON.stringify(J.ui.project[k])])}));
  const old=JSON.parse(original);
  assert.deepEqual(old.colors,{enabled:false},'initial browser project must have an unedited palette');
  assert.equal(first.colors.bg,'#FFFDF6');assert.equal(first.colors.fg,'#31405F');assert.equal(first.colors.accent,'#FF8FB8');
  for(const [key,value]of first.unchanged)assert.equal(value,JSON.stringify(old[key]),key+' changed');
  assert.ok(await page.locator('#techLists input[type=checkbox]').count()<normalCount);
  assert.ok(await page.locator('#lineList .tools select').count()>0,'layout selectors must exist before inspecting their options');
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#lineList .tools select')].every(select=>[...select.options].every(option=>!option.value||J.quizForest.allowed(J.ui.project,'layout',option.value)))),true);
  assert.equal(await page.locator('#fx_glitch,#fx_chroma').count(),0);
  const allMediaChoices=await page.locator('[data-media-tech]').evaluateAll(els=>els.map(el=>el.dataset.mediaTech));
  for(const id of ['glitch','chromaticSplit','beatShake','glassShards','enter_shakeIn','exit_shakeIn'])assert.ok(!allMediaChoices.includes(id),id+' still offered');
  await page.locator('#btnThemes').click();
  assert.equal(await page.locator('[data-theme="horror"],[data-theme="rock"],[data-theme="kinetic"]').count(),0);
  assert.equal(await page.locator('#colorGenre').isDisabled(),true);
  assert.equal(await page.locator('.theme-colors .swatches i').count(),8);
  const swatch=await page.locator('.theme-colors .swatches i').first().boundingBox();
  assert.ok(swatch&&swatch.width>0&&swatch.height>0,'QF palette swatches must be visible');
  await page.locator('#themesDlg button[value="cancel"]').click();
  await page.locator('#btnUndo').click();
  assert.equal(await page.locator('#btnQuizForest').getAttribute('aria-pressed'),'false');
  await page.locator('#btnRedo').click();
  assert.equal(await page.locator('#btnQuizForest').getAttribute('aria-pressed'),'true');
  await page.locator('#btnQuizForest').click(); // Applying again must not replace the normal-mode backup.
  const customCandidates=await page.evaluate(()=>{
   const fixture=J.defaultProject(),lyricId='custom_qf_audit_hold',mediaId='custom_qf_audit_media';
   J.importCustomEffects(fixture,[
    {version:1,id:lyricId,group:'hold',name:'Audit hold',themes:['cute'],base:'still',motion:{rotation:{from:0,to:720}}},
    {version:1,id:mediaId,group:'media',name:'Audit media',themes:['cute'],base:'glitch'},
   ]);
   fixture.themes=['cute'];
   fixture.overrides={0:{lock:true,layout:'center',enter:'cut',hold:lyricId,exit:'cut'}};
   fixture.lyricCutOptions={'0:0':{palette:{bg:'#000000',fg:'#FFFFFF'}}};
   fixture.media.cutOverrides={0:{lock:true,technique:mediaId}};
   fixture.media.effects={enabled:{custom_qf_orphan:true},decorEnabled:{custom_qf_orphan:true}};
   const explicit=JSON.stringify([fixture.overrides,fixture.lyricCutOptions,fixture.media.cutOverrides]);
   try {
    const normal=J.themeCandidates(fixture,'cute');let normalSelected=0;
    for(let seed=1;seed<=64;seed++)if(J.omakase(fixture,J.rng(seed)).enabled.hold[lyricId])normalSelected++;
    J.quizForest.activate(fixture);
    const pool=J.themeCandidates(fixture,'cute'),failures=[];
    for(const [group,ids]of Object.entries(pool.lyrics))for(const id of ids)if(!J.quizForest.allowed(fixture,group,id))failures.push('pool '+group+':'+id);
    for(const id of pool.media)if(!J.quizForest.allowed(fixture,'media',id))failures.push('media pool '+id);
    for(let seed=1;seed<=64;seed++){
     const result=J.omakase(fixture,J.rng(seed));
     if(result.enabled.hold[lyricId])failures.push('custom lyric enabled');
     for(const layer of ['media','foreground'])if(result[layer].effects.enabled[mediaId])failures.push('custom media enabled');
     for(const [group,entries]of Object.entries(result.enabled))for(const [id,on]of Object.entries(entries))if(on&&!J.quizForest.allowed(fixture,group,id))failures.push('generated '+group+':'+id);
    }
    const explicitOn=JSON.stringify([fixture.overrides,fixture.lyricCutOptions,fixture.media.cutOverrides])===explicit;
    const explicitPlanned=J.plan(fixture).cuts.some(c=>c.hold===lyricId);
    const restricted=J.mediaEffectSettings(fixture,'media');
    const result={normalLyric:normal.lyrics.hold.includes(lyricId),normalMedia:normal.media.includes(mediaId),normalSelected,
     qfLyric:pool.lyrics.hold.includes(lyricId),qfMedia:pool.media.includes(mediaId),
     unknownAllowed:J.quizForest.allowed(fixture,'unknown_effect_group','custom_unknown'),
     lyricAllowed:J.quizForest.allowed(fixture,'hold',lyricId),failures:[...new Set(failures)],explicitOn,explicitPlanned,
     orphanMedia:restricted.enabled.custom_qf_orphan,orphanDecor:restricted.decorEnabled.custom_qf_orphan,
     registryKept:!!(J.HOLD[lyricId]&&J.MEDIA_TECH[mediaId])};
    J.quizForest.deactivate(fixture);
    result.explicitOff=JSON.stringify([fixture.overrides,fixture.lyricCutOptions,fixture.media.cutOverrides])===explicit;
    return result;
   } finally {J.activateCustomEffects(J.ui.project);}
  });
  assert.equal(customCandidates.normalLyric,true);assert.equal(customCandidates.normalMedia,true);
  assert.ok(customCandidates.normalSelected>0,'normal mode must retain custom random candidates');
  for(const key of ['qfLyric','qfMedia','unknownAllowed','lyricAllowed','orphanMedia','orphanDecor'])assert.equal(customCandidates[key],false,key);
  for(const key of ['explicitOn','explicitOff','explicitPlanned','registryKept'])assert.equal(customCandidates[key],true,key);
  assert.deepEqual(customCandidates.failures,[]);
  const paletteStates=await page.evaluate(()=>{
   const failures=[];
   for(const colors of [{enabled:false},{enabled:false,accentOn:false}]){
    const p=J.defaultProject();p.colors=colors;J.quizForest.activate(p);
    if(p.colors.bg!=='#FFFDF6'||p.colors.fg!=='#31405F')failures.push('standard palette');
   }
   // Stored colour values remain protected even after their switches are disabled.
   for(const colors of [{enabled:false,bg:'#ABCDEF'},{enabled:false,accentOn:true,accent:'#012345'},{enabled:true,fg:'#000000'}]){
    const p=J.defaultProject();p.colors=colors;const before=JSON.stringify(colors);
    J.quizForest.activate(p);if(JSON.stringify(p.colors)!==before)failures.push('manual on');
    J.quizForest.activate(p);if(JSON.stringify(p.colors)!==before)failures.push('manual repeated on');
    J.quizForest.deactivate(p);if(JSON.stringify(p.colors)!==before)failures.push('manual off');
   }
   return failures;
  });
  assert.deepEqual(paletteStates,[]);
  const generated=await page.evaluate(()=>{
   const p=J.ui.project,failures=[],palette=Object.values(J.quizForest.palette);let cuts=0;
   for(let seed=1;seed<=64;seed++){
    const result=J.omakase(p,J.rng(seed)),plan=J.plan({...p,...result});cuts+=plan.cuts.length;
    if(result.fx.glitch||result.fx.chroma||result.fx.flash)failures.push('global FX escaped');
    for(const color of Object.values(result.colors))if(typeof color==='string'&&!palette.includes(color))failures.push('palette escaped');
    if(Object.values(result.colors).includes('#000000'))failures.push('automatic pure black');
    for(const g of J.GROUP_KEYS)for(const [id,on]of Object.entries(result.enabled[g]))if(on&&!J.quizForest.allowed(p,g,id))failures.push('lyric '+g+':'+id);
    for(const layer of ['media','foreground'])for(const [id,on]of Object.entries(result[layer].effects.enabled))if(on&&!J.quizForest.allowed(p,'media',id))failures.push('media '+id);
    for(const cut of plan.cuts)if(cut.line>=0)for(const g of ['layout','enter','hold','exit','treat','bg','cam'])if(cut[g]&&!J.registry(g)[cut[g]]?.special&&!J.quizForest.allowed(p,g,cut[g]))failures.push('planned '+g+':'+cut[g]);
   }
   return {failures:[...new Set(failures)],cuts};
  });
  assert.deepEqual(generated.failures,[]);
  const portable=await page.evaluate(async()=>{
   const p=J.ui.project,b=await J.packProject(p,null),loaded=(await J.unpackProject(b)).project;
   const settings=J.projectSettings(p),roundtrip=J.applyProjectSettings(J.defaultProject(),settings);
   return {full:loaded.quizForestMode,settings:roundtrip.quizForestMode,backup:!!loaded.quizForestPrevious,
     normalSettings:!!J.applyProjectSettings(p,J.defaultProject()).quizForestMode};
  });
  assert.deepEqual(portable,{full:true,settings:true,backup:true,normalSettings:false});
  await page.evaluate(()=>J.uiApi.flushSave());await page.reload();
  assert.equal(await page.locator('#btnQuizForest').getAttribute('aria-pressed'),'true');
  assert.equal(await page.evaluate(()=>J.ui.project.colors.bg),'#FFFDF6');
  assert.equal(await page.locator('#fx_glitch,#fx_chroma').count(),0);
  await page.locator('#btnOmakase').click();
  assert.equal(await page.evaluate(()=>J.ui.project.colors.bg),'#FFFDF6');
  assert.equal(await page.evaluate(()=>J.ui.project.fx.glitch),0);
  await page.locator('#btnQuizForestOff').click();
  assert.equal(await page.locator('#btnQuizForest').getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('#techLists input[type=checkbox]').count(),normalCount);
  assert.equal(await page.locator('#fx_glitch,#fx_chroma').count(),2);
  const restored=await page.evaluate(()=>({colors:J.ui.project.colors,style:J.ui.project.style,fx:J.ui.project.fx,themes:J.ui.project.themes}));
  for(const key of Object.keys(restored))assert.deepEqual(restored[key],old[key],key+' not restored');
  assert.equal(await page.evaluate(()=>JSON.stringify([...J.GROUP_KEYS.map(g=>[g,J.order(g)]),['media',Object.keys(J.MEDIA_TECH)],['themes',Object.keys(J.THEMES)]])),registry);
  assert.ok(await page.evaluate(()=>!!(J.MEDIA_TECH.glitch&&J.EXIT.glassBreak&&J.CAMERA.shakeHard&&J.THEMES.horror)));
  await page.evaluate(()=>J.uiApi.flushSave());await page.reload();
  assert.equal(await page.locator('#btnQuizForest').getAttribute('aria-pressed'),'false');
  // Use the actual manual-colour input handlers, rather than setting a new provenance flag.
  await page.evaluate(()=>{
   const values={colorRow:['#FAE3CF','#000000','#31405F'],colorRowAccent:['#D84F95','#AED3E1','#CEBBE8']};
   for(const [row,colors]of Object.entries(values))document.querySelectorAll('#'+row+' input').forEach((input,i)=>{
    input.value=colors[i];input.dispatchEvent(new Event('input',{bubbles:true}));
   });
  });
  await page.waitForFunction(()=>J.ui.plan.style.schemes[0].fg==='#000000');
  const manual=await page.evaluate(()=>JSON.parse(JSON.stringify(J.ui.project.colors)));
  assert.equal(manual.enabled,true);assert.equal(manual.accentOn,true);assert.equal(manual.fg,'#000000');
  await page.locator('#btnQuizForest').click();
  assert.deepEqual(await page.evaluate(()=>J.ui.project.colors),manual,'manual palette must survive QF ON');
  assert.equal(await page.evaluate(()=>J.ui.plan.style.schemes[0].fg),'#000000','explicit black must render in QF');
  await page.locator('#btnUndo').click();
  assert.equal(await page.locator('#btnQuizForest').getAttribute('aria-pressed'),'false');
  assert.deepEqual(await page.evaluate(()=>J.ui.project.colors),manual);
  await page.locator('#btnRedo').click();
  assert.equal(await page.locator('#btnQuizForest').getAttribute('aria-pressed'),'true');
  assert.deepEqual(await page.evaluate(()=>J.ui.project.colors),manual);
  await page.locator('#btnQuizForest').click();
  assert.deepEqual(await page.evaluate(()=>J.ui.project.colors),manual,'repeated QF ON must preserve manual palette');
  const automaticFromManual=await page.evaluate(()=>{
   const p=J.ui.project,palette=Object.values(J.quizForest.palette),failures=[];
   for(let seed=1;seed<=64;seed++){
    const result=J.omakase(p,J.rng(seed));
    for(const color of Object.values(result.colors))if(typeof color==='string'&&!palette.includes(color))failures.push(color);
    if(Object.values(result.colors).includes('#000000'))failures.push('black');
   }
   return failures;
  });
  assert.deepEqual(automaticFromManual,[],'automatic palettes must use QF colours even when the current palette is manual');
  assert.deepEqual(await page.evaluate(()=>J.ui.project.colors),manual,'generating candidates must not mutate manual colours');
  const manualPortable=await page.evaluate(async()=>{
   const p=J.ui.project,loaded=(await J.unpackProject(await J.packProject(p,null))).project;
   return {colors:loaded.colors,previous:loaded.quizForestPrevious.values.colors};
  });
  assert.deepEqual(manualPortable.colors,manual);assert.deepEqual(manualPortable.previous,manual);
  await page.evaluate(()=>J.uiApi.flushSave());await page.reload();
  assert.equal(await page.locator('#btnQuizForest').getAttribute('aria-pressed'),'true');
  assert.deepEqual(await page.evaluate(()=>J.ui.project.colors),manual,'QF reload must retain manual palette');
  await page.locator('#btnQuizForestOff').click();
  assert.deepEqual(await page.evaluate(()=>J.ui.project.colors),manual,'manual palette must survive QF OFF');
  assert.equal(await page.evaluate(()=>J.ui.plan.style.schemes[0].fg),'#000000');
  await page.evaluate(()=>J.uiApi.flushSave());await page.reload();
  assert.equal(await page.locator('#btnQuizForest').getAttribute('aria-pressed'),'false');
  assert.deepEqual(await page.evaluate(()=>J.ui.project.colors),manual,'normal reload must retain manual palette');
  await closeSettings(page);assert.deepEqual(errors,[]);
  console.log(locale||'ja',{normalCandidates:normalCount,qfSeeds:64,customSeeds:64,manualPaletteSeeds:64,plannedCuts:generated.cuts,errors});await page.close();
 }} finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
