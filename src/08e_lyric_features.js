/* Lyric display lifetimes and deterministic, foreground-aware placement. */
(() => {
'use strict';

J.LYRIC_BLENDS = ['normal', 'multiply', 'screen', 'overlay'];
const percent = (value, fallback) => value != null && value !== '' && Number.isFinite(+value) ? J.clamp(+value, 0, 100) : fallback;
J.lyricEffectSettings = project => {
  const settings = project.lyricEffects || {};
  const min = percent(settings.opacityMin, 0), max = percent(settings.opacityMax, 100);
  const sizeMin = settings.sizeMin != null && Number.isFinite(+settings.sizeMin) ? J.clamp(+settings.sizeMin, 0, 500) : 75;
  const sizeMax = settings.sizeMax != null && Number.isFinite(+settings.sizeMax) ? J.clamp(+settings.sizeMax, 0, 500) : 125;
  return {
    autoPlacement: settings.autoPlacement !== false, avoidForeground: settings.avoidForeground !== false,
    avoidCenter: settings.avoidCenter === true,
    avoidanceStrength: settings.avoidanceStrength != null && Number.isFinite(+settings.avoidanceStrength) ? J.clamp(+settings.avoidanceStrength, 0, 1) : 1,
    lyricAvoidanceStrength: settings.lyricAvoidanceStrength != null && Number.isFinite(+settings.lyricAvoidanceStrength) ? J.clamp(+settings.lyricAvoidanceStrength,0,1) : 1,
    sizeMin: Math.min(sizeMin, sizeMax), sizeMax: Math.max(sizeMin, sizeMax),
    randomBlend: settings.randomBlend === true, randomOpacity: settings.randomOpacity === true,
    opacityMin: Math.min(min, max), opacityMax: Math.max(min, max),
  };
};

J.lyricComposite = (project, cut, settings = J.lyricEffectSettings(project)) => {
  const options = project.lyricCutOptions?.[`${cut.line}:${cut.part}`] || {};
  const line = project.overrides?.[cut.line];
  const locked = line?.lock ? line.lockedComposites?.[cut.part] : null;
  const blend = J.LYRIC_BLENDS.includes(options.blend) ? options.blend : J.LYRIC_BLENDS.includes(locked?.blend) ? locked.blend
    : settings.randomBlend ? J.rng(J.h(cut.seed, 953)).pick(J.LYRIC_BLENDS) : 'normal';
  const random = J.rng(J.h(cut.seed, 967))();
  const strength = cut.emphasis ? (2 + random) / 3 : cut.suppressed ? random / 3 : random;
  const opacity = percent(options.opacity, null) ?? percent(locked?.opacity, null)
    ?? (settings.randomOpacity ? J.clamp(Math.round(J.lerp(settings.opacityMin, settings.opacityMax, strength)), settings.opacityMin, settings.opacityMax) : 100);
  return { blend, opacity };
};

// Older projects stored one lyric blend/opacity on the background layer.
// Transfer a non-default setting to the existing cuts once, preserving edits.
J.migrateLyricCompositing = project => {
  const media = project.media;
  if (!media || (media.blend === 'normal' && media.opacity === 100)) return;
  const blend = J.LYRIC_BLENDS.includes(media.blend) ? media.blend : 'normal';
  const opacity = percent(media.opacity, 100);
  const options = project.lyricCutOptions || (project.lyricCutOptions = {});
  for (const cut of J.plan(project).cuts) if (cut.line >= 0 && Number.isInteger(cut.part)) {
    const key = `${cut.line}:${cut.part}`;
    options[key] = { blend, opacity, ...options[key] };
  }
  media.blend = 'normal'; media.opacity = 100;
};

// Use the actual fitted source rectangle, including its rotation. Coordinates are
// normalized to the stage; rotation is calculated in pixels to preserve aspect.
J.foregroundBounds = (project, plan, cut) => {
  if (!cut.itemId) return null;
  const item = project.foreground?.items?.find(item => item.id === cut.itemId);
  if (!item) return null;
  const source = J.mediaAssets?.get(cut.itemId)?.element;
  const sw = source && (source.videoWidth || source.naturalWidth || source.width) || item.width || plan.W;
  const sh = source && (source.videoHeight || source.naturalHeight || source.height) || item.height || plan.H;
  const r = !cut.placement && cut.layout === 'cover' ? { x: 0, y: 0, w: 1, h: 1 }
    : J.mediaPlacementRect(cut.placement, sw, sh, plan.W, plan.H);
  if (!r) return null;
  const a = (cut.placement?.angle || 0) * J.DEG, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const w = r.w * c + r.h * plan.H / plan.W * s;
  const h = r.h * c + r.w * plan.W / plan.H * s;
  return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h };
};

const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

function emptyRegions(obstacles) {
  let regions = [{ x: .025, y: .025, w: .95, h: .95 }];
  for (const b of obstacles) {
    const next = [];
    for (const a of regions) {
      if (!overlap(a, b)) { next.push(a); continue; }
      const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w);
      const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h);
      next.push({ x: a.x, y: a.y, w: x0 - a.x, h: a.h },
        { x: x1, y: a.y, w: a.x + a.w - x1, h: a.h },
        { x: x0, y: a.y, w: x1 - x0, h: y0 - a.y },
        { x: x0, y: y1, w: x1 - x0, h: a.y + a.h - y1 });
    }
    // Bound work even for a lyric spanning hundreds of foreground cuts.
    regions = next.filter(r => r.w >= .04 && r.h >= .04).sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 64);
    if (!regions.length) break;
  }
  return regions;
}

