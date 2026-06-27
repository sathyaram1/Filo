// Protezione anti-fingerprinting (src/main/services/fingerprint.js +
// src/preload/fingerprint-guard.js, iniettato dal page-preload nel main world).
//
// I test asseriscono il COMPORTAMENTO: con la protezione attiva i segnali ad
// alta entropia (canvas) vengono perturbati di 1 LSB su ~una frazione dei
// pixel — invisibile a occhio ma cambia l'hash — mentre il canale alpha resta
// intatto e il rumore è deterministico per sito (stesso sito → stessa lettura,
// niente flicker). La controprova "Off" verifica che senza protezione i pixel
// tornano esatti (un test che, rimosso il fix, diventerebbe verde anche con la
// protezione accesa e quindi NON maschera regressioni).

import { test, expect } from './fixtures/electron.mjs';

// Disegna un rettangolo a tinta unita e rilegge i pixel via getImageData (la
// chiamata che gli script di fingerprinting usano per hashare il canvas).
const PROBE = `(() => {
  const W = 200, H = 60, R = 120, G = 60, B = 200;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(' + R + ',' + G + ',' + B + ')';
  ctx.fillRect(0, 0, W, H);
  const read = () => Array.from(ctx.getImageData(0, 0, W, H).data);
  const a = read();
  const b = read();
  let deviating = 0, alphaViolations = 0, maxDev = 0, identical = true;
  for (let i = 0; i < a.length; i += 4) {
    const dr = Math.abs(a[i] - R), dg = Math.abs(a[i+1] - G), db = Math.abs(a[i+2] - B);
    if (dr || dg || db) deviating++;
    maxDev = Math.max(maxDev, dr, dg, db);
    if (a[i+3] !== 255) alphaViolations++;
  }
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) { identical = false; break; } }
  return { total: (W*H), deviating, alphaViolations, maxDev, identical,
           guard: !!window.__filoFpGuard };
})()`;

async function setFpMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="fp-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="fp-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
  return sec;
}

test('default: il canvas viene perturbato (1 LSB), alpha intatto, deterministico', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>FP_ON</title><p>ok</p>');
  // La guardia deve essere stata iniettata nel main world.
  await page.waitForFunction(() => window.__filoFpGuard === true, null, { timeout: 6_000 });
  const r = await page.evaluate(PROBE);
  // Rumore applicato: qualche pixel deviato, ma NON tutti (perturbazione mirata).
  expect(r.deviating).toBeGreaterThan(0);
  expect(r.deviating).toBeLessThan(r.total);
  // Impercettibile: solo 1 LSB di scarto.
  expect(r.maxDev).toBeLessThanOrEqual(1);
  // L'alpha non viene mai toccato (altrimenti si vedrebbe).
  expect(r.alphaViolations).toBe(0);
  // Deterministico per sito: due letture identiche (nessun flicker).
  expect(r.identical).toBe(true);
});

test('off: i pixel del canvas tornano esatti (controprova)', async ({ openTab, testServer }) => {
  await setFpMode(openTab, 'off');
  const page = await testServer.openReady(openTab, '<title>FP_OFF</title><p>ok</p>');
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  const r = await page.evaluate(PROBE);
  // Nessun rumore: ogni pixel è esattamente il colore di riempimento.
  expect(r.deviating).toBe(0);
  expect(r.maxDev).toBe(0);
  expect(r.alphaViolations).toBe(0);
  expect(r.guard).toBe(false);
});

test('toDataURL: stabile su letture ripetute, non lancia eccezioni', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<title>FP_DATA</title><p>ok</p>');
  await page.waitForFunction(() => window.__filoFpGuard === true, null, { timeout: 6_000 });
  const r = await page.evaluate(`(() => {
    const c = document.createElement('canvas');
    c.width = 80; c.height = 40;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1e90ff'; ctx.fillRect(0, 0, 80, 40);
    ctx.fillStyle = '#000'; ctx.font = '16px sans-serif'; ctx.fillText('filo', 4, 24);
    const u1 = c.toDataURL();
    const u2 = c.toDataURL();
    // Dopo toDataURL il canvas a schermo deve essere ripristinato: rileggendo
    // un pixel "di testo" non deve restare alterato in modo visibile.
    return { stable: u1 === u2, looksPng: u1.startsWith('data:image/png'), len: u1.length };
  })()`);
  expect(r.looksPng).toBe(true);
  expect(r.stable).toBe(true);
  expect(r.len).toBeGreaterThan(100);
});

test('seed per-origine: deterministico, coerente fra sottodomini, scorrelato fra siti', async ({ app }) => {
  const r = await app.evaluate(() => {
    const F = globalThis.__filoFingerprint;
    return {
      etld_google: F.etld1('accounts.google.com'),
      etld_bbc: F.etld1('news.bbc.co.uk'),
      etld_plain: F.etld1('example.com'),
      levelHttps: F.configForHref('https://x.example.com/').level,
      levelInternal: F.configForHref('filo://newtab/').level,
      levelFile: F.configForHref('file:///tmp/x.html').level,
      seedA1: F.configForHref('https://www.example.com/a').seed,
      seedA2: F.configForHref('https://shop.example.com/b').seed,
      seedB: F.configForHref('https://other-site.org/').seed,
    };
  });
  // eTLD+1 corretto (sottodomini collassati, suffisso multi-parte gestito).
  expect(r.etld_google).toBe('google.com');
  expect(r.etld_bbc).toBe('bbc.co.uk');
  expect(r.etld_plain).toBe('example.com');
  // Solo http/https sono protette; pagine interne e file:// no.
  expect(r.levelHttps).toBe(1);
  expect(r.levelInternal).toBe(0);
  expect(r.levelFile).toBe(0);
  // Stesso eTLD+1 (sottodomini diversi) → stesso seed; sito diverso → diverso.
  expect(r.seedA1).toBe(r.seedA2);
  expect(r.seedA1).not.toBe(r.seedB);
  expect(r.seedA1).toBeGreaterThan(0);
});
