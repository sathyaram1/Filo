// Verifica #821, giro 1: strade equivalenti (Preferenze, preset a parole, Cronologia, incognito) e stress.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const svg = (inner) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">${inner}</svg>`);
const page = (title, icon) => '<!doctype html><html><head>' +
  (icon ? `<link rel="icon" href="${icon}">` : '') +
  `<title>${title}</title></head><body style="margin:0;height:1200px">${title}</body></html>`;
const ROSSO = page('Tubo rosso', svg('<rect width="32" height="32" rx="7" fill="rgb(255,0,0)"/>'));
const GIALLO = page('Posta gialla', svg('<rect width="32" height="32" fill="rgb(255,204,0)"/>'));
const BLU = page('Libro blu', svg('<rect width="32" height="32" fill="rgb(24,119,242)"/>'));

const lum = ([r, g, b]) => {
  const l = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
};
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const nums = (c) => (/rgba?\(([^)]+)\)/.exec(c || '') || [, ''])[1].split(',').slice(0, 3).map(Number);
const near = (a, b, tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

const leggi = (shell, tip) => shell.evaluate((tip) => {
  const el = document.querySelector(`.tab[data-tip="${tip}"]`);
  if (!el) return null;
  const probe = document.createElement('div');
  probe.style.background = 'var(--tab-bg)';
  document.body.appendChild(probe);
  const bar = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return { active: el.classList.contains('active'), tinted: el.classList.contains('tinted'),
    bg: getComputedStyle(el).backgroundColor, title: getComputedStyle(el.querySelector('.title')).color, bar };
}, tip);

const setSettings = (shell, st) => shell.evaluate((s) => window.filoShell.message({ type: 'update_settings', settings: s }), st);

async function apriEAspetta(shell, openTab, testServer, html, title) {
  await testServer.openReady(openTab, html);
  await expect.poll(async () => shell.evaluate(async (t) => {
    const snap = await window.filoShell.tabs.snapshot();
    const x = snap.tabs.find((y) => y.title === t);
    return (x && x.identityColor) || null;
  }, title), { timeout: 10_000 }).not.toBeNull();
}

test('preset a parole, Preferenze avanzate, estremi di luminosità, barra personalizzata', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  mkdirSync('tests/.shots', { recursive: true });
  const log = {};
  await apriEAspetta(shell, openTab, testServer, ROSSO, 'Tubo rosso');
  await apriEAspetta(shell, openTab, testServer, GIALLO, 'Posta gialla');

  // predefiniti
  await expect.poll(async () => (await leggi(shell, 'Tubo rosso'))?.tinted, { timeout: 5000 }).toBe(true);
  const def = await leggi(shell, 'Tubo rosso');
  log.def = def;

  // «colori più vivaci nelle tab» con la stessa costruzione che usa la chat
  const vivace = await app.evaluate(() => globalThis.SN_PREF.buildPreferencePartial('colore_tab', 'più vivaci'));
  log.vivace = vivace;
  await setSettings(shell, vivace.partial);
  await expect.poll(async () => (await leggi(shell, 'Tubo rosso')).bg, { timeout: 5000 }).not.toBe(def.bg);
  log.vivaceBg = await leggi(shell, 'Tubo rosso');
  await shell.screenshot({ path: 'tests/.shots/v821-vivace.png', clip: { x: 0, y: 0, width: 700, height: 44 } });

  const neutro = await app.evaluate(() => globalThis.SN_PREF.buildPreferencePartial('colore_tab', 'più neutre'));
  await setSettings(shell, neutro.partial);
  await shell.waitForTimeout(500);
  log.neutroBg = await leggi(shell, 'Tubo rosso');
  const nessuno = await app.evaluate(() => globalThis.SN_PREF.buildPreferencePartial('colore_tab', 'nessuno'));
  await setSettings(shell, nessuno.partial);
  await shell.waitForTimeout(500);
  log.nessunoBg = await leggi(shell, 'Tubo rosso');
  const pred = await app.evaluate(() => globalThis.SN_PREF.buildPreferencePartial('colore_tab', 'predefinito'));
  await setSettings(shell, pred.partial);
  await shell.waitForTimeout(500);
  log.predBg = await leggi(shell, 'Tubo rosso');

  // luminosità agli estremi e saturazione 0, poi ritorno
  for (const [k, tc] of [['lum09', { luminosita_tab: 0.9 }], ['lum01', { luminosita_tab: 0.1 }], ['sat0', { saturazione_tab: 0, luminosita_tab: 0.5 }], ['ritorno', { saturazione_tab: 1, luminosita_tab: 0.5 }]]) {
    await setSettings(shell, { tabColor: tc });
    await shell.waitForTimeout(2600);
    const r = await leggi(shell, 'Tubo rosso');
    const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.find((t) => t.title === 'Tubo rosso').identityColor);
    log[k] = { ...r, identity: id, contr: contrast(nums(r.title), nums(r.bg)) };
  }

  // barra in alto personalizzata (token topbar): la tinta si mescola sulla nuova barra
  await setSettings(shell, { themeTokens: { topbar: '#123a2a' } });
  await shell.waitForTimeout(600);
  const tb = await leggi(shell, 'Tubo rosso');
  log.topbar = { ...tb, contr: contrast(nums(tb.title), nums(tb.bg)) };
  await shell.screenshot({ path: 'tests/.shots/v821-topbar.png', clip: { x: 0, y: 0, width: 700, height: 44 } });
  await setSettings(shell, { themeTokens: {} });

  // Preferenze avanzate: opacita_tab scritto a mano aggiorna la barra dal vivo
  const prefs = await openTab('filo://preferences/preferences.html');
  await prefs.waitForSelector('#tabcol-opacita_tab', { timeout: 10_000 });
  await prefs.fill('#tabcol-opacita_tab', '1');
  await expect.poll(async () => (await leggi(shell, 'Tubo rosso')).bg, { timeout: 5000 }).toBe('rgb(255, 0, 0)');
  log.prefs1 = await leggi(shell, 'Tubo rosso');
  await prefs.fill('#tabcol-opacita_tab', '0');
  await shell.waitForTimeout(1200);
  log.prefs0 = await leggi(shell, 'Tubo rosso');
  await prefs.fill('#tabcol-opacita_tab', '');
  await prefs.fill('#tabcol-opacita_tab', '0.6');
  await shell.waitForTimeout(1200);
  log.prefs06 = await leggi(shell, 'Tubo rosso');
  writeFileSync('tests/.shots/v821-log2.json', JSON.stringify(log, null, 1));
});