J.emptyRegions = emptyRegions;
// context: { zone, fgCenter } from the scene's foreground composition (optional).
// The scene around a lyric cut: the composition zone of the foreground it shares the most time with,
// and the centre of the foregrounds shown with it.
// bgScenes: dynamic background layouts (window zone and centre); they guide the lyrics when no foreground is shown.
J.lyricScene = (cut, bounds, end = cut.end, bgScenes = []) => {
  const shared = bounds.filter(({ cut: f, box }) => box && f.start < end && f.end > cut.start)
    .map(entry => ({ ...entry, time: Math.min(entry.cut.end, end) - Math.max(entry.cut.start, cut.start) }));
  if (!shared.length) {
    const layouts = bgScenes.filter(s => (s.zone || s.center) && s.start < end && s.end > cut.start)
      .map(s => ({ s, time: Math.min(s.end, end) - Math.max(s.start, cut.start) }));
    if (!layouts.length) return {};
    const { s } = layouts.reduce((a, b) => b.time > a.time ? b : a);
    return { zone: s.zone || null, fgCenter: s.center || null, composition: 'layout:' + s.id };
  }
  const main = shared.reduce((a, b) => b.time > a.time ? b : a), comp = J.COMPOSITION_BY_ID?.[main.cut.composition];
  const weight = shared.reduce((sum, e) => sum + e.time, 0) || 1;
  const fgCenter = { x: shared.reduce((s, e) => s + (e.box.x + e.box.w / 2) * e.time, 0) / weight, y: shared.reduce((s, e) => s + (e.box.y + e.box.h / 2) * e.time, 0) / weight };
  let zone = main.cut.compositionZone || comp?.zone || null;
  // Cropped-edge sources grow with their aspect ratio (opposite edges can make a tall band); when the
  // designed zone ends up covered, use the largest strip the foreground leaves free.
  if (comp?.cropped && zone && overlap(zone, main.box) > .25 * zone.w * zone.h) {
    const b = main.box, m = .04, strips = [
      { x: m, y: m, w: b.x - 2 * m, h: 1 - 2 * m }, { x: b.x + b.w + m, y: m, w: 1 - b.x - b.w - 2 * m, h: 1 - 2 * m },
      { x: m, y: m, w: 1 - 2 * m, h: b.y - 2 * m }, { x: m, y: b.y + b.h + m, w: 1 - 2 * m, h: 1 - b.y - b.h - 2 * m },
    ].filter(s => s.w >= .12 && s.h >= .12);
    if (strips.length) zone = strips.reduce((a, s) => s.w * s.h > a.w * a.h ? s : a);
  }
  return { zone, fgCenter, composition: comp?.id || null };
};
// Emphasised lyrics (*…*) on the full stage are drawn larger; automatic areas express the size instead.
J.EMPHASIS_TEXT_SCALE = 1.15;
// Suppressed lyrics (~…~) are smaller but never below a readable area.
J.SUPPRESSED_TEXT_SCALE = .7;
J.SUPPRESSED_MIN_AREA = { w: .3, h: .17 };
// Emphasis over a foreground: a large lyric laid over the foreground (drawn in front of it), or a large
// lyric balancing it from the opposite side. Neither is shrunk into the composition's lyric zone.
const emphasisOverForeground = (cut, plan, context, rng) => {
  const portrait = plan.W < plan.H, margin = .03, f = context.fgCenter;
  if (context.composition === J.EMPHASIS_COMPOSITION?.id) {
    // Both large: the lyric spans the stage over the large foreground.
    const w = rng.range(.86, .94), h = portrait ? rng.range(.46, .62) : rng.range(.66, .86);
    cut.lyricPattern = 'bothLarge';
    return { x: (1 - w) / 2 + rng.range(-1, 1) * Math.min(.02, (1 - w) / 2 - margin), y: J.clamp(f.y - h / 2, margin, 1 - margin - h), w, h, angle: 0, lockAspect: true };
  }
  if (rng() < .6) {
    const w = portrait ? rng.range(.86, .94) : rng.range(.78, .94), h = portrait ? rng.range(.42, .6) : rng.range(.56, .8), pull = rng.range(.55, 1);
    const cx = .5 + (f.x - .5) * pull, cy = .5 + (f.y - .5) * pull;
    cut.lyricPattern = 'overlay';
    return { x: J.clamp(cx - w / 2, margin, 1 - margin - w), y: J.clamp(cy - h / 2, margin, 1 - margin - h), w, h, angle: 0, lockAspect: true };
  }
  const w = portrait ? rng.range(.8, .94) : rng.range(.66, .86), h = portrait ? rng.range(.36, .5) : rng.range(.5, .7);
  cut.lyricPattern = 'counter';
  return J.composeLyricArea?.(cut, { w, h, obstacles: [], fgCenter: f, fixedSize: true }) || { x: (1 - w) / 2, y: (1 - h) / 2, w, h, angle: 0, lockAspect: true };
};
J.autoLyricArea = (cut, plan, obstacles = [], settings = J.lyricEffectSettings({}), context = {}) => {
  const rng = J.rng(J.h(J.placementSeed ? J.placementSeed(cut) : cut.seed, 947));
  delete cut.lyricPattern;
  // 「画面中央を避ける」 keeps the stage centre clear like an obstacle; *emphasis* may still use it.
  const safeArea = context.safeArea;
  const avoidCenter = safeArea?.region || settings.avoidCenter && !cut.emphasis && J.CENTER_AVOID;
  const blockers = avoidCenter ? [...obstacles, avoidCenter] : obstacles;
  if(cut.lyricSize != null){
    const size=Math.max(.04,cut.lyricSize/100),candidates=[];
    // The notation fixes the size; only the position is composed.
    const composed = J.composeLyricArea?.(cut, { w: size, h: size, obstacles: blockers, zone: context.zone, fgCenter: context.fgCenter, fixedSize: true });
    if (composed) return composed;
    // Explicit sizes override random size bounds and obstacle-driven shrinking.
    for(const x of [0,.25,.5,.75,1])for(const y of [0,.25,.5,.75,1]){
      const r={x:x*(1-size),y:y*(1-size),w:size,h:size,angle:0,lockAspect:true};
      candidates.push({r,score:blockers.reduce((sum,b)=>sum+overlap(r,b),0)});
    }
    const best=Math.min(...candidates.map(c=>c.score));
    return rng.pick(candidates.filter(c=>c.score<=best+1e-8)).r;
  }
  const portrait = plan.W < plan.H;
  if (cut.emphasis && context.fgCenter && !safeArea) return emphasisOverForeground(cut, plan, context, rng);
  let w = cut.emphasis ? rng.range(.82, .95) : cut.suppressed ? rng.range(.34, .46) : rng.range(.48, .72);
  let h = cut.emphasis ? rng.range(.7, .92) : cut.suppressed ? rng.range(.24, .34) : rng.range(.4, .62);
  if (portrait && !cut.emphasis) { w = Math.min(.9, w * 1.2); h *= .8; }
  // Size contrast comes from the placement pattern: a lyric-only zone, or the composition zone's size.
  const solo = (safeArea || !obstacles.length && !context.zone) && J.pickSoloZone ? J.pickSoloZone(cut, { avoidCenter: !!avoidCenter, safeArea }) : null;
  const zone = safeArea ? solo?.zone : context.zone || solo?.zone, room = zone ? zone.w * zone.h : 1;
  const weights = solo?.size || (room < .12 ? [.7, .3, 0] : room < .3 ? [.35, .5, .15] : undefined);
  const scale = J.lyricSizeScale ? J.lyricSizeScale(cut, rng, weights) : 1;
  const fitScale = Math.min(scale, .94 / w, .94 / h);// large classes still keep the 3% margins
  w = Math.max(.04, w * fitScale); h = Math.max(.04, h * fitScale);
  // A strip beside the kept-clear centre: fit the area to the strip instead of shrinking it uniformly.
  if (avoidCenter && solo) { w = Math.min(w, solo.zone.w); h = Math.min(h, solo.zone.h); }
  const minSize = cut.suppressed ? (safeArea ? {w: Math.min(J.SUPPRESSED_MIN_AREA.w, zone.w), h: Math.min(J.SUPPRESSED_MIN_AREA.h, zone.h)} : J.SUPPRESSED_MIN_AREA) : null;
  if (minSize) { w = Math.max(w, minSize.w); h = Math.max(h, minSize.h); }
  // Designed placement: aligned anchors scored for the scene's composition zone, the foreground and balance.
  // Emphasis keeps its size rather than shrinking into the zone.
  const composed = J.composeLyricArea?.(cut, { w, h, obstacles: blockers, zone, fgCenter: context.fgCenter, fixedSize: !!cut.emphasis && !obstacles.length && !safeArea, minSize });
  if (composed) return composed;
  let regions = emptyRegions(blockers);
  // A suppressed lyric keeps its minimum size: with no free region that large it takes the least covered
  // position below instead of shrinking into a narrow strip.
  if (minSize) regions = regions.filter(r => Math.min(w, r.w) >= minSize.w && Math.min(h, r.h) >= minSize.h);
  if (regions.length) {
    const candidates = regions.map(r => ({ r, w: Math.min(w, r.w), h: Math.min(h, r.h) }));
    const best = Math.max(...candidates.map(c => c.w * c.h));
    const fit = rng.pick(candidates.filter(c => c.w * c.h >= best * .8));
    w = fit.w; h = fit.h;
    const x = fit.r.x + rng.pick([0, .5, 1]) * (fit.r.w - w);
    const y = fit.r.y + rng.pick([0, .5, 1]) * (fit.r.h - h);
    return { x, y, w, h, angle: 0, lockAspect: true };
  }
  // A full-stage foreground can leave no empty rectangle. Keep the lyric
  // readable in the least covered candidate instead of generating a zero area.
  // With 「画面中央を避ける」 the centre outweighs the foreground, and areas fitted into the strips around
  // the centre are candidates too.
  const candidates = [], score = r => obstacles.reduce((sum, b) => sum + overlap(r, b), 0) + (avoidCenter ? 10 * overlap(r, avoidCenter) : 0);
  for (const x of [0, .25, .5, .75, 1]) for (const y of [0, .25, .5, .75, 1]) {
    const r = { x: .025 + x * (.95 - w), y: .025 + y * (.95 - h), w, h, angle: 0, lockAspect: true };
    candidates.push({ r, score: score(r) });
  }
  if (avoidCenter) for (const strip of emptyRegions([avoidCenter])) {
    const cw = Math.min(w, strip.w), ch = Math.min(h, strip.h);
    if (cw < .04 || ch < .04) continue;
    for (const fx of [0, .5, 1]) for (const fy of [0, .5, 1]) {
      const r = { x: strip.x + fx * (strip.w - cw), y: strip.y + fy * (strip.h - ch), w: cw, h: ch, angle: 0, lockAspect: true };
      candidates.push({ r, score: score(r) + .001 * (w * h - cw * ch) });
    }
  }
  // QF's character region is a hard constraint for automatic candidates even
  // when the foreground fills the stage; other obstacles remain preferences.
  const eligible = safeArea ? candidates.filter(c => overlap(c.r, safeArea.region) <= 1e-9) : candidates;
  const min = Math.min(...eligible.map(c => c.score));
  return rng.pick(eligible.filter(c => c.score <= min + 1e-8)).r;
};

