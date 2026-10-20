// Verifica #1057 giro 4: sonde sui riquadri dello stesso sito che non arrivano o che non si toccano.
import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PAGINA = `<!doctype html><meta charset="utf-8"><title>Modulo</title>
<textarea id="nota" style="position:fixed;top:20px;left:20px;width:300px;height:60px"></textarea>
<button id="vai" style="position:fixed;top:120px;left:20px">Vai</button>
<script>
  const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));
  document.getElementById('vai').addEventListener('click', () => {
    let p;
    try { p = Promise.resolve(window.__azione()); } catch (e) { p = Promise.reject(e); }
    p.then((x) => m(String(x)), (e) => m('ERR:' + (e && e.name)));
  });
</script>`;
const esiti = [];
let server, origine;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    if (u.pathname === '/lento') { const t = setTimeout(() => { try { res.end('x'); } catch (_) {} }, 30_000); t.unref?.(); return; }
    if (u.pathname === '/niente') { res.writeHead(204); res.end(); return; }
    if (u.pathname === '/scarica') { res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="a.bin"' }); res.end('abc'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGINA);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  origine = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((ok) => server.close(ok)); });

let app, shell, userData;
test.beforeEach(async () => {
  esiti.length = 0;
  userData = cartellaTemporanea('filo-test-v1057-');
  app = await electron.launch({
    args: [...argomentiScala, '--use-fake-device-for-media-stream', '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
});
test.afterEach(async () => { await chiudiApp(app); try { rmSync(userData, { recursive: true, force: true }); } catch (_) {} });

const paginaDi = (base) => app.windows().find((w) => w.url().startsWith(base));
const barra = () => shell.locator('#permesso-bar');
async function apri() {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + '/modulo');
  await expect.poll(() => Boolean(paginaDi(origine)), { timeout: 10_000 }).toBe(true);
  const p = paginaDi(origine);
  await p.waitForLoadState('load');
  return p;
}

const SOLO_AUDIO = `{ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video: false }`;
const PRESA = {
  'stesso sito in volo, preso subito': `(() => { const f = document.createElement('iframe'); f.src = '/lento'; document.body.append(f); return window[window.length - 1]; })()`,
  'stesso sito in volo, preso dopo un secondo': `(async () => { const f = document.createElement('iframe'); f.src = '/lento'; document.body.append(f); await new Promise((r) => setTimeout(r, 1000)); return window[window.length - 1]; })()`,
  'stesso sito che risponde 204': `(async () => { const f = document.createElement('iframe'); f.src = '/niente'; document.body.append(f); await new Promise((r) => setTimeout(r, 1500)); return window[window.length - 1]; })()`,
  'stesso sito che scarica un file': `(async () => { const f = document.createElement('iframe'); f.src = '/scarica'; document.body.append(f); await new Promise((r) => setTimeout(r, 1500)); return window[window.length - 1]; })()`,
  'srcdoc, preso subito': `(() => { const f = document.createElement('iframe'); f.srcdoc = '<p>ciao</p>'; document.body.append(f); return window[window.length - 1]; })()`,
  'srcdoc, dopo il load': `(async () => { const f = document.createElement('iframe'); f.srcdoc = '<p>ciao</p>'; await new Promise((ok) => { f.onload = ok; document.body.append(f); }); return window[window.length - 1]; })()`,
  'radice ombra per indice accanto a uno in volo': `(async () => { const l = document.createElement('iframe'); l.src = '/niente'; document.body.append(l); await new Promise((r) => setTimeout(r, 1500)); const h = document.createElement('div'); document.body.appendChild(h); h.attachShadow({ mode: 'closed' }).appendChild(document.createElement('iframe')); return window[window.length - 1]; })()`,
};
for (const [nome, presa] of Object.entries(PRESA)) {
  test(`schermo vecchio: ${nome}`, async () => {
    test.setTimeout(90_000);
    const p = await apri();
    await p.locator('#nota').fill('appunti da non perdere');
    const codice = `const w = await ${presa}; return w.MediaDevices.prototype.getUserMedia.call(navigator.mediaDevices, ${SOLO_AUDIO});`;
    await p.evaluate((c) => { window.__azione = new Function(`return (async () => { const s = await (async () => { ${c} })(); return 'OK:' + s.getTracks().map((t) => t.kind).join(','); })()`); }, codice);
    await p.locator('#vai').click({ timeout: 10_000 }).catch(() => {});
    const fonte = barra().locator('.permesso-fonte[data-tipo="schermo"]');
    await expect.poll(async () => esiti.length > 0 || !paginaDi(origine) || await fonte.isVisible().catch(() => false), { timeout: 15_000 }).toBe(true);
    if (await fonte.isVisible().catch(() => false)) await fonte.click();
    await expect.poll(() => esiti.slice(), { timeout: 10_000, message: 'la pagina riceve un no' }).toEqual(['ERR:NotAllowedError']);
    await new Promise((r) => setTimeout(r, 1500));
    expect(paginaDi(origine), 'la scheda è ancora il sito').toBeTruthy();
    expect(await paginaDi(origine).evaluate(() => document.querySelector('#nota').value)).toBe('appunti da non perdere');
  });
}

for (const nome of ['stesso sito in volo, preso subito', 'srcdoc, dopo il load', 'stesso sito che risponde 204']) {
  test(`stato: ${nome}`, async () => {
    test.setTimeout(60_000);
    const p = await apri();
    const r = await p.evaluate(async (presa) => {
      const w = await eval(presa);
      const out = {};
      for (const n of ['camera', 'microphone', 'geolocation', 'notifications']) {
        try { out[n] = (await w.navigator.permissions.query({ name: n })).state; } catch (e) { out[n] = 'ERR'; }
      }
      out.notifica = w.Notification && w.Notification.permission;
      out.url = w.location.href;
      return out;
    }, PRESA[nome]);
    expect(r).toMatchObject({ camera: 'prompt', microphone: 'prompt', geolocation: 'prompt', notifications: 'prompt', notifica: 'default' });
  });
}
