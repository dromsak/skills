// measure-probe.js — the in-browser instrumentation for /design-audit.
//
// This is the crown jewel: a glance at a dark dense table cannot see that one
// cell is 894px wide holding 250px of text, that a 40px bar exists only to hold
// one button, or that a "sticky" residue drew a 1px rule between two columns.
// getBoundingClientRect / getComputedStyle CAN. This probe renders those
// invisible-to-the-eye facts into a structured bundle the reviewers reason over.
//
// It is a complete `() => {…}` arrow function: pass its whole body as the
// `function` arg to mcp__playwright__browser_evaluate. Parameterize by setting
// `window.__DA_OPTS` in a PRIOR browser_evaluate call:
//
//   window.__DA_OPTS = {
//     scale:    { spacing:[0,4,8,12,16,20,24,32,40,48,64,80], radii:[2,4,6,10,16], fontPx:[11,12,13,14,15,18,22,24,36,56,72] },
//     selectors:{ "severity-dot": ".dot", "identity-cell": "[data-col='cve'],[data-col='prc'],[data-col='check']" },
//     region:   "main"            // CSS selector to scope the audit; defaults to <body>
//   }
//
// Everything is optional. With no opts it still returns a useful bundle; with
// `scale` it flags off-scale values, with `selectors` it returns the geometry of
// named elements so the caller can DIFF the same element across sibling pages
// (the cross-surface-consistency lens — the dot-spacing / double-height class).
//
// Defensive throughout: never throws, caps every walk, returns partial data over
// nothing. Pure measurement — no judgement. The lenses live in SKILL.md.
() => {
  const O = (window.__DA_OPTS) || {};
  const SCALE = O.scale || {};
  const root = (O.region && document.querySelector(O.region)) || document.body;
  const px = (v) => Math.round(parseFloat(v) || 0);
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const txt = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const clamp = (arr, n) => arr.slice(0, n);
  const out = { url: location.pathname + location.search, viewport: { w: innerWidth, h: innerHeight } };

  // 1 ── page-level horizontal overflow (an unwanted scrollbar is always a smell)
  out.pageOverflow = { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
  out.pageOverflow.overflowing = out.pageOverflow.scrollW - out.pageOverflow.clientW > 1;

  // 2 ── stacked chrome decks: ≥2 vertically-stacked sibling bars each carrying a
  //      bottom border or a distinct fill. Catches the "3 header bars" pileup and
  //      the near-empty bar (few visible children / mostly whitespace) that exists
  //      only to host one control.
  out.decks = [];
  try {
    const containers = clamp([...root.querySelectorAll('section, .panel, [class*="findings"], [class*="table"], div')], 400);
    const seen = new Set();
    for (const c of containers) {
      const kids = [...c.children].filter(vis);
      if (kids.length < 2) continue;
      const bars = kids.filter((k) => {
        const s = getComputedStyle(k); const r = k.getBoundingClientRect();
        const bar = (px(s.borderBottomWidth) > 0 || s.backgroundColor !== 'rgba(0, 0, 0, 0)') && r.height > 0 && r.height <= 64 && r.width > 200;
        return bar;
      });
      if (bars.length < 2) continue;
      const key = bars.map((b) => Math.round(b.getBoundingClientRect().top)).join(',');
      if (seen.has(key)) continue; seen.add(key);
      out.decks.push({
        region: (c.id ? '#' + c.id : '') + '.' + (c.className || '').toString().split(' ').slice(0, 2).join('.'),
        count: bars.length,
        bars: clamp(bars.map((b) => { const r = b.getBoundingClientRect(); const t = txt(b); const kids = [...b.children].filter(vis); return { h: Math.round(r.height), text: t.slice(0, 60), childCount: kids.length, nearEmpty: t.length < 12 || kids.length <= 1 }; }), 6),
      });
    }
    out.decks = clamp(out.decks.sort((a, b) => b.count - a.count), 8);
  } catch (e) { out.decks = [{ error: String(e) }]; }

  // 3 ── tables: the product's primary dense primitive. Per column: box width vs
  //      CONTENT width (voidRatio < 0.5 on a wide cell = dead space), padding
  //      asymmetry, stray side borders, sticky residue. Per table: row-height
  //      drift (double-height-row class), and the trailing gap to the container
  //      (devices-jammed-on-the-frame class).
  out.tables = [];
  try {
    for (const table of clamp([...root.querySelectorAll('table')], 12)) {
      if (!vis(table)) continue;
      const tr = table.getBoundingClientRect();
      const container = table.closest('section, .panel, .findings-shell, main') || table.parentElement;
      const cr = container.getBoundingClientRect();
      const headCells = [...table.querySelectorAll('thead th')];
      const bodyRows = clamp([...table.querySelectorAll('tbody tr')].filter(vis), 40);
      const firstRow = bodyRows[0];
      const cells = firstRow ? [...firstRow.children] : [];
      const columns = cells.map((td, i) => {
        const s = getComputedStyle(td); const r = td.getBoundingClientRect();
        const inner = td.firstElementChild || td;
        const contentW = Math.max(inner.scrollWidth || 0, ...[...td.querySelectorAll('*')].slice(0, 6).map((e) => e.scrollWidth || 0), 0);
        const th = headCells[i];
        const cellW = Math.round(r.width);
        return {
          id: td.getAttribute('data-col') || (th && th.getAttribute('data-col')) || String(i),
          label: th ? txt(th) : '',
          headerLeft: th ? Math.round(th.getBoundingClientRect().left) : null,
          cellLeft: Math.round(r.left), cellW,
          contentW: Math.min(contentW, cellW),
          voidRatio: cellW ? +(Math.min(contentW, cellW) / cellW).toFixed(2) : 1,
          padL: px(s.paddingLeft), padR: px(s.paddingRight),
          align: s.textAlign,
          borderL: px(s.borderLeftWidth), borderR: px(s.borderRightWidth),
          sticky: s.position === 'sticky',
        };
      });
      const heights = bodyRows.map((row) => Math.round(row.getBoundingClientRect().height));
      const minH = Math.min(...heights), maxH = Math.max(...heights);
      const lastCell = cells[cells.length - 1];
      out.tables.push({
        key: table.getAttribute('data-col-table') || '',
        width: Math.round(tr.width), containerWidth: Math.round(cr.width), fills: +(tr.width / cr.width).toFixed(2),
        columns,
        voids: columns.filter((c) => c.voidRatio < 0.5 && c.cellW > 120).map((c) => ({ id: c.id, cellW: c.cellW, contentW: c.contentW, voidRatio: c.voidRatio })),
        strayBorders: columns.filter((c) => (c.borderL > 0 || c.borderR > 0)).map((c) => ({ id: c.id, borderL: c.borderL, borderR: c.borderR, sticky: c.sticky })),
        rows: { count: heights.length, minH: isFinite(minH) ? minH : 0, maxH: isFinite(maxH) ? maxH : 0, driftRatio: minH ? +(maxH / minH).toFixed(2) : 1 },
        trailing: lastCell ? { lastCellRight: Math.round(lastCell.getBoundingClientRect().right), tableRight: Math.round(tr.right), containerRight: Math.round(cr.right), gapToContainer: Math.round(cr.right - tr.right), lastPadR: px(getComputedStyle(lastCell).paddingRight) } : null,
      });
    }
  } catch (e) { out.tables = [{ error: String(e) }]; }

  // 4 ── named-selector geometry: the caller passes the elements whose CROSS-PAGE
  //      consistency matters (severity dot, identity cell, page-head). Returns the
  //      first match's box + padding so the caller diffs the same element across
  //      siblings — the lens automated critique structurally cannot run.
  out.probes = {};
  try {
    for (const [name, sel] of Object.entries(O.selectors || {})) {
      const el = root.querySelector(sel);
      if (!el) { out.probes[name] = { found: false }; continue; }
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el); const host = el.closest('td,th,li,tr,div') || el;
      out.probes[name] = { found: true, left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), offsetInHost: Math.round(r.left - host.getBoundingClientRect().left), padL: px(s.paddingLeft), padR: px(s.paddingRight), font: s.fontFamily.split(',')[0].replace(/["']/g, '') };
    }
  } catch (e) { out.probes = { error: String(e) }; }

  // 5 ── off-scale token distribution. The probe does NOT know the project's scale
  //      unless given one; with SCALE it flags violations, without it returns the
  //      observed distribution for the reviewer to judge against the brand law.
  out.scale = { radii: {}, fontPx: {}, padding: {}, gap: {}, shadows: [], offScale: [] };
  try {
    const sample = clamp([...root.querySelectorAll('*')].filter(vis), 1200);
    const bump = (m, v) => { m[v] = (m[v] || 0) + 1; };
    const onScale = (set, v) => !set || set.length === 0 || set.includes(v) || v === 0;
    for (const el of sample) {
      const s = getComputedStyle(el);
      const rad = px(s.borderTopLeftRadius); if (rad) { bump(out.scale.radii, rad); if (!onScale(SCALE.radii, rad)) out.scale.offScale.push({ kind: 'radius', v: rad, sel: tag(el) }); }
      const fp = px(s.fontSize); if (fp) { bump(out.scale.fontPx, fp); if (!onScale(SCALE.fontPx, fp)) out.scale.offScale.push({ kind: 'fontPx', v: fp, sel: tag(el) }); }
      [px(s.paddingTop), px(s.paddingLeft)].forEach((p) => { if (p) { bump(out.scale.padding, p); if (!onScale(SCALE.spacing, p)) out.scale.offScale.push({ kind: 'padding', v: p, sel: tag(el) }); } });
      const g = px(s.columnGap || s.gap); if (g) { bump(out.scale.gap, g); if (!onScale(SCALE.spacing, g)) out.scale.offScale.push({ kind: 'gap', v: g, sel: tag(el) }); }
      if (s.boxShadow && s.boxShadow !== 'none') out.scale.shadows.push({ sel: tag(el), shadow: s.boxShadow.slice(0, 60) });
    }
    // de-dupe noise: keep the distinct off-scale (kind,v) with one example each
    const odd = new Map();
    for (const o of out.scale.offScale) { const k = o.kind + ':' + o.v; if (!odd.has(k)) odd.set(k, o); }
    out.scale.offScale = clamp([...odd.values()], 40);
    out.scale.shadows = clamp(dedupe(out.scale.shadows, (s) => s.shadow), 12);
  } catch (e) { out.scale.error = String(e); }

  // 6 ── contrast: measured, not guessed. Sample text nodes, compute the ratio of
  //      ink vs its effective background, flag body < 4.5 / large < 3.
  out.contrast = [];
  try {
    const texts = clamp([...root.querySelectorAll('p, span, a, td, th, h1, h2, h3, h4, li, label, button, div')].filter((e) => vis(e) && e.children.length === 0 && txt(e).length > 1), 300);
    const fails = [];
    for (const el of texts) {
      const s = getComputedStyle(el);
      const fg = parseColor(s.color); const bg = effectiveBg(el); if (!fg || !bg) continue;
      const ratio = contrast(fg, bg); const fpx = px(s.fontSize); const bold = (parseInt(s.fontWeight) || 400) >= 600;
      const large = fpx >= 18 || (bold && fpx >= 14); const min = large ? 3 : 4.5;
      if (ratio < min) fails.push({ text: txt(el).slice(0, 40), ratio: +ratio.toFixed(2), fontPx: fpx, large, sel: tag(el) });
    }
    out.contrast = clamp(dedupe(fails, (f) => f.sel + f.ratio), 30);
  } catch (e) { out.contrast = [{ error: String(e) }]; }

  // 7 ── font-role smell (light heuristic): mono on prose, or code-shaped data not
  //      in mono. The reviewer confirms against the type rules.
  out.fontRoles = { monoOnProse: [], codeNotMono: [] };
  try {
    const els = clamp([...root.querySelectorAll('span, td, div, p, a, code, h1, h2, h3')].filter((e) => vis(e) && e.children.length === 0 && txt(e).length > 2), 500);
    const codeShaped = (t) => /^(CVE-|\d+\.\d+\.\d+|[0-9a-f]{12,}|(\d{1,3}\.){3}\d{1,3})/i.test(t) || /^[A-Z]{2,}-[A-Z0-9-]+\d/.test(t);
    for (const el of els) {
      const fam = getComputedStyle(el).fontFamily.toLowerCase(); const t = txt(el); const mono = /mono|consol|courier|jetbrains/.test(fam);
      if (mono && / [a-z]/.test(t) && t.length > 14 && !codeShaped(t)) out.fontRoles.monoOnProse.push({ text: t.slice(0, 40), sel: tag(el) });
      if (!mono && codeShaped(t)) out.fontRoles.codeNotMono.push({ text: t.slice(0, 40), sel: tag(el) });
    }
    out.fontRoles.monoOnProse = clamp(dedupe(out.fontRoles.monoOnProse, (x) => x.sel), 12);
    out.fontRoles.codeNotMono = clamp(dedupe(out.fontRoles.codeNotMono, (x) => x.sel), 12);
  } catch (e) { out.fontRoles.error = String(e); }

  // 8 ── undersized hit targets (interactive elements below 24px in either axis).
  out.smallTargets = [];
  try {
    const ints = clamp([...root.querySelectorAll('a, button, [role="button"], input, select, summary')].filter(vis), 200);
    out.smallTargets = clamp(ints.map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), text: txt(e).slice(0, 24), sel: tag(e) }; }).filter((t) => (t.w > 0 && t.w < 24) || (t.h > 0 && t.h < 24)), 20);
  } catch (e) { out.smallTargets = [{ error: String(e) }]; }

  return out;

  // ── helpers ──
  function tag(el) { return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.getAttribute && el.getAttribute('data-col') ? "[data-col=" + el.getAttribute('data-col') + "]" : '') + (el.className && el.className.toString ? '.' + el.className.toString().split(' ').filter(Boolean).slice(0, 2).join('.') : ''); }
  function dedupe(arr, keyfn) { const s = new Set(); const r = []; for (const x of arr) { const k = keyfn(x); if (!s.has(k)) { s.add(k); r.push(x); } } return r; }
  function parseColor(c) { const m = (c || '').match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); const a = p[3] === undefined ? 1 : p[3]; return { r: p[0], g: p[1], b: p[2], a }; }
  function effectiveBg(el) { let n = el; while (n && n !== document.documentElement) { const c = parseColor(getComputedStyle(n).backgroundColor); if (c && c.a > 0.5) return c; n = n.parentElement; } return { r: 13, g: 14, b: 17, a: 1 }; }
  function lin(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function lum(c) { return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b); }
  function contrast(a, b) { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
}