J.finishLyricPlan = (project, plan, audio) => {
  const groups = new Map();
  for (const cut of plan.cuts) if (cut.group != null && Number.isInteger(cut.part)) {
    if (!groups.has(cut.group)) groups.set(cut.group, []);
    groups.get(cut.group).push(cut);
  }
  // 1シーン: every cut of the group ends with its last cut (unless given its own end time). Placement below
  // still uses each cut's own slot; the ends are extended at the end.
  plan.retainedCutIndices = [];
  for (const cuts of groups.values()) {
    const last = cuts[cuts.length - 1];
    for (const cut of cuts) {
      cut.displayEnd = cut.manualEnd ? cut.end : last.end;
      if (!cut.manualEnd) { cut.groupExit = last.exit; cut.groupOutDur = last.outDur; }
      plan.retainedCutIndices.push(cut.index);
    }
  }
  const settings = J.lyricEffectSettings(project);
  const safeArea = J.quizForest?.safeAreaSettings(project);
  // The foreground's composition guides lyric placement; avoidance additionally turns it into obstacles.
  const foreground = settings.autoPlacement && J.planMedia
    ? J.planMedia(project, plan, audio?.duration, 'foreground') : null;
  const bounds = foreground ? foreground.cuts.filter(cut => cut.opacity > 0).map(cut => ({ cut, box: J.foregroundBounds(project, plan, cut) })) : [];
  const bgScenes = settings.autoPlacement && J.backgroundScenes ? J.backgroundScenes(project, plan, audio?.duration) : [];
  for (const cut of plan.cuts) {
    if (cut.line < 0 || !Number.isInteger(cut.part)) continue;
    Object.assign(cut, J.lyricComposite(project, cut, settings));
    const placementSeed = project.lyricCutOptions?.[`${cut.line}:${cut.part}`]?.placementSeed;
    if (Number.isFinite(placementSeed)) cut.placementSeed = placementSeed;
    cut.areaMode = cut.area ? 'manual' : 'default';
    if (cut.area || !settings.autoPlacement) continue;
    const locked = project.overrides?.[cut.line];
    const lockedArea = locked?.lock && locked.lockedAreas?.[cut.part];
    if (lockedArea !== undefined && lockedArea !== false) {
      cut.area = J.lyricArea(lockedArea);
      cut.areaMode = cut.area ? 'auto' : 'default';
    } else {
      // Retention extends rendering only. Place each cut using its own time slot
      // so later foregrounds do not force a whole group into one shared area.
      const scene = J.lyricScene(cut, bounds, cut.end, bgScenes);
      const avoiding = !(cut.emphasis || !settings.avoidForeground || settings.avoidanceStrength === 0);
      const padded = box => {
        const s = settings.avoidanceStrength;
        // Lower strengths allow overlap around the foreground's perimeter.
        const w = (box.w + .04) * s, h = (box.h + .04) * s;
        return { x: box.x + box.w / 2 - w / 2, y: box.y + box.h / 2 - h / 2, w, h };
      };
      // The foreground and the dynamic background's window are kept clear alike.
      const obstacles = !avoiding ? [] : [
        ...bounds.filter(({ cut: f, box }) => box && f.start < cut.end && f.end + .6 > cut.start).map(({ box }) => padded(box)),
        ...bgScenes.filter(b => b.start < cut.end && b.end + .6 > cut.start).flatMap(b => b.boxes).map(padded),
      ];
      const keepPlacement = safeArea && J.quizForest.keepPlacement(project, cut);
      cut.area = J.autoLyricArea(cut, plan, obstacles, settings, {...scene, safeArea: keepPlacement ? null : safeArea});
      cut.areaMode = keepPlacement ? 'manual' : 'auto';
    }
    // An automatic area already carries the strength; the text scale is for the full-stage default.
    if (cut.area && (cut.emphasis && cut.contentScale === J.EMPHASIS_TEXT_SCALE || cut.suppressed && cut.contentScale === J.SUPPRESSED_TEXT_SCALE)) cut.contentScale = 1;
    // Some layouts choose columns or orientation during planning. Give those
    // choices the resolved area dimensions as well as using them at render time.
    if (cut.area && J.LAYOUTS[cut.layout]?.plan) {
      cut.params = J.LAYOUTS[cut.layout].plan(J.rng(J.h(cut.seed, 318)), {
        text: cut.text, n: [...cut.text.replace(/\s/g, '')].length,
        W: plan.W * cut.area.w, H: plan.H * cut.area.h, dur: cut.dur,
      }, plan.style);
      if (cut.text.includes('\n')) cut.params.sx = 1;
    }
  }
  for (const index of plan.retainedCutIndices) {
    const cut = plan.cuts[index];
    // slotEnd keeps the cut's own slot (what placement used) once its end follows the group.
    if (cut.displayEnd > cut.end) { cut.slotEnd = cut.end; cut.end = cut.displayEnd; cut.dur = cut.end - cut.start; }
  }
  // Manual areas use the same layout seed and retained duration as automatic areas.
  // Moving a cut therefore keeps its layout variants; resizing only refits its geometry.
  for(const cut of plan.cuts)if(cut.areaMode==='manual' && cut.area && J.LAYOUTS[cut.layout]?.plan){
    cut.params=J.LAYOUTS[cut.layout].plan(J.rng(J.h(cut.seed,318)),{
      text:cut.text,n:[...cut.text.replace(/\s/g,'')].length,
      W:plan.W*cut.area.w,H:plan.H*cut.area.h,dur:cut.dur,
    },plan.style);
    if(cut.text.includes('\n'))cut.params.sx=1;
    if(cut.emphasis&&cut.contentScale===J.EMPHASIS_TEXT_SCALE||cut.suppressed&&cut.contentScale===J.SUPPRESSED_TEXT_SCALE)cut.contentScale=1;
  }

};

