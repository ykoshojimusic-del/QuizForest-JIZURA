/* Quiz Forest Phases 1–2: opt-in palette, stock effects and central-character priority.
   Registries, parser, timing, AI and video export remain unchanged. */
(() => {
'use strict';
const clone = value => JSON.parse(JSON.stringify(value));
const palette = Object.freeze({
  skyBlue: '#8ED8FF', pink: '#FF8FB8', yellow: '#FFD85A', milkyWhite: '#FFFDF6',
  cream: '#FFF0C9', lavender: '#B9A7FF', mintGreen: '#8EDDB4', darkNavy: '#31405F',
});
// Explicit stock IDs, not mood tags or substring guesses. Unknown/custom additions
// stay outside the QF default pool until their visuals have been reviewed.
const whitelist = Object.freeze(Object.fromEntries(Object.entries({
  style: ['paper', 'magenta', 'rouge', 'mint', 'specimen'],
  layout: ['center', 'mixed', 'labels', 'pill', 'bubble', 'lowerThird', 'arcTop', 'balloons', 'bounceLine', 'elastic', 'ribbon'],
  enter: ['cut', 'pop', 'squashDrop', 'rubber', 'springIn', 'stickerPeel', 'bubbles', 'slideWhole', 'riseMask', 'fadeStagger'],
  hold: ['still', 'float', 'breathe', 'sway', 'jelly', 'drift', 'orbitSmall', 'shimmer'],
  exit: ['cut', 'shrink', 'drift', 'squash', 'peelOff', 'bounceOff', 'balloonOff', 'dissolve'],
  decor: ['heartsStars', 'twinkle', 'confetti', 'musicNotes', 'cloudPuffs', 'bubbles', 'lightLeak', 'bokeh', 'starField', 'polkaPatch'],
  treat: ['none', 'outlineFill', 'softShadow', 'glow', 'sticker', 'gradientV', 'rainbow'],
  bg: ['none', 'cloudLayers', 'bokehBg', 'polka', 'meshBlobs', 'gradientSweep'],
  cam: ['push', 'pullOut', 'floatNoise', 'pendulumSway', 'jelly', 'bounce', 'dollyIn', 'driftDiag'],
  fx: ['starGlint', 'lightSweep', 'ripple'],
  trans: ['wipe', 'clockWipe', 'irisOpen'],
  media: ['dissolve', 'drift', 'pop', 'swing', 'iris', 'pulse', 'beatBounce', 'beatBreathe', 'beatSpring', 'beatSquash', 'beatJelly', 'softBloom', 'lightLeak',
    'enter_fade', 'exit_fade', 'enter_slide', 'exit_slide', 'enter_rise', 'exit_rise', 'enter_shrink', 'exit_shrink',
    'enter_squeezeY', 'exit_squeezeY', 'enter_dropBounce', 'exit_dropBounce', 'enter_elasticZoom', 'exit_elasticZoom',
    'enter_starIris', 'exit_starIris', 'enter_heartIris', 'exit_heartIris',
    'cam_push', 'cam_pullOut', 'cam_floatNoise', 'cam_pendulumSway', 'cam_jelly', 'cam_bounce', 'cam_dollyIn', 'cam_driftDiag'],
}).map(([group, ids]) => [group, Object.freeze(ids)])));
const sets = Object.fromEntries(Object.entries(whitelist).map(([g, ids]) => [g, new Set(ids)]));
const themeIds = new Set(['pop', 'ballad', 'acoustic', 'cute', 'elegant', 'dreamy']);
const active = project => project?.quizForestMode === true;
// Derived from the existing QF flag, not persisted and never assigned to the
// ordinary CENTER_AVOID / CENTER_FREE_ZONES globals.
const safeRegion = Object.freeze({x: .31, y: .16, w: .38, h: .68});
const safeZones = Object.freeze([
  {id: 'left', zone: {x: .03, y: .06, w: .26, h: .88}, weight: 3, size: [.3, .5, .2]},
  {id: 'right', zone: {x: .71, y: .06, w: .26, h: .88}, weight: 3, size: [.3, .5, .2]},
  {id: 'top', zone: {x: .04, y: .035, w: .92, h: .105}, weight: .3, size: [.2, .5, .3]},
  {id: 'bottom', zone: {x: .04, y: .86, w: .92, h: .105}, weight: .3, size: [.2, .5, .3]},
].map(z => Object.freeze({...z, zone: Object.freeze(z.zone), size: Object.freeze(z.size)})));
const safety = Object.freeze({region: safeRegion, zones: safeZones});
let legacyPlacementPass = 0;
const safeAreaSettings = project => active(project) && !legacyPlacementPass ? safety : null;
const keepPlacement = (project, cut) => {
  const line = project.overrides?.[cut.line], options = project.lyricCutOptions?.[`${cut.line}:${cut.part}`];
  // An automatic cache is not a user edit. Explicit sizes keep the existing
  // notation rules, including when too large to fit in the side strips.
  return !!(line?.lock || line?.area || line?.layout || cut.lyricSize != null
    || options?.pastedEffects || options?.details && Object.keys(options.details).length);
};
// Fonts are not effect candidates; every effect group/ID is default-deny in QF.
const allowed = (project, group, id) => !active(project) || group === 'font' || sets[group]?.has(id) === true;
// Existing data has no manual/automatic provenance. Conservatively protect any
// non-default colour state, including stored values whose switches are off.
const hasCustomColors = project => {
  const defaults = {...J.defaultProject().colors, accentOn: false};
  return Object.entries(project.colors || {}).some(([key, value]) => value != null && value !== defaults[key]);
};
const colors = (rnd = () => 0) => {
  const accents = [palette.pink, palette.skyBlue, palette.yellow, palette.lavender, palette.mintGreen];
  const i = Math.min(accents.length - 1, Math.max(0, Math.floor(rnd() * accents.length)));
  return {enabled: true, accentOn: true, allSchemes: true, bg: palette.milkyWhite,
    fg: palette.darkNavy, sub: palette.darkNavy, dim: palette.cream, accent: accents[i],
    accent2: accents[(i + 2) % accents.length], ghostA: accents[(i + 1) % accents.length], ghostB: accents[(i + 3) % accents.length]};
};
const softFx = fx => ({...fx, motion: Math.min(fx?.motion ?? .55, .65), glitch: 0, chroma: 0, flash: false});
function restrictMedia(project, settings) {
  if (!active(project)) return settings;
  settings.enabled = {...settings.enabled}; settings.decorEnabled = {...settings.decorEnabled};
  for (const id of new Set([...Object.keys(J.MEDIA_TECH), ...Object.keys(settings.enabled)])) if (!allowed(project, 'media', id)) settings.enabled[id] = false;
  for (const id of new Set([...J.order('decor'), ...Object.keys(settings.decorEnabled)])) if (!allowed(project, 'decor', id)) settings.decorEnabled[id] = false;
  settings.motion = Math.min(settings.motion, .65);
  return settings;
}
const savedKeys = ['style', 'mood', 'themes', 'themeBalance', 'colors', 'colorTheme', 'fx', 'enabled', 'fonts'];
J.quizForest = {palette, whitelist, active, allowed, colors, safeAreaSettings, keepPlacement,
  themeAllowed: (project, id) => !active(project) || themeIds.has(id),
  activate(project) {
    if (!active(project)) {
      project.quizForestPrevious = {values: clone(Object.fromEntries(savedKeys.map(k => [k, project[k]]))),
        mediaEffects: Object.fromEntries(['media', 'foreground'].map(layer => [layer, clone(J.mediaEffectSettings(project, layer))]))};
    }
    project.quizForestMode = true;
    project.style = 'paper'; project.mood = 'pop'; project.themes = ['cute'];
    if (!hasCustomColors(project)) project.colors = colors();
    project.fx = {...softFx(project.fx), texture: 0, decor: .25};
    project.enabled = Object.fromEntries(J.GROUP_KEYS.map(group => [group,
      Object.fromEntries(J.order(group).map(id => [id, allowed(project, group, id)]))]));
    for (const layer of ['media', 'foreground']) project[layer].effects = restrictMedia(project, J.mediaEffectSettings(project, layer));
    // No timing, content, cut overrides, placement, locks or output settings are touched.
    return project;
  },
  deactivate(project) {
    const previous = project.quizForestPrevious;
    delete project.quizForestMode; delete project.quizForestPrevious;
    if (previous?.values) Object.assign(project, clone(previous.values));
    if (previous?.mediaEffects) for (const layer of ['media', 'foreground']) project[layer].effects = clone(previous.mediaEffects[layer]);
    return project;
  },
};
const randomOk = J.randomOk;
J.randomOk = (project, group, id) => allowed(project, group, id) && randomOk(project, group, id);
const mediaSettings = J.mediaEffectSettings;
J.mediaEffectSettings = (project, layer) => restrictMedia(project, mediaSettings(project, layer));
const randomMediaSettings = J.randomMediaEffectSettings;
J.randomMediaEffectSettings = (project, layer, rnd) => {
  const settings = restrictMedia(project, randomMediaSettings(project, layer, rnd));
  if (active(project) && !Object.entries(settings.enabled).some(([id, on]) => on && !J.MEDIA_TECH[id]?.stage)) settings.enabled.drift = true;
  return settings;
};
const candidates = J.themeCandidates;
J.themeCandidates = (project, key) => {
  const pool = candidates(project, key);
  if (!active(project) || !pool) return pool;
  return {...pool,
    lyrics: Object.fromEntries(Object.entries(pool.lyrics).map(([group, ids]) => [group, ids.filter(id => allowed(project, group, id))])),
    media: pool.media.filter(id => allowed(project, 'media', id))};
};
const ids = J.themeIds;
J.themeIds = project => ids(project).filter(id => J.quizForest.themeAllowed(project, id));
const colorActive = J.colorThemeActive;
J.colorThemeActive = project => active(project) || colorActive(project);
const themedPalette = J.themedPalette;
J.themedPalette = (project, style, rnd, current) => active(project) ? colors(rnd) : themedPalette(project, style, rnd, current);
// The existing randomizer still does all planning. QF only chooses a gentle mood
// and clips its output settings to the opt-in palette/candidate policy.
const omakase = J.omakase;
J.omakase = (project, rnd = Math.random, choices = {}) => {
  const result = omakase(project, rnd, active(project) ? {...choices, mood: 'pop'} : choices);
  if (!active(project)) return result;
  for (const [group, entries] of Object.entries(result.enabled))
    for (const id of Object.keys(entries)) if (!allowed(project, group, id)) entries[id] = false;
  result.fx = softFx(result.fx); result.colors = colors(rnd);
  for (const layer of ['media', 'foreground']) if (result[layer]) result[layer].effects = restrictMedia(project, result[layer].effects);
  return result;
};
// Settings-only presets carry the mode just as complete project files do;
// the file format, parser and binary writer themselves are not changed.
const projectSettings = J.projectSettings;
J.projectSettings = project => {
  const result = projectSettings(project);
  if (active(project)) {
    result.quizForestMode = true;
    if (project.quizForestPrevious) result.quizForestPrevious = clone(project.quizForestPrevious);
  }
  return result;
};
const applySettings = J.applyProjectSettings;
J.applyProjectSettings = (current, source) => {
  const result = applySettings(current, source);
  if (active(source)) {
    result.quizForestMode = true;
    if (source.quizForestPrevious) result.quizForestPrevious = clone(source.quizForestPrevious);
    else delete result.quizForestPrevious;
  } else { delete result.quizForestMode; delete result.quizForestPrevious; }
  return result;
};
// Cut-owned automatic effects use the same existing display-area clip as the
// lyric. Hand-edited/locked effects keep their original full-frame behaviour.
const planLyrics = J.plan;
J.plan = (project, ...args) => {
  const plan = planLyrics(project, ...args);
  if (legacyPlacementPass || !active(project) || !J.lyricEffectSettings(project).autoPlacement) return plan;
  const protectedCuts = plan.cuts.filter(c => c.line >= 0 && Number.isInteger(c.part) && keepPlacement(project, c));
  if (protectedCuts.length) {
    // A hand-picked layout may belong to an arranged group without a saved area.
    // Reuse the unmodified placement rules to recover its complete geometry;
    // marking its initial per-cut area manual alone would break that arrangement.
    let reference;
    legacyPlacementPass++;
    try { reference = planLyrics(project, ...args); } finally { legacyPlacementPass--; }
    const previous = new Map(reference.cuts.map(c => [`${c.line}:${c.part}`, c]));
    for (const cut of protectedCuts) {
      const original = previous.get(`${cut.line}:${cut.part}`);
      if (!original) continue;
      for (const key of ['area', 'params', 'contentScale', 'arrangement', 'lyricPattern']) {
        if (original[key] === undefined) delete cut[key]; else cut[key] = clone(original[key]);
      }
      cut.areaMode = cut.area ? 'manual' : original.areaMode;
    }
    // Automatic neighbours compose around these preserved areas. This reuses
    // the existing manual-area/lock-aware group solver and never edits project data.
    J.applyLyricGroupAvoidance(project, plan);
  }
  // A plan-only lookup, not event data: cached effects/favorites must not carry
  // the QF clip into a normal-mode plan or a later explicit placement.
  plan.qfEffectAreas = Object.fromEntries(plan.cuts
    .filter(c => c.line >= 0 && Number.isInteger(c.part) && c.area && c.areaMode !== 'manual' && !keepPlacement(project, c))
    .map(c => [`${c.line}:${c.part}`, {...c.area}]));
  return plan;
};
})();