test('Cronologia: le chip dei siti chiusi seguono la regola della barra, nei due temi', async ({ shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  mkdirSync('tests/.shots', { recursive: true });
  for (const [h, t] of [[ROSSO, 'Tubo rosso'], [GIALLO, 'Posta gialla'], [BLU, 'Libro blu']]) {
    await apriEAspetta(shell, openTab, testServer, h, t);
  }
  await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    for (const t of snap.tabs) if (/127\.0\.0\.1/.test(t.url)) await window.filoShell.tabs.close(t.id);
  });
  const arc = await openTab('filo://archive/archive.html');
  await expect(arc.locator('.arc-tab', { hasText: 'Tubo rosso' })).toBeVisible({ timeout: 8000 });
  const out = {};
  for (const theme of ['light', 'dark']) {
    await setSettings(shell, { theme });
    await arc.waitForTimeout(1200);
    out[theme] = await arc.evaluate(() => [...document.querySelectorAll('.arc-tab')].map((el) => ({
      t: el.textContent.trim().slice(0, 20), tinted: el.classList.contains('tinted'), id: el.dataset.identity,
      bg: getComputedStyle(el).backgroundColor, ink: getComputedStyle(el.querySelector('.arc-title')).color,
      bodyBg: getComputedStyle(document.body).backgroundColor,
    })));
    for (const c of out[theme]) c.contr = contrast(nums(c.ink), nums(c.bg));
    await arc.screenshot({ path: `tests/.shots/v821-cronologia-${theme}.png` });
  }
  await setSettings(shell, { theme: 'system' });
  writeFileSync('tests/.shots/v821-log3.json', JSON.stringify(out, null, 1));
});

test('finestra incognito: schede colorate leggibili sulla barra viola', async ({ app, shell, testServer }) => {
  test.setTimeout(90_000);
  mkdirSync('tests/.shots', { recursive: true });
  await shell.evaluate(() => window.filoShell.openIncognito());
  let inc = null;
  await expect.poll(async () => {
    inc = app.windows().find((w) => /incognito=1/.test(w.url()));
    return !!inc;
  }, { timeout: 10_000 }).toBe(true);
  await inc.waitForLoadState('domcontentloaded');
  for (const h of [ROSSO, GIALLO, BLU]) {
    await inc.evaluate((u) => window.filoShell.tabs.open(u), testServer.html(h));
    await inc.waitForTimeout(1500);
  }
  await expect.poll(async () => inc.evaluate(() => document.querySelectorAll('.tab.tinted').length), { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  const r = await inc.evaluate(() => [...document.querySelectorAll('.tab')].map((el) => ({
    tip: el.dataset.tip, tinted: el.classList.contains('tinted'), bg: getComputedStyle(el).backgroundColor,
    title: getComputedStyle(el.querySelector('.title')).color })));
  for (const x of r) x.contr = contrast(nums(x.title), nums(x.bg));
  const w = await inc.evaluate(() => innerWidth);
  await inc.screenshot({ path: 'tests/.shots/v821-incognito.png', clip: { x: 0, y: 0, width: w, height: 44 } });
  writeFileSync('tests/.shots/v821-log4.json', JSON.stringify(r, null, 1));
});
