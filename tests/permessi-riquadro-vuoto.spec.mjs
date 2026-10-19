// Lo schermo chiesto alla maniera vecchia da un riquadro vuoto che la pagina si crea e prende per indice (#1057): la
// scheda non muore, la domanda è quella di Filo, e i permessi mai decisi si leggono «da chiedere» anche lì dentro.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { argomentiScala } from './helpers/scala.mjs';
import { chiudiApp } from './fixtures/electron.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Ogni variante crea il suo riquadro vuoto e ne prende la funzione per indice, come la prova del giro 16 di #586.
const VARIANTI = {
  'solo-audio': `{ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video: false }`,
  'microfono-e-schermo': `{ audio: true, video: { mandatory: { chromeMediaSource: 'desktop' } } }`,
  'schermo-e-audio': `{ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video: { mandatory: { chromeMediaSource: 'desktop' } } }`,
};
const MODO = {
  // La funzione del riquadro sui dispositivi della pagina.
  prototipo: `w.MediaDevices.prototype.getUserMedia.call(navigator.mediaDevices, c)`,
  // I dispositivi del riquadro stesso.
  proprio: `w.navigator.mediaDevices.getUserMedia(c)`,
  // La strada a callback, quella più vecchia ancora.
  callback: `new Promise((ok, no) => w.navigator.webkitGetUserMedia(c, ok, no))`,
};

const pagina = (modo) => `<!doctype html><meta charset="utf-8"><title>Modulo</title>
<textarea id="nota" style="position:fixed;top:20px;left:20px;width:300px;height:60px"></textarea>
${Object.keys(VARIANTI).map((v, i) => `<button id="${v}" style="position:fixed;top:${120 + i * 50}px;left:20px">${v}</button>`).join('\n')}
<script>
  const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
  const vuoto = () => { document.body.appendChild(document.createElement('iframe')); return window[window.length - 1]; };
  const VARIANTI = { ${Object.entries(VARIANTI).map(([k, v]) => `'${k}': () => (${v})`).join(', ')} };
  for (const nome of Object.keys(VARIANTI)) {
    document.getElementById(nome).addEventListener('click', () => {
      const w = vuoto();
      const c = VARIANTI[nome]();
      let p;
      try { p = ${MODO[modo]}; } catch (e) { p = Promise.reject(e); }
      p.then((s) => m(nome + ':' + s.getTracks().map((t) => t.kind).sort().join(',')), (e) => m(nome + ':' + e.name));
    });
  }
  // Stato dei permessi letto dal riquadro vuoto, sia dal suo navigator sia con la sua funzione su quello della pagina.
  addEventListener('load', async () => {
    const w = vuoto();
    const nomi = ['camera', 'microphone', 'geolocation', 'notifications'];
    const leggi = (f) => Promise.all(nomi.map((n) => f(n).then((s) => n + '=' + s.state, (e) => n + '=!' + e.name)));
    const dentro = await leggi((n) => w.navigator.permissions.query({ name: n }));
    const misto = await leggi((n) => w.Permissions.prototype.query.call(navigator.permissions, { name: n }));
    m('stato:' + dentro.join(',') + ',Notification=' + w.Notification.permission);
    m('misto:' + misto.join(','));
  });
</script>`;

const esiti = [];
let server;
let origine;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const modo = u.pathname.slice(1);
    res.end(MODO[modo] ? pagina(modo) : '<p>vuota</p>');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  origine = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  try { server.closeAllConnections?.(); } catch (_) {}
  await new Promise((ok) => server.close(ok));
});

let app;
let shell;
let userData;
test.beforeEach(async () => {
  esiti.length = 0;
  userData = cartellaTemporanea('filo-test-riquadro-vuoto-');
  app = await electron.launch({
    args: [...argomentiScala, '--use-fake-device-for-media-stream', '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
});
test.afterEach(async () => {
  await chiudiApp(app);
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});

const paginaDi = (base) => app.windows().find((w) => w.url().startsWith(base));
const barra = () => shell.locator('#permesso-bar');

async function apri(modo) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), `${origine}/${modo}`);
  await expect.poll(() => Boolean(paginaDi(origine)), { timeout: 10_000 }).toBe(true);
  const p = paginaDi(origine);
  await p.waitForLoadState('load');
  return p;
}

for (const modo of Object.keys(MODO)) {
  test(`schermo alla vecchia da un riquadro vuoto preso per indice (${modo}): la scheda resta, il testo pure, e la domanda è quella di Filo`, async () => {
    test.setTimeout(90_000);
    const p = await apri(modo);
    await p.locator('#nota').fill('appunti da non perdere');
    for (const nome of Object.keys(VARIANTI)) {
      await p.locator('#' + nome).click();
      // Chi la usa vede la stessa domanda dello schermo; anche scegliendo, al sito non arriva niente.
      await expect(barra(), nome).toBeVisible({ timeout: 10_000 });
      const fonte = barra().locator('.permesso-fonte[data-tipo="schermo"]');
      await expect(fonte).toBeEnabled({ timeout: 5_000 });
      await fonte.click();
      await expect(barra()).toBeHidden({ timeout: 10_000 });
      await expect.poll(() => esiti.filter((x) => x.startsWith(nome + ':')), { timeout: 10_000 }).toEqual([nome + ':NotAllowedError']);
    }
    await new Promise((r) => setTimeout(r, 1500));
    expect(paginaDi(origine), 'la scheda è ancora il sito, non la pagina d\'errore').toBeTruthy();
    expect(await paginaDi(origine).evaluate(() => document.querySelector('#nota').value)).toBe('appunti da non perdere');
    await expect(shell.locator('.tab .tab-permessi .segno[data-parte="schermo"]')).toHaveCount(0);
  });
}

test('nel riquadro vuoto preso per indice fotocamera, microfono, posizione e notifiche mai decisi si leggono «da chiedere»', async () => {
  test.setTimeout(60_000);
  await apri('prototipo');
  const attesi = 'camera=prompt,microphone=prompt,geolocation=prompt,notifications=prompt';
  await expect.poll(() => esiti.find((x) => x.startsWith('stato:')), { timeout: 10_000 }).toBe(`stato:${attesi},Notification=default`);
  await expect.poll(() => esiti.find((x) => x.startsWith('misto:')), { timeout: 10_000 }).toBe(`misto:${attesi}`);
});
