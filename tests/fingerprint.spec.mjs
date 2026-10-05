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

import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

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
      googleLogin: F.seedForHref('https://accounts.google.com/'),
      googleSearch: F.seedForHref('https://www.google.com/'),
      bbcNews: F.seedForHref('https://news.bbc.co.uk/'),
      bbcWww: F.seedForHref('https://www.bbc.co.uk/'),
      bbcAltro: F.seedForHref('https://bbc.com/'),
      plain: F.seedForHref('https://example.com/'),
      githubAlice: F.configForHref('https://alice.github.io/').seed,
      githubBob: F.configForHref('https://bob.github.io/').seed,
      levelHttps: F.configForHref('https://x.example.com/').level,
      levelInternal: F.configForHref('filo://newtab/').level,
      levelFile: F.configForHref('file:///tmp/x.html').level,
      seedA1: F.configForHref('https://www.example.com/a').seed,
      seedA2: F.configForHref('https://shop.example.com/b').seed,
      seedB: F.configForHref('https://other-site.org/').seed,
    };
  });
  // Il sito è quello dei cookie: sottodomini insieme, suffisso nazionale a due livelli, due pagine su github.io separate.
  expect(r.googleLogin).toBe(r.googleSearch);
  expect(r.bbcNews).toBe(r.bbcWww);
  expect(r.bbcNews).not.toBe(r.bbcAltro);
  expect(r.plain).toBe(r.seedA1);
  expect(r.githubAlice).not.toBe(r.githubBob);
  // Solo http/https sono protette; pagine interne e file:// no.
  expect(r.levelHttps).toBe(1);
  expect(r.levelInternal).toBe(0);
  expect(r.levelFile).toBe(0);
  // Stesso eTLD+1 (sottodomini diversi) → stesso seed; sito diverso → diverso.
  expect(r.seedA1).toBe(r.seedA2);
  expect(r.seedA1).not.toBe(r.seedB);
  expect(r.seedA1).toBeGreaterThan(0);
});

// #796 — Lo stesso script di tracciamento su due siti diversi legge due impronte diverse anche sotto un suffisso
// nazionale a due livelli o su due IP; le pagine dello stesso sito ne leggono una sola. Il sito è quello dei cookie, e
// in Privacy il vaso persistente di un sito fidato è del sito anche quando la voce è un suffisso o un sottodominio.
// I nomi arrivano al server locale con host-resolver-rules: la rete vera non serve.

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NOMI = ['shop.com.tw', 'www.shop.com.tw', 'altro.com.tw', 'negozio.co.id', 'toko.co.id', 'tienda.com.co', 'otra.com.co', '192.168.1.10', '10.0.1.10'];
const NOMI_FIDATI = ['www.bbc.co.uk', 'www.argos.co.uk', 'webmail.libero.it', 'www.libero.it'];