// Resolve retained groups once at plan time: seeking never moves earlier lyrics.
// Pack rotated display areas rather than stretching text or changing timeline times.
J.applyLyricGroupAvoidance = (project, plan) => {
  const settings=J.lyricEffectSettings(project),strength=settings.lyricAvoidanceStrength;
  const safeArea=settings.autoPlacement && J.quizForest?.safeAreaSettings(project);
  const centerRegion=safeArea?.region || settings.autoPlacement&&settings.avoidCenter&&J.CENTER_AVOID;
  const groups=new Map(),shared=new Map();
  for(const cut of plan.cuts)if(cut.group!=null && Number.isInteger(cut.part) && !cut.effectsOnly){
    const into=cut.avoidOverlap?groups:shared;
    if(!into.has(cut.group))into.set(cut.group,[]);into.get(cut.group).push(cut);
  }
  // Several lyrics shown together are composed as one designed scene (08eb): sized from their text and role,
  // laid out inside what the foreground and the background window leave free. Manual areas are left alone.
  const bgScenes=settings.autoPlacement&&J.backgroundScenes?J.backgroundScenes(project,plan,null):[];
  const fgPlan=settings.autoPlacement ? J.planMedia(project,plan,null,'foreground') : null;
  const avoiding=settings.avoidForeground&&settings.avoidanceStrength>0;
  const foreground=avoiding ? fgPlan : null;
  const fgBounds=fgPlan?.opacity>0 ? fgPlan.cuts.map(f=>({cut:f,box:J.foregroundBounds(project,plan,f)})) : [];
  const lockedCut=c=>!!project.overrides?.[c.line]?.lock;
  const arranged=(cuts,maxOverlap)=>{
    if(!J.composeLyricScene)return null;
    // Locking a line must not move the others: when the scene composed with the locked lines still in it puts them
    // where they are locked, that composition stands. Otherwise they are fixed obstacles the rest is composed around.
    const whole=compose(cuts,maxOverlap,c=>c.areaMode==='manual');
    const near=(a,b)=>a&&b&&['x','y','w','h'].every(k=>Math.abs(a[k]-b[k])<.002);
    if(whole&&whole.cuts.every((c,i)=>!lockedCut(c)||near(whole.rects[i],c.area)))return whole;
    return compose(cuts,maxOverlap,c=>lockedCut(c)||c.areaMode==='manual');
  };
  const compose=(cuts,maxOverlap,fixedCut)=>{
    // A hand-set area (or a locked line) stays exactly where it is; the other lyrics are composed around it.
    const start=cuts[0].start,end=cuts.at(-1).displayEnd,free=cuts.filter(c=>!fixedCut(c));
    if(free.length<2)return null;
    const grown=(b,k)=>{const w=b.w*k,h=b.h*k;return {x:b.x+b.w/2-w/2,y:b.y+b.h/2-h/2,w,h};};
    const obstacles=[];
    if(avoiding){
      for(const f of fgBounds)if(f.box&&f.cut.start<end&&f.cut.end>start)obstacles.push(grown(f.box,settings.avoidanceStrength));
      for(const b of bgScenes)if(b.start<end&&b.end>start)for(const box of b.boxes)obstacles.push(grown(box,settings.avoidanceStrength));
    }
    for(const c of cuts)if(fixedCut(c)&&c.area)obstacles.push(c.area);
    if(centerRegion)obstacles.push(centerRegion);
    const scene=J.lyricScene?J.lyricScene(cuts[0],fgBounds,end,bgScenes):{};
    const result=J.composeLyricScene(free,{aspect:plan.W/plan.H,seed:J.placementSeed?J.placementSeed(cuts[0]):cuts[0].seed,maxOverlap,obstacles,zone:scene.zone,center:scene.fgCenter,hardAvoid:safeArea?.region});
    return result&&{...result,cuts:free};
  };
  const assign=(cut,area,mode)=>{
    if(project.overrides?.[cut.line]?.lock)return;// locked lines keep their area
    // Blending between a safe left and safe right arrangement can pass through
    // the middle. Keep the existing safe area in that case instead of crossing.
    if(safeArea && overlap(area,safeArea.region)>1e-9)return;
    cut.area=area;cut.areaMode=mode;
    if(cut.emphasis&&cut.contentScale===J.EMPHASIS_TEXT_SCALE||cut.suppressed&&cut.contentScale===J.SUPPRESSED_TEXT_SCALE)cut.contentScale=1;
    const layout=J.LAYOUTS[cut.layout];
    if(layout?.plan)cut.params=layout.plan(J.rng(J.h(cut.seed,318)),{
      text:cut.text,n:[...cut.text.replace(/\s/g,'')].length,W:plan.W*cut.area.w,H:plan.H*cut.area.h,dur:cut.dur,
    },plan.style);
    if(cut.text.includes('\n'))cut.params.sx=1;
    const customParams=project.lyricCutOptions?.[`${cut.line}:${cut.part}`]?.details?.params;
    if(customParams && typeof customParams==='object')Object.assign(cut.params,customParams);
  };
  // 1シーン (overlap allowed): with automatic placement, spread the lyrics along an arrangement rather
  // than piling them up in the middle; up to a third of the smaller area may still overlap.
  if(settings.autoPlacement)for(const cuts of shared.values()){
    if(cuts.length<2)continue;
    const result=arranged(cuts,.33);
    if(result)result.cuts.forEach((cut,i)=>{assign(cut,{...(cut.area||{angle:0,lockAspect:true}),...result.rects[i]},'auto');cut.arrangement=result.name;});
  }
  if(strength===0)return;
  const bounds=area=>{
    const angle=(area.angle||0)*J.DEG,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
    const w=area.w*c+area.h*plan.H/plan.W*s,h=area.h*c+area.w*plan.W/plan.H*s;
    return {x:area.x+area.w/2-w/2,y:area.y+area.h/2-h/2,w,h};
  };
  for(const cuts of groups.values()){
    if(cuts.length<2)continue;
    const areas=cuts.map(c=>c.area||{x:0,y:0,w:1,h:1,angle:0,lockAspect:true}),boxes=areas.map(bounds);
    // 重ねず1シーン without a foreground: arranged with no overlap; strength blends from the current areas.
    // Hand-set areas always stay as set (even when they overlap each other): the others are composed around them.
    const manual=cuts.filter(c=>c.areaMode==='manual');
    const result=arranged(cuts,0);
    if(result){
      result.cuts.forEach((cut,i)=>{
        const a=cut.area||{x:0,y:0,w:1,h:1,angle:0,lockAspect:true},r=result.rects[i],w=J.lerp(a.w,r.w,strength),h=J.lerp(a.h,r.h,strength);
        const cx=J.lerp(a.x+a.w/2,r.x+r.w/2,strength),cy=J.lerp(a.y+a.h/2,r.y+r.h/2,strength);
        assign(cut,{...a,x:cx-w/2,y:cy-h/2,w,h},'group');cut.arrangement=result.name;
      });
      continue;
    }
    // Nothing to compose: the hand-set areas are the user's choice, so do not re-pack them.
    if(manual.length)continue;
    if(!boxes.some((box,i)=>boxes.slice(i+1).some(other=>overlap(box,other)>1e-8)))continue;
    const obstacles=foreground?.opacity>0?foreground.cuts.filter(f=>f.start<cuts.at(-1).displayEnd&&f.end>cuts[0].start)
      .map(f=>J.foregroundBounds(project,plan,f)).filter(Boolean).map(b=>{
        const w=b.w*settings.avoidanceStrength,h=b.h*settings.avoidanceStrength;
        return {x:b.x+b.w/2-w/2,y:b.y+b.h/2-h/2,w,h};
      }):[];
    if(settings.avoidForeground&&settings.avoidanceStrength>0)for(const b of bgScenes)if(b.start<cuts.at(-1).displayEnd&&b.end>cuts[0].start)for(const box of b.boxes){
      const w=box.w*settings.avoidanceStrength,h=box.h*settings.avoidanceStrength;
      obstacles.push({x:box.x+box.w/2-w/2,y:box.y+box.h/2-h/2,w,h});
    }
    if(centerRegion)obstacles.push(centerRegion);
    let regions=emptyRegions(obstacles);if(!regions.length)regions=[{x:.025,y:.025,w:.95,h:.95}];
    // Free space inside the scene's composition zone comes first (a 20% edge when comparing fits).
    const zone=J.lyricScene?(J.lyricScene(cuts[0],fgBounds,cuts.at(-1).displayEnd,bgScenes).zone):null;
    const clip=r=>{const x=Math.max(r.x,zone.x),y=Math.max(r.y,zone.y),w=Math.min(r.x+r.w,zone.x+zone.w)-x,h=Math.min(r.y+r.h,zone.y+zone.h)-y;return w>=.04&&h>=.04?{x,y,w,h,zone:true}:null;};
    if(zone)regions=[...regions.map(clip).filter(Boolean),...regions];
    const maxW=Math.max(...boxes.map(b=>b.w)),maxH=Math.max(...boxes.map(b=>b.h)),n=cuts.length;
    let best=null;
    // Bounded search even for large lyric groups.
    for(const region of regions)for(const cols of new Set([...Array.from({length:Math.min(n,64)},(_,i)=>i+1),n])){
      const rows=Math.ceil(n/cols),cw=region.w/cols,ch=region.h/rows;
      const scale=Math.min(1,cw*.94/maxW,ch*.94/maxH),rank=scale*(region.zone?1.2:1);
      if(!best||rank>best.rank+1e-9)best={region,cols,rows,cw,ch,scale,rank};
    }
    cuts.forEach((cut,i)=>{
      const a=areas[i],b=best,scale=J.lerp(1,b.scale,strength);
      const cx=J.lerp(a.x+a.w/2,b.region.x+(i%b.cols+.5)*b.cw,strength);
      const cy=J.lerp(a.y+a.h/2,b.region.y+(Math.floor(i/b.cols)+.5)*b.ch,strength);
      assign(cut,{...a,x:cx-a.w*scale/2,y:cy-a.h*scale/2,w:a.w*scale,h:a.h*scale},'group');
    });
  }
};

// Timing/linking uses the original start/end; rendering alone extends a group's
// Every lyric cut shown at t: overlapping cuts (1シーン groups, own end times) are all included.
J.lyricCutsAt = (plan, t) => {
  const inserted=plan.cuts.find(c=>c.insertedAtPlayhead && t>=c.start && t<c.end);
  if(inserted)return [inserted];
  return plan.cuts.filter(c => !c.blank && c.start <= t && t < (c.displayEnd ?? c.end)).sort((a, b) => a.index - b.index);
};
J.lyricRenderCut = cut => cut.displayEnd != null ? Object.assign({}, cut, {
  end: cut.displayEnd, dur: cut.displayEnd - cut.start,
  exit: cut.groupExit ?? cut.exit, outDur: cut.groupOutDur ?? cut.outDur,
}) : cut;
})();
