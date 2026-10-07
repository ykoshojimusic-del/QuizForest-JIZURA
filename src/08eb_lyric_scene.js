/* 1シーン / 重ねず1シーン: composing several lyrics shown together as one designed scene.
   Every lyric cut is a text block sized from its own characters and its role (強調 larger, 抑制 smaller); the
   blocks are laid out by many composition templates (stacks, staircases, zigzag, wave, columns, poster-style
   justified rows, hero with supporting lines, corners, ring, split across two free regions…) inside the free
   regions the foreground and the background window leave, and the best-scoring candidate wins: the largest
   readable type, a clean hierarchy, alignment, reading order, balance against the foreground, no collisions.
   The score picks among the near-best at random (seeded), so every scene differs and 配置をシャッフル re-rolls it.
   All lengths below are in stage heights (SH) unless they are "em at font factor 1". */
(() => {
'use strict';
const clamp = J.clamp, EPS = 1e-9;
// Font size limits: never a huge single word, never unreadable. Given for the stage's shorter side; a portrait
// stage scales them down by its aspect (composeLyricScene sets the working values in stage heights).
let FMAX = .34, FMIN = .05, FRELAX = .036;
const LINE = 1.22, PAD = 1.08;       // line height and box padding around the text
const GAP_X = .34, GAP_Y = .26;      // gaps between blocks (em)
const CLASS = { emphasis: 1.55, soft: .68, normal: 1 };
const MARGIN = .03;

// ---------------------------------------------------------------------------------------------- text blocks
const emOf = ch => /[!-~]/.test(ch) ? (/[A-Z0-9%&@#WM]/.test(ch) ? .68 : /[ijl.,;:'!|`]/.test(ch) ? .3 : .55) : /[｡-ﾟ]/.test(ch) ? .55 : 1;
const measure = text => {
  const rows = String(text || '').split('\n').map(r => [...r.replace(/\s+/g, '')]).filter(r => r.length);
  if (!rows.length) return { em: 1, lines: 1, n: 1 };
  return { em: Math.max(...rows.map(r => r.reduce((s, c) => s + emOf(c), 0))), lines: rows.length, n: rows.reduce((s, r) => s + r.length, 0) };
};
const makeUnits = cuts => cuts.map((cut, i) => {
  const m = measure(cut.text), cls = cut.emphasis ? 'emphasis' : cut.suppressed ? 'soft' : 'normal';
  // Short words carry a little more weight per character than long phrases.
  return { i, cut, ...m, cls, line: cut.line, cf: CLASS[cls], r0: clamp(1.28 - .045 * m.n, .84, 1.28) };
});
// The size factor of a unit: its class (強調 / 抑制) softened by `contrast` (1 = full; less in crowded scenes,
// where the small ones would otherwise become unreadable), times the length factor.
const rOf = (u, contrast) => (1 + (u.cf - 1) * contrast) * u.r0;
// A block at font factor 1. Long single-line text may wrap onto two lines once its width passes wrapAt (em).
const blockOf = (u, wrapAt, contrast = 1) => {
  const r = rOf(u, contrast);
  let L = u.lines, width = u.em;
  if (L === 1 && u.n >= 7 && u.em * r > wrapAt) { L = 2; width = u.em / 2 * 1.12; }
  return { i: u.i, w: width * r * PAD, h: L * LINE * r * PAD, f: r, cls: u.cls };
};

// ---------------------------------------------------------------------------------------------- flow layouts (em space)
const scaled = (b, s) => ({ ...b, w: b.w * s, h: b.h * s, f: b.f * s });
// Rows of blocks wrapped at `width`, aligned as o.align; o.justify scales every row to the widest one.
const flow = (blocks, o) => {
  const gx = o.gx, gy = o.gy, rows = [];
  let cur = [], cw = 0;
  for (const b of blocks) {
    if (cur.length && cw + gx + b.w > o.width + EPS) { rows.push(cur); cur = []; cw = 0; }
    cw += (cur.length ? gx : 0) + b.w; cur.push(b);
  }
  if (cur.length) rows.push(cur);
  let R = rows.map(row => ({ row, gx, w: row.reduce((s, b) => s + b.w, 0) + gx * (row.length - 1), h: Math.max(...row.map(b => b.h)) }));
  if (o.justify && R.length > 1) {
    const target = Math.max(...R.map(r => r.w));
    R = R.map(r => {
      const s = r.row.some(b => b.cls === 'soft') ? 1 : clamp(target / r.w, 1, 1.5);
      return { row: r.row.map(b => scaled(b, s)), gx: r.gx * s, w: r.w * s, h: r.h * s };
    });
  }
  const cw0 = Math.max(...R.map(r => r.w)), step = (o.step ?? .5) * (R.reduce((s, r) => s + r.h, 0) / R.length), n = R.length;
  const offsetOf = (r, i) => {
    const free = cw0 - r.w;
    switch (o.align) {
      case 'left': return 0;
      case 'right': return free;
      case 'alt': return i % 2 ? free : 0;
      case 'stair': return i * step;
      case 'stairR': return (n - 1 - i) * step;
      case 'wave': return free * (.5 + .5 * Math.sin(i * 1.35 + (o.phase || 0)));
      default: return free / 2;
    }
  };
  const gyEff = o.tight ? -.17 * (R.reduce((s, r) => s + r.h, 0) / n) : gy;
  const items = []; let y = 0, width = 0;
  R.forEach((r, i) => {
    let x = offsetOf(r, i); width = Math.max(width, x + r.w);
    for (const b of r.row) { items.push({ i: b.i, x, y: y + (r.h - b.h) / 2, w: b.w, h: b.h, f: b.f }); x += b.w + r.gx; }
    y += r.h + gyEff;
  });
  return { items, w: width, h: y - gyEff, rows: R.map(r => r.row.length).join('.') };
};
// Columns filled top to bottom, then the next column; o.height wraps them.
const columns = (blocks, o) => {
  const cols = []; let cur = [], ch = 0;
  for (const b of blocks) {
    if (cur.length && ch + o.gy + b.h > o.height + EPS) { cols.push(cur); cur = []; ch = 0; }
    ch += (cur.length ? o.gy : 0) + b.h; cur.push(b);
  }
  if (cur.length) cols.push(cur);
  const items = []; let x = 0, height = 0;
  const C = cols.map(col => ({ col, w: Math.max(...col.map(b => b.w)), h: col.reduce((s, b) => s + b.h, 0) + o.gy * (col.length - 1) }));
  C.forEach((c, ci) => {
    const drop = o.stagger ? o.stagger * (ci % 2) * c.h / Math.max(1, c.col.length) : 0;
    let y = drop;
    for (const b of c.col) {
      items.push({ i: b.i, x: x + (o.align === 'right' ? c.w - b.w : o.align === 'left' ? 0 : (c.w - b.w) / 2), y, w: b.w, h: b.h, f: b.f });
      y += b.h + o.gy;
    }
    height = Math.max(height, y - o.gy); x += c.w + o.gx * 1.7;
  });
  return { items, w: x - o.gx * 1.7, h: height, rows: C.map(c => c.col.length).join('.') };
};
const stackLayouts = (parts, gy, center = true) => {   // several sub-layouts one above the other
  const items = []; const w = Math.max(...parts.map(p => p.w)); let y = 0;
  for (const p of parts) { const dx = (w - p.w) / 2; for (const it of p.items) items.push({ ...it, x: it.x + dx, y: it.y + y }); y += p.h + gy; }
  return { items, w, h: y - gy };
};
// Hero (one large block) with the other lines above / below it, or in a column beside it.
const heroLayout = (blocks, h, mode, o) => {
  const n = blocks.length, hero = blocks[h], maxW = Math.max(...blocks.map(b => b.w));
  if (mode === 'stack') {
    const one = list => flow(list, { width: Math.max(hero.w * 1.15, maxW * 1.02), align: 'center', gx: o.gx, gy: o.gy });
    const parts = [];
    if (h > 0) parts.push(one(blocks.slice(0, h)));
    parts.push({ items: [{ i: hero.i, x: 0, y: 0, w: hero.w, h: hero.h, f: hero.f }], w: hero.w, h: hero.h });
    if (h < n - 1) parts.push(one(blocks.slice(h + 1)));
    return stackLayouts(parts, o.gy * 1.3);
  }
  const others = blocks.filter((_, i) => i !== h), sw = Math.max(...others.map(b => b.w));
  const side = flow(others, { width: sw, align: 'left', gx: o.gx, gy: o.gy });
  const H = Math.max(side.h, hero.h), gap = o.gx * 2.6, heroFirst = h < n / 2;
  const heroIt = { i: hero.i, x: heroFirst ? 0 : side.w + gap, y: (H - hero.h) / 2, w: hero.w, h: hero.h, f: hero.f };
  const sideItems = side.items.map(it => ({ ...it, x: it.x + (heroFirst ? hero.w + gap : 0), y: it.y + (H - side.h) / 2 }));
  return { items: [heroIt, ...sideItems], w: hero.w + gap + side.w, h: H };
};

// ---------------------------------------------------------------------------------------------- anchored layouts (region space)
const ANCHORS = {
  2: [['diag', [[0, 0], [1, 1]]], ['diagUp', [[0, 1], [1, 0]]], ['split', [[0, .5], [1, .5]]], ['post', [[0, 0], [.5, 1]]], ['postR', [[1, 0], [.5, 1]]]],
  3: [['zPath', [[0, 0], [1, .5], [0, 1]]], ['zPathR', [[1, 0], [0, .5], [1, 1]]], ['diag3', [[0, 0], [.5, .5], [1, 1]]], ['diag3Up', [[0, 1], [.5, .5], [1, 0]]],
    ['tri', [[.5, 0], [0, 1], [1, 1]]], ['triInv', [[0, 0], [1, 0], [.5, 1]]]],
  4: [['corners', [[0, 0], [1, 0], [0, 1], [1, 1]]], ['cornersR', [[1, 0], [0, .35], [1, .65], [0, 1]]], ['zig4', [[0, 0], [1, .33], [0, .66], [1, 1]]],
    ['diamond', [[.5, 0], [1, .5], [.5, 1], [0, .5]]]],
  5: [['cornersHero', [[0, 0], [1, 0], [.5, .5], [0, 1], [1, 1]]], ['zig5', [[0, 0], [1, .25], [0, .5], [1, .75], [0, 1]]]],
};
const ringAnchors = (n, h) => {   // hero in the middle, the rest clockwise from the top left
  const others = n - 1, out = new Array(n);
  out[h] = [.5, .5];
  let j = 0;
  for (let i = 0; i < n; i++) if (i !== h) { const a = -Math.PI * .75 + j++ * Math.PI * 2 / others; out[i] = [.5 + .5 * Math.cos(a), .5 + .5 * Math.sin(a)]; }
  return out;
};
const sep = (a, b, g) => a.x + a.w + g <= b.x + EPS || b.x + b.w + g <= a.x + EPS || a.y + a.h + g <= b.y + EPS || b.y + b.h + g <= a.y + EPS;
// The largest font factor k at which the anchored blocks fit the region without touching.
const anchoredFit = (blocks, anchors, R, gapEm) => {
  const at = k => blocks.map((b, i) => ({ x: R.x + anchors[i][0] * (R.w - b.w * k), y: R.y + anchors[i][1] * (R.h - b.h * k), w: b.w * k, h: b.h * k }));
  const ok = k => { const rs = at(k); return rs.every((a, i) => rs.slice(i + 1).every(c => sep(a, c, gapEm * k))); };
  const hi = Math.min(...blocks.map(b => Math.min(R.w / b.w, R.h / b.h)), FMAX / Math.max(...blocks.map(b => b.f)));
  if (!(hi > 0)) return null;
  let lo = hi;
  if (!ok(hi)) {
    lo = hi * .15; if (!ok(lo)) return null;
    let up = hi; for (let t = 0; t < 16; t++) { const mid = (lo + up) / 2; if (ok(mid)) lo = mid; else up = mid; }
  }
  return { k: lo, rects: at(lo) };
};

// ---------------------------------------------------------------------------------------------- geometry helpers
const area = r => r.w * r.h;
const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inter = (a, b) => { const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h); return x2 - x > 0 && y2 - y > 0 ? { x, y, w: x2 - x, h: y2 - y } : null; };
const bboxOf = list => { const x = Math.min(...list.map(r => r.x)), y = Math.min(...list.map(r => r.y)); return { x, y, w: Math.max(...list.map(r => r.x + r.w)) - x, h: Math.max(...list.map(r => r.y + r.h)) - y }; };

// ---------------------------------------------------------------------------------------------- composition
const ALIGN_Q = { center: 1, left: .94, right: .84, alt: .82, stair: .8, stairR: .78, wave: .7 };
const PLACEMENTS = [[.5, .5], [0, .5], [1, .5], [.5, 0], [.5, 1], [0, 0], [1, 1], [1, 0], [0, 1]];

// Layout specs (independent of the region): items in em space with their bounding box.
// lite: only the basic row / stack flows (for the parts of a scene split across regions).
const buildSpecs = (units, env, lite = false) => {
  const n = units.length, specs = [], seen = new Set();
  const tightOk = env.maxOverlap > 0;
  const add = (spec, sig) => { if (seen.has(sig)) return; seen.add(sig); specs.push(spec); };
  const heroes = [...units.filter(u => u.cls === 'emphasis').map(u => u.i), ...(units.some(u => u.cls === 'emphasis') ? [] : [n - 1, 0])];
  for (const contrast of [1, .55]) for (const wrapAt of lite ? [4.8, 1e9] : [3.4, 4.8, 6.5, 10, 1e9]) {
    if (contrast < 1 && !units.some(u => u.cls !== 'normal')) continue;
    const avgR = units.reduce((s, u) => s + rOf(u, contrast), 0) / n, gx = GAP_X * avgR, gy = GAP_Y * avgR;
    const blocks = units.map(u => blockOf(u, wrapAt, contrast)), sigW = contrast + ':' + blocks.map(b => Math.round(b.w * 20)).join();
    const maxW = Math.max(...blocks.map(b => b.w)), total = blocks.reduce((s, b) => s + b.w, 0) + gx * (n - 1);
    const widths = [...new Set((lite ? [maxW, maxW * 1.7, total * .6, total] : [maxW, maxW * 1.3, maxW * 1.7, maxW * 2.3, total * .5, total * .7, total]).map(w => +Math.max(w, maxW).toFixed(3)))];
    for (const width of widths) for (const align of lite ? ['center', 'left', 'right', 'alt'] : Object.keys(ALIGN_Q)) for (const justify of lite ? [false] : [false, true]) {
      if (justify && (!['center', 'left'].includes(align) || units.some(u => u.cls !== 'normal'))) continue;
      for (const tight of tightOk && !lite ? [false, true] : [false]) {
        if (tight && (justify || !['center', 'left', 'alt'].includes(align))) continue;
        const L = flow(blocks, { width, align, justify, tight, gx, gy, phase: env.phase });
        const single = !L.rows.includes('.');
        add({ name: (justify ? 'poster' : tight ? 'layered' : n > 2 && L.rows.split('.').every(c => c === '1') ? { center: 'stack', left: 'stackLeft', right: 'stackRight', alt: 'zigzag', stair: 'stairs', stairR: 'stairsBack', wave: 'wave' }[align] : { center: 'rows', left: 'rowsLeft', right: 'rowsRight', alt: 'rowsZigzag', stair: 'rowsStairs', stairR: 'rowsStairsBack', wave: 'rowsWave' }[align]),
      ...L, q: (ALIGN_Q[align] + (justify ? .08 : 0) - (tight ? .55 : 0)) * (single ? .9 : 1), order: 1, tight }, `f${sigW}|${L.rows}|${align}|${justify}|${tight}`);
      }
    }
    if (!lite && n >= 3 && n <= 12) {
      const total2 = blocks.reduce((s, b) => s + b.h, 0) + gy * (n - 1);
      for (const parts of [2, 3]) if (n >= parts * 2 - 1) for (const align of ['left', 'center']) for (const stagger of [0, .5]) {
        const L = columns(blocks, { height: total2 / parts * 1.08, gx, gy, align, stagger });
        add({ name: stagger ? 'columnsStagger' : 'columns', ...L, q: .86, order: .95 }, `c${sigW}|${L.rows}|${align}|${stagger}`);
      }
      for (const h of heroes) for (const mode of ['stack', 'side']) {
        if (n < 3) continue;
        const L = heroLayout(blocks, h, mode, { gx, gy });
        add({ name: mode === 'stack' ? 'heroStack' : 'heroSide', ...L, q: .92, order: mode === 'stack' ? 1 : .9, hero: h }, `h${sigW}|${h}|${mode}`);
      }
    }
  }
  return specs;
};
// Specs whose positions depend on the region itself (frame corners, ring).
const anchorSpecs = (units, env) => {
  const n = units.length, out = [];
  if (n > 8) return out;
  const sets = [...(ANCHORS[n] || [])];
  if (n >= 4 && n <= 8) for (const h of units.some(u => u.cls === 'emphasis') ? units.filter(u => u.cls === 'emphasis').map(u => u.i) : [n - 1]) sets.push([`ring`, ringAnchors(n, h), h]);
  for (const contrast of [1, .55]) {
  if (contrast < 1 && !units.some(u => u.cls !== 'normal')) continue;
  const blocks = units.map(u => blockOf(u, 8, contrast)), avgR = units.reduce((s, u) => s + rOf(u, contrast), 0) / n;
  for (const [name, anchors, hero] of sets) for (const flip of [false, true]) {
    if (flip && ['ring', 'diamond', 'split', 'tri', 'triInv'].includes(name)) continue;
    out.push({ name: name === 'ring' ? 'ring' : name === 'cornersHero' ? 'frameHero' : /corners|zig|zPath|diag|post|split|tri|diamond/.test(name) ? 'frame' : name,
      blocks, anchors: flip ? anchors.map(([x, y]) => [1 - x, y]) : anchors, gapEm: GAP_X * avgR * 1.2, q: name === 'ring' ? .66 : name === 'diamond' ? .7 : .78, order: /ring|diamond/.test(name) ? .8 : .88, hero });
  }
  }
  return out;
};

// Every maximal empty rectangle of the stage around the obstacles (biggest first): the whole free space, not just
// the strips outside the obstacles' bounding box.
const freeRects = (stage, obstacles) => {
  // Coordinates are rounded alike for edges and obstacles, so a rectangle ending at an obstacle's edge never overlaps it.
  const clampTo = (v, lo, hi) => +Math.min(hi, Math.max(lo, v)).toFixed(5);
  let obs = obstacles.map(o => { const x = clampTo(o.x, stage.x, stage.x + stage.w), y = clampTo(o.y, stage.y, stage.y + stage.h), x2 = clampTo(o.x + o.w, stage.x, stage.x + stage.w), y2 = clampTo(o.y + o.h, stage.y, stage.y + stage.h); return { x, y, w: x2 - x, h: y2 - y }; }).filter(o => o.w > 1e-6 && o.h > 1e-6);
  if (obs.length > 6) { obs.sort((a, b) => area(b) - area(a)); obs = [...obs.slice(0, 5), bboxOf(obs.slice(5))]; }
  const xs = [...new Set([stage.x, stage.x + stage.w, ...obs.flatMap(o => [o.x, o.x + o.w])].map(v => +v.toFixed(5)))].sort((a, b) => a - b);
  const ys = [...new Set([stage.y, stage.y + stage.h, ...obs.flatMap(o => [o.y, o.y + o.h])].map(v => +v.toFixed(5)))].sort((a, b) => a - b);
  const found = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
    if (xs[j] - xs[i] < .1) continue;
    for (let k = 0; k < ys.length; k++) for (let l = k + 1; l < ys.length; l++) {
      if (ys[l] - ys[k] < .1) continue;
      const r = { x: xs[i], y: ys[k], w: xs[j] - xs[i], h: ys[l] - ys[k] };
      if (area(r) >= .035 && !obs.some(o => overlapArea(r, o) > 1e-7)) found.push(r);
    }
  }
  found.sort((a, b) => area(b) - area(a));
  const keep = [];
  for (const r of found) if (!keep.some(q => q.x <= r.x + 1e-9 && q.y <= r.y + 1e-9 && q.x + q.w >= r.x + r.w - 1e-9 && q.y + q.h >= r.y + r.h - 1e-9)) keep.push(r);
  return keep.slice(0, 10);
};
const regionsFor = (env, hasEmphasis) => {
  const stage = { x: MARGIN, y: MARGIN, w: 1 - 2 * MARGIN, h: 1 - 2 * MARGIN }, obs = (env.obstacles || []).filter(o => o && o.w > 0 && o.h > 0);
  const out = [];
  const push = (rect, tag, bonus = 0) => { if (rect && rect.w >= .1 && rect.h >= .1 && area(rect) >= .035) out.push({ rect, tag, bonus }); };
  if (!obs.length) {
    push(stage, 'stage');
    if (env.zone) push(inter(env.zone, stage), 'zone', 1.5);
  } else {
    if (hasEmphasis && !env.hardAvoid) push(stage, 'stage');
    const free = freeRects(stage, obs);
    for (const r of free) push(r, 'free');
    // The lyric zone of the scene's composition comes first, wherever the obstacles leave it free.
    if (env.zone) for (const r of free) push(inter(r, env.zone), 'zone', 1.5);
  }
  // Unique, biggest first (zone regions keep their bonus).
  const key = r => [r.x, r.y, r.w, r.h].map(v => v.toFixed(3)).join();
  const uniq = new Map(); for (const o of out) { const k = key(o.rect); if (!uniq.has(k) || uniq.get(k).bonus < o.bonus) uniq.set(k, o); }
  return [...uniq.values()].sort((a, b) => area(b.rect) * (1 + b.bonus) - area(a.rect) * (1 + a.bonus)).slice(0, 8);
};

// Fit a spec into a region (em → stage fractions), return the candidate rects or null.
const fitSpec = (spec, R, S, place) => {
  const RW = R.w * S, RH = R.h, maxF = Math.max(...spec.items.map(it => it.f));
  const k = Math.min(RW / spec.w, RH / spec.h, FMAX / maxF);
  if (!(k > 0)) return null;
  const ox = R.x * S + place[0] * (RW - spec.w * k), oy = R.y + place[1] * (RH - spec.h * k);
  const rects = new Array(spec.items.length);
  for (const it of spec.items) rects[it.i] = { x: (ox + it.x * k) / S, y: oy + it.y * k, w: it.w * k / S, h: it.h * k, font: it.f * k };
  return { k, rects };
};
const fromAnchored = (spec, R, S) => {
  const RS = { x: R.x * S, y: R.y, w: R.w * S, h: R.h }, fit = anchoredFit(spec.blocks, spec.anchors, RS, spec.gapEm);
  if (!fit) return null;
  const rects = fit.rects.map((r, i) => ({ x: r.x / S, y: r.y, w: r.w / S, h: r.h, font: spec.blocks[i].f * fit.k }));
  return { k: fit.k, rects };
};

J.composeLyricScene = (cuts, env = {}) => {
  const S = env.aspect || 16 / 9, units = makeUnits(cuts), n = units.length;
  if (n < 2) return null;
  const short = Math.min(1, S);
  FMAX = .34 * short; FMIN = .05 * short; FRELAX = .036 * short;
  const rng = J.rng(J.h(env.seed || 1, 9271)), maxOverlap = env.maxOverlap || 0;
  const obstacles = (env.obstacles || []).filter(o => o && o.w > 0 && o.h > 0);
  env = { ...env, maxOverlap, phase: rng() * 6 };
  const emphasised = units.some(u => u.cls === 'emphasis');
  const regions = regionsFor(env, emphasised);
  if (!regions.length) return null;
  const specs = buildSpecs(units, env), anchored = anchorSpecs(units, env);
  const heroUnits = units.filter(u => u.cls === 'emphasis');
  const totalChars = units.reduce((s, u) => s + u.n, 0);
  const cands = [];
  let relaxed = false;
  const consider = (spec, fit, region, place) => {
    if (!fit) return;
    const rects = fit.rects, minFont = Math.min(...rects.map(r => r.font));
    if (env.hardAvoid && rects.some(r => overlapArea(r, env.hardAvoid) > 1e-9)) return;
    // The roles must read: 強調 clearly larger and 抑制 clearly smaller than the ordinary lyrics (compared by
    // type size once the length factor is out), whatever composition or region each lyric ended up in.
    const rel = units.map((u, i) => rects[i].font / u.r0), plainRel = units.filter(u => u.cls === 'normal').map(u => rel[u.i]).sort((a, b) => a - b);
    if (plainRel.length && units.some(u => u.cls !== 'normal')) {
      const med = plainRel[Math.floor(plainRel.length / 2)];
      for (const u of units) if (u.cls === 'emphasis' ? rel[u.i] < med * 1.2 : u.cls === 'soft' && rel[u.i] > med * .88) return;
    }
    // Collisions between blocks: none for 重ねず, a small share for 1シーン' layered layouts.
    let worst = 0;
    for (let i = 0; i < n && worst <= 1; i++) for (let j = i + 1; j < n; j++) {
      const o = overlapArea(rects[i], rects[j]); if (o > 1e-9) worst = Math.max(worst, o / Math.min(area(rects[i]), area(rects[j])));
    }
    if (worst > (maxOverlap ? Math.min(.16, maxOverlap * .5) : 1e-9)) return;
    // The foreground / window: only emphasised lyrics may lie over it.
    let hit = 0;
    for (let i = 0; i < n; i++) {
      const cover = obstacles.reduce((s, o) => s + overlapArea(rects[i], o), 0) / area(rects[i]);
      // An emphasised lyric may lie over the foreground (the big overlaid word is a design), the others keep clear.
      if (units[i].cls === 'emphasis') hit -= Math.min(.6, cover) * .3; else if (cover > 1e-4) { if (!relaxed) return; hit += cover * 2.2; } else hit += cover;
    }
    for (const r of rects) if (r.x < MARGIN - 1e-6 || r.y < MARGIN - 1e-6 || r.x + r.w > 1 - MARGIN + 1e-6 || r.y + r.h > 1 - MARGIN + 1e-6) return;
    cands.push({ spec, rects, k: fit.k, region, place, minFont, hit, worst, pen: fit.pen || 0 });
  };
  const explore = () => {
  for (const region of regions) {
      for (const spec of specs) consider(spec, fitSpec(spec, region.rect, S, [.5, .5]), region, [.5, .5]);
      for (const spec of anchored) consider(spec, fromAnchored(spec, region.rect, S), region, null);
    }
    // Split across two to four free regions in reading order (top, left, right, bottom): each part is composed on its
    // own, with a matching type size. Overlapping regions are carved apart. Around a kept-clear centre or a big
    // foreground this uses the whole free frame instead of one narrow strip.
    if (n >= 3 && n <= 16 && regions.length >= 2) {
      const base = regions.filter(r => r.tag !== 'stage').sort((p, q) => area(q.rect) - area(p.rect)).slice(0, 6), reading = r => (r.rect.y + r.rect.h / 2) * 1.6 + r.rect.x + r.rect.w / 2;
      const rectKey = r => [r.x, r.y, r.w, r.h].map(v => v.toFixed(3)).join();
      const sideMemo = new Map();
      const sideBest = (from, to, region) => {
        const key = `${from}-${to}-${rectKey(region.rect)}`;
        if (sideMemo.has(key)) return sideMemo.get(key);
        const sub = units.slice(from, to).map((u, i) => ({ ...u, i })); let best = null;
        for (const spec of buildSpecs(sub, { ...env, maxOverlap: 0 }, true)) {
          const fit = fitSpec(spec, region.rect, S, [.5, .5]); if (!fit) continue;
          const font = Math.min(...fit.rects.map(r => r.font)), value = font * (.55 + .45 * spec.q);
          if (!best || value > best.value) best = { value, fit, spec, font };
        }
        sideMemo.set(key, best); return best;
      };
      // Keep the regions apart: each later one loses what an earlier one already takes (its biggest remainder stays).
      const carve = list => {
        const out = [];
        for (const region of list) {
          let rect = region.rect;
          for (const c of out) {
            if (overlapArea(rect, c.rect) <= 1e-7) continue;
            const pieces = [{ x: rect.x, y: rect.y, w: c.rect.x - rect.x, h: rect.h }, { x: c.rect.x + c.rect.w, y: rect.y, w: rect.x + rect.w - c.rect.x - c.rect.w, h: rect.h },
              { x: rect.x, y: rect.y, w: rect.w, h: c.rect.y - rect.y }, { x: rect.x, y: c.rect.y + c.rect.h, w: rect.w, h: rect.y + rect.h - c.rect.y - c.rect.h }].filter(q => q.w >= .1 && q.h >= .1);
            if (!pieces.length) return null;
            rect = pieces.reduce((a, b) => area(b) > area(a) ? b : a);
          }
          out.push({ ...region, rect });
        }
        return out;
      };
      const combos = [];
      const choose = (start, chosen, k) => { if (chosen.length === k) { combos.push(chosen.slice()); return; } for (let i = start; i < base.length; i++) { chosen.push(base[i]); choose(i + 1, chosen, k); chosen.pop(); } };
      for (let k = 2; k <= Math.min(4, n, base.length); k++) choose(0, [], k);
      for (const combo of combos) {
        const regs = carve([...combo].sort((p, q) => reading(p) - reading(q)));
        if (!regs) continue;
        const total = regs.reduce((sum, r) => sum + area(r.rect), 0), k = regs.length;
        // Units per region by area share (each at least one), and the neighbours' shifts of one.
        const counts = regs.map(r => Math.max(1, Math.round(n * area(r.rect) / total)));
        for (let guard = 0; counts.reduce((a, b) => a + b, 0) !== n && guard < 40; guard++) {
          const sum = counts.reduce((a, b) => a + b, 0), order = counts.map((c, i) => [c / area(regs[i].rect), i]).sort((a, b) => sum > n ? b[0] - a[0] : a[0] - b[0]);
          const hit = order.find(([, i]) => sum > n ? counts[i] > 1 : true);
          counts[hit[1]] += sum > n ? -1 : 1;
        }
        const variants = [counts];
        for (let i = 0; i < k - 1; i++) for (const d of [1, -1]) { const c = counts.slice(); c[i] += d; c[i + 1] -= d; if (c[i] >= 1 && c[i + 1] >= 1) variants.push(c); }
        for (const cs of variants) {
          let from = 0; const parts = [];
          for (let i = 0; i < k; i++) { const part = sideBest(from, from + cs[i], regs[i]); if (!part) break; parts.push(part); from += cs[i]; }
          if (parts.length !== k) continue;
          const rects = parts.flatMap(part => part.fit.rects), fonts = parts.map(part => part.font);
          consider({ name: 'split' + k, label: 'split' + k + ':' + parts.map(part => part.spec.name).join('+'), q: .84, order: .95, rows: 'split' + k },
            { k: Math.min(...parts.map(part => part.fit.k)), rects, pen: 1.6 * (Math.max(...fonts) - Math.min(...fonts)) / Math.max(...fonts) },
            { rect: bboxOf(regs.map(r => r.rect)), tag: 'split', bonus: regs.reduce((sum, r) => sum + r.bonus, 0) / k }, null);
        }
      }
    }
    // Emphasis over the foreground: the emphasised lyric large across it (drawn in front), the rest composed in
    // the free space around; the counterpart of the single-lyric "overlay" pattern.
    if (emphasised && env.center && n >= 2 && n <= 12) {
      const h = units.find(u => u.cls === 'emphasis').i, rest = units.filter(u => u.i !== h);
      const sub = rest.map((u, i) => ({ ...u, i })), heroBlock = blockOf(units[h], 1e9, 1);
      for (const region of regions.filter(r => r.tag !== 'stage').slice(0, 4)) {
        let best = null;
        for (const spec of buildSpecs(sub, { ...env, maxOverlap: 0 }, true)) {
          if (spec.hero !== undefined || !spec.order) continue;
          const fit = fitSpec(spec, region.rect, S, [.5, .5]); if (!fit) continue;
          const font = Math.min(...fit.rects.map(r => r.font)), value = font * (.55 + .45 * spec.q);
          if (!best || value > best.value) best = { value, fit, spec, font };
        }
        if (!best) continue;
        const k = best.fit.k, hw = heroBlock.w * k * 1.25 / S, hh = heroBlock.h * k * 1.25;
        if (hw > 1 - 2 * MARGIN || hh > 1 - 2 * MARGIN) continue;
        const hero = { x: clamp(env.center.x - hw / 2, MARGIN, 1 - MARGIN - hw), y: clamp(env.center.y - hh / 2, MARGIN, 1 - MARGIN - hh), w: hw, h: hh, font: heroBlock.f * k * 1.25 };
        const rects = new Array(n); let j = 0;
        for (let i = 0; i < n; i++) rects[i] = i === h ? hero : best.fit.rects[j++];
        consider({ name: 'overlay', q: .8, order: .9, rows: 'overlay' }, { k, rects }, region, null);
      }
    }
  };
  explore();
  // Nowhere to put readable type around the foreground / window: read first. Widen to the whole stage and
  // let the lyrics lie over them, as little as possible (heavily penalised).
  if (!cands.some(c => c.minFont >= FRELAX)) {
    relaxed = true;
    if (!env.hardAvoid && !regions.some(r => r.tag === 'stage')) regions.push({ rect: { x: MARGIN, y: MARGIN, w: 1 - 2 * MARGIN, h: 1 - 2 * MARGIN }, tag: 'stage', bonus: -.4 });
    explore();
  }
  // Placement variants for the promising candidates.
  const scoreOf = c => {
    const { rects, region } = c, RW = region.rect;
    // Type size relative to the biggest any candidate reaches: small clusters lose to compositions that use the room.
    const size = Math.pow(clamp(c.typical / typicalMax, 0, 1), 1.5);
    const box = bboxOf(rects), fill = area(box) / area(RW);
    const cx = rects.reduce((s, r) => s + (r.x + r.w / 2) * area(r), 0) / rects.reduce((s, r) => s + area(r), 0);
    const cy = rects.reduce((s, r) => s + (r.y + r.h / 2) * area(r), 0) / rects.reduce((s, r) => s + area(r), 0);
    // Balance: the visual mass sits near the middle, or opposite the foreground / window.
    const target = env.center ? { x: clamp(1 - env.center.x, .25, .75), y: clamp(1 - env.center.y, .3, .7) } : { x: RW.x + RW.w / 2, y: RW.y + RW.h / 2 };
    const balance = 1 - Math.min(1, Math.hypot(cx - target.x, (cy - target.y) * .8) / .4);
    // Emphasis wants the focal middle (or the upper left); suppression the outskirts.
    let hierarchy = 0;
    for (const u of units) {
      const r = rects[u.i], dx = (r.x + r.w / 2 - (RW.x + RW.w / 2)) / RW.w, dy = (r.y + r.h / 2 - (RW.y + RW.h / 2)) / RW.h, d = Math.min(1, Math.hypot(dx, dy) / .55);
      if (u.cls === 'emphasis') hierarchy += .5 * (1 - d) / Math.max(1, heroUnits.length); else if (u.cls === 'soft') hierarchy += .3 * d / units.filter(v => v.cls === 'soft').length;
    }
    // Consecutive parts of one line stay close together.
    let near = 0, pairs = 0;
    for (let i = 1; i < n; i++) if (units[i].line === units[i - 1].line) {
      pairs++; const a = rects[i - 1], b = rects[i], gap = Math.hypot(Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)), Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h)));
      near += 1 - Math.min(1, gap / .25);
    }
    return 3.8 * size + .45 * (1 - Math.min(1, Math.abs(fill - .55) / .55)) + .9 * balance + .95 * c.spec.q + .7 * c.spec.order + hierarchy
      + (pairs ? .4 * near / pairs : 0) + region.bonus * clamp((c.typical / typicalMax - .5) / .25, 0, 1) - c.pen - 3 * c.hit - (c.minFont < FMIN ? 2.5 + 7 * (FMIN - c.minFont) / FMIN : 0) - c.worst * 1.5;
  };
  if (!cands.length) return null;
  const typicalOf = c => Math.exp(units.reduce((s, u, i) => s + u.n * Math.log(Math.max(c.rects[i].font, 1e-3)), 0) / totalChars);
  for (const c of cands) c.typical = typicalOf(c);
  let typicalMax = Math.max(...cands.map(c => c.typical));
  for (const c of cands) c.score = scoreOf(c);
  cands.sort((a, b) => b.score - a.score);
  // Try every placement (centre, edges, corners) of the leading flow candidates.
  const lead = [], seenSig = new Set();
  for (const c of cands) { const sig = c.spec.name + '|' + c.region.tag + '|' + c.spec.rows; if (!c.place || seenSig.has(sig)) continue; seenSig.add(sig); lead.push(c); if (lead.length >= 14) break; }
  for (const c of lead) for (const place of PLACEMENTS.slice(1)) consider(c.spec, fitSpec(c.spec, c.region.rect, S, place), c.region, place);
  for (const c of cands) if (c.score === undefined) { c.typical = typicalOf(c); c.score = scoreOf(c); }
  cands.sort((a, b) => b.score - a.score);
  // Pick a composition family by lottery (weighted by its best candidate), then its best variant, so
  // every scene differs and no single template (say, the poster rows) takes over.
  const best = cands[0].score, families = new Map();
  for (const c of cands) if (!families.has(c.spec.name)) families.set(c.spec.name, c);
  // Only families that read almost as large as the biggest reachable type enter it (variety never costs size).
  const bigEnough = c => c.typical >= .82 * typicalMax || c === cands[0];
  const lottery = [...families.values()].filter(c => c.score >= best - 1.25 && bigEnough(c)).map(c => [c, Math.exp((c.score - best) / .55)]);
  const chosen = rng.wpick(lottery);
  const variants = cands.filter(c => c.spec.name === chosen.spec.name && c.score >= chosen.score - .14).slice(0, 8);
  const pick = rng.wpick(variants.map(c => [c, Math.exp((c.score - chosen.score) / .07)])), r = pick.rects;
  return { name: pick.spec.label || pick.spec.name, rects: r.map(({ x, y, w, h }) => ({ x, y, w, h })), scale: pick.k, score: pick.score, region: pick.region.tag, candidates: cands.length };
};
})();