const testSiti = test.extend({
  app: async ({}, use) => {
    const userData = cartellaTemporanea('filo-fp-siti-');
    const app = await electron.launch({
      args: [...argomentiScala, `--host-resolver-rules=${[...NOMI, ...NOMI_FIDATI].map((n) => `MAP ${n} 127.0.0.1`).join(', ')}`, '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
});

// Quello che fa uno script di fingerprinting: disegna una scena fissa e ne legge i pixel.
const IMPRONTA = () => {
  const c = document.createElement('canvas');
  c.width = 80; c.height = 40;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1e90ff'; ctx.fillRect(0, 0, 80, 40);
  ctx.fillStyle = '#000'; ctx.font = '16px sans-serif'; ctx.fillText('filo', 4, 24);
  const url = c.toDataURL();
  if (!url.startsWith('data:image/png')) return url;
  // Su http non c'è crypto.subtle: basta un FNV-1a a 32 bit, preso due volte con semi diversi.
  const fnv = (s, h) => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };
  return [fnv(url, 2166136261), fnv(url, 33554467)].map((h) => h.toString(16).padStart(8, '0')).join('');
};

testSiti('due siti diversi leggono impronte diverse, due pagine dello stesso sito la stessa', async ({ openTab, testServer }) => {
  testSiti.setTimeout(90_000);
  const porta = new URL(testServer.origin).port;
  const impronte = {};
  for (const nome of NOMI) {
    const id = new URL(testServer.html(`<title>FP ${nome}</title><p>${nome}</p>`)).pathname;
    const page = await openTab(`http://${nome}:${porta}${id}`);
    await page.waitForFunction(() => window.__filoFpGuard === true, null, { timeout: 8_000 });
    impronte[nome] = await page.evaluate(IMPRONTA);
    expect(impronte[nome]).toMatch(/^[0-9a-f]{16}$/);
  }
  expect(impronte['www.shop.com.tw']).toBe(impronte['shop.com.tw']);
  expect(impronte['altro.com.tw']).not.toBe(impronte['shop.com.tw']);
  expect(impronte['toko.co.id']).not.toBe(impronte['negozio.co.id']);
  expect(impronte['otra.com.co']).not.toBe(impronte['tienda.com.co']);
  expect(impronte['10.0.1.10']).not.toBe(impronte['192.168.1.10']);
});

// ─── Siti fidati in Privacy: il vaso persistente è del sito ───────────────────
testSiti.describe('siti fidati in Privacy', () => {

  const CONNESSO = 'C=sess=abc';
  let server;
  let port;

  testSiti.beforeAll(async () => {
    server = createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const head = { 'Content-Type': 'text/html; charset=utf-8' };
      if (u.pathname === '/accedi') head['Set-Cookie'] = 'sess=abc; Max-Age=86400; Path=/';
      res.writeHead(200, head);
      res.end(`<!doctype html><meta charset="utf-8"><script>document.title = 'C=' + ${JSON.stringify(req.headers.cookie || '-')};</script>`);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });

  testSiti.afterAll(async () => {
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
  });


  async function privacy(app, shell, trustedSites) {
    await shell.evaluate((t) => window.filoShell.message({
      type: 'update_settings', settings: { security: { cookies: { mode: 'privacy', trustedSites: t } } },
    }), trustedSites);
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .some((w) => w._filoTabs && w._filoTabs.cookieMode === 'privacy')), { timeout: 5000 }).toBe(true);
  }

  async function apri(app, shell, nome, percorso) {
    const url = `http://${nome}:${port}${percorso}`;
    const { id } = await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
    let s = null;
    await expect.poll(async () => {
      s = await app.evaluate(({ BrowserWindow }, tabId) => {
        for (const w of BrowserWindow.getAllWindows()) {
          const t = w._filoTabs && w._filoTabs.tabs.find((x) => x.id === tabId);
          if (t) return { url: t.view.webContents.getURL(), titolo: t.view.webContents.getTitle(), carica: t.view.webContents.isLoading(), partizione: t.partition || null };
        }
        return null;
      }, id);
      return !!s && s.url === url && !s.carica && s.titolo.startsWith('C=');
    }, { timeout: 10_000 }).toBe(true);
    await shell.evaluate((t) => window.filoShell.tabs.close(t), id);
    return s;
  }

  testSiti('una voce fidata salvata come suffisso tiene connessi i siti sotto di lei, ognuno nel suo vaso', async ({ app, shell }) => {
    testSiti.setTimeout(90_000);
    await privacy(app, shell, ['co.uk']);
    const bbc = await apri(app, shell, 'www.bbc.co.uk', '/accedi');
    const argos = await apri(app, shell, 'www.argos.co.uk', '/');
    expect(bbc.partizione).toMatch(/^persist:/);
    expect(argos.partizione).toMatch(/^persist:/);
    expect(argos.partizione, 'due siti, due vasi: argos non vede il cookie di bbc').not.toBe(bbc.partizione);
    expect(argos.titolo).toBe('C=-');
    // Un giro sull'elenco dei fidati spazza i vasi orfani: quello di un sito coperto dalla voce resta.
    await privacy(app, shell, ['co.uk', 'esempio.it']);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await apri(app, shell, 'www.bbc.co.uk', '/torno')).titolo).toBe(CONNESSO);
  });

  testSiti('un sito fidato scritto col suo sottodominio resta connesso su tutto il sito', async ({ app, shell }) => {
    testSiti.setTimeout(90_000);
    await privacy(app, shell, ['webmail.libero.it']);
    const a = await apri(app, shell, 'webmail.libero.it', '/accedi');
    expect(a.partizione).toMatch(/^persist:/);
    await privacy(app, shell, ['webmail.libero.it', 'esempio.it']);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await apri(app, shell, 'webmail.libero.it', '/torno')).titolo).toBe(CONNESSO);
    expect((await apri(app, shell, 'www.libero.it', '/')).partizione).toBe(a.partizione);
  });
});

// ---- Porte laterali: canvas WebGL esportato, OffscreenCanvas, canvas senza contesto (#799) ----
// Stessa pagina letta prima con la protezione (Automatico) e poi senza (Off). Le immagini esportate
// si decodificano nella pagina Off, dove nessuna guardia aggiunge rumore alla decodifica.

async function protettaPoiOff(openTab, testServer, probe, arg) {
  const page = await testServer.openReady(openTab, '<title>FP_ON</title><p>ok</p>');
  await page.waitForFunction(() => window.__filoFpGuard === true, null, { timeout: 6_000 });
  const on = await page.evaluate(probe, arg);
  await setFpMode(openTab, 'off');
  await page.goto(testServer.html('<title>FP_OFF</title><p>ok</p>'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
  expect(await page.evaluate(() => !!window.__filoFpGuard)).toBe(false);
  const off = await page.evaluate(probe, arg);
  return { page, on, off };
}

async function decodifica(page, urls) {
  return page.evaluate(async (list) => {
    const out = [];
    for (const u of list) {
      const img = new Image();
      img.src = u;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      out.push(Array.from(x.getImageData(0, 0, c.width, c.height).data));
    }
    return out;
  }, urls);
}

function scarto(a, b) {
  let maxRGB = 0, alpha = 0, diversi = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (d) diversi++;
    maxRGB = Math.max(maxRGB, d);
    if (a[i + 3] !== b[i + 3]) alpha++;
  }
  return { lunghezze: a.length === b.length, maxRGB, alpha, diversi, pixel: a.length / 4 };
}

function attesoRumore(on, off) {
  const s = scarto(on, off);
  expect(s.lunghezze).toBe(true);
  expect(s.diversi).toBeGreaterThan(0);
  expect(s.diversi).toBeLessThan(s.pixel);
  expect(s.maxRGB).toBeLessThanOrEqual(1);
  expect(s.alpha).toBe(0);
}

// readPixels parte dalla riga in basso, l'immagine esportata da quella in alto.
function capovolgi(px, W, H) {
  const out = new Array(px.length);
  for (let r = 0; r < H; r++) {
    for (let k = 0; k < W * 4; k++) out[r * W * 4 + k] = px[(H - 1 - r) * W * 4 + k];
  }
  return out;
}

// Una scena 3D opaca con colori diversi per pixel, esportata come fa un fingerprint della scheda
// grafica: tutto nello stesso compito, prima che il buffer venga presentato.
async function scenaGL({ W, H }) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const gl = c.getContext('webgl', { antialias: false });
  if (!gl) return { webgl: false };
  const sh = (tipo, src) => { const s = gl.createShader(tipo); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram();
  gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }'));
  gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, 'precision mediump float; void main(){ vec2 q = gl_FragCoord.xy; gl_FragColor = vec4(fract(q.x / 17.0), fract(q.y / 13.0), fract((q.x + 2.0 * q.y) / 23.0), 1.0); }'));
  gl.linkProgram(pr);
  gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 0.6, -1, 0.6, 1, -1, 1, 0.6]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.clearColor(0.2, 0.4, 0.6, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  const read = () => { const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return Array.from(px); };
  const u1 = c.toDataURL();
  const u2 = c.toDataURL();
  const r1 = read();
  const r2 = read();
  const blob = await new Promise((res) => c.toBlob(res));
  const fr = new FileReader();
  const ub = await new Promise((res) => { fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
  return { webgl: true, u1, u2, r1, r2, ub, ctxDopo: !!c.getContext('webgl') };
}

test('WebGL: toDataURL, toBlob e readPixels escono col rumore, uguali fra loro e stabili', async ({ openTab, testServer }) => {
  const W = 96, H = 48;
  const { page, on, off } = await protettaPoiOff(openTab, testServer, scenaGL, { W, H });
  expect(off.webgl).toBe(true);
  expect(on.webgl).toBe(true);
  expect(on.u1).not.toBe(off.u1);
  expect(on.u1).toBe(on.u2);
  expect(on.ctxDopo).toBe(true);
  const [imgOn, imgOff, blobOn, blobOff] = await decodifica(page, [on.u1, off.u1, on.ub, off.ub]);
  // La decodifica è esatta: senza protezione immagine e readPixels coincidono.
  expect(scarto(capovolgi(off.r1, W, H), imgOff).diversi).toBe(0);
  attesoRumore(imgOn, imgOff);
  attesoRumore(blobOn, blobOff);
  expect(scarto(blobOn, imgOn).diversi).toBe(0);
  attesoRumore(on.r1, off.r1);
  expect(on.r1).toEqual(on.r2);
  // Lo stesso pixel ha lo stesso rumore da readPixels e dall'immagine esportata.
  expect(scarto(capovolgi(on.r1, W, H), imgOn).diversi).toBe(0);
});

async function scenaOffscreen({ W, H }) {
  const oc = new OffscreenCanvas(W, H);
  const x = oc.getContext('2d');
  for (let i = 0; i < 6; i++) {
    x.fillStyle = `rgb(${40 * i},${200 - 30 * i},${90 + 20 * i})`;
    x.fillRect(Math.floor(i * W / 6), 0, Math.ceil(W / 6), H);
  }
  const g1 = Array.from(x.getImageData(0, 0, W, H).data);
  const g2 = Array.from(x.getImageData(0, 0, W, H).data);
  const ritaglio = Array.from(x.getImageData(10, 5, 20, 10).data);
  const blob = await oc.convertToBlob();
  const fr = new FileReader();
  const ub = await new Promise((res) => { fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
  return { g1, g2, ritaglio, ub };
}

test('OffscreenCanvas: getImageData e convertToBlob escono col rumore, stabili', async ({ openTab, testServer }) => {
  const W = 90, H = 30;
  const { page, on, off } = await protettaPoiOff(openTab, testServer, scenaOffscreen, { W, H });
  attesoRumore(on.g1, off.g1);
  expect(on.g1).toEqual(on.g2);
  const regione = [];
  for (let y = 5; y < 15; y++) regione.push(...on.g1.slice((y * W + 10) * 4, (y * W + 30) * 4));
  expect(on.ritaglio).toEqual(regione);
  const [blobOn, blobOff] = await decodifica(page, [on.ub, off.ub]);
  expect(scarto(blobOff, off.g1).diversi).toBe(0);
  attesoRumore(blobOn, blobOff);
  expect(scarto(blobOn, on.g1).diversi).toBe(0);
});

async function senzaContesto({ W, H }) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const vuoto = c.toDataURL();
  const blob = await new Promise((res) => c.toBlob(res));
  const fr = new FileReader();
  const vuotoBlob = await new Promise((res) => { fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
  const gl = c.getContext('webgl');
  let disegnato = false;
  if (gl) {
    gl.clearColor(0.5, 0.25, 0.75, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    disegnato = px[3] === 255;
  }
  const p = new OffscreenCanvas(W, H);
  const pBlob = await p.convertToBlob();
  const fr2 = new FileReader();
  const vuotoOff = await new Promise((res) => { fr2.onload = () => res(fr2.result); fr2.readAsDataURL(pBlob); });
  return { vuoto, vuotoBlob, vuotoOff, webgl: !!gl, disegnato, offscreenGl: !!p.getContext('webgl') };
}

test('canvas esportato prima di avere un contesto: esce com\'è e può ancora diventare WebGL', async ({ openTab, testServer }) => {
  const { on, off } = await protettaPoiOff(openTab, testServer, senzaContesto, { W: 40, H: 20 });
  expect(off.webgl).toBe(true);
  expect(on.webgl).toBe(true);
  expect(on.disegnato).toBe(true);
  expect(on.offscreenGl).toBe(true);
  expect(on.vuoto).toBe(off.vuoto);
  expect(on.vuotoBlob).toBe(off.vuotoBlob);
  expect(on.vuotoOff).toBe(off.vuotoOff);
});
