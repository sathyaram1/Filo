// Verifica #1057 giro 1, rilievo 1: vincoli che cambiano fra la lettura di Filo e quella di Chromium fanno morire la
// scheda con la richiesta vecchia dell'audio del computer, dalla pagina e dal riquadro vuoto preso per indice.
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
    p.then((x) => m(String(x)), (e) => m('ERR:' + (e && e.name) + ':' + (e && e.message)));
  });
</script>`;
const esiti = [];
let server, origine, altra;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (u.pathname === '/terzo') { res.end(PAGINA.replace("fetch('/esito", "fetch(location.origin + '/esito")); return; }
    if (u.pathname === '/ospite') { res.end(PAGINA + `<iframe id="t" src="${altra}/terzo" style="position:fixed;top:200px;left:20px;width:400px;height:200px"></iframe>`); return; }
    res.end(PAGINA);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  origine = `http://127.0.0.1:${server.address().port}`;
  altra = `http://altro-sito.test:${server.address().port}`;
});
test.afterAll(async () => { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((ok) => server.close(ok)); });

let app, shell, userData;
test.beforeEach(async () => {
  esiti.length = 0;
  userData = cartellaTemporanea('filo-test-v1057-');
  app = await electron.launch({
    args: [...argomentiScala, '--use-fake-device-for-media-stream', `--host-resolver-rules=MAP altro-sito.test 127.0.0.1`, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
});
test.afterEach(async () => { await chiudiApp(app); try { rmSync(userData, { recursive: true, force: true }); } catch (_) {} });

const paginaDi = (base) => app.windows().find((w) => w.url().startsWith(base));
const barra = () => shell.locator('#permesso-bar');
async function apri(percorso = '/modulo') {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + percorso);
  await expect.poll(() => Boolean(paginaDi(origine)), { timeout: 10_000 }).toBe(true);
  const p = paginaDi(origine);
  await p.waitForLoadState('load');
  return p;
}



const VUOTO = `(() => { document.body.appendChild(document.createElement('iframe')); return window[window.length - 1]; })()`;
// Il primo sguardo vede un vincolo innocuo, il secondo la strada vecchia.
const CAMBIA = `(() => { let n = 0; return { get mandatory() { n++; return n < 2 ? {} : { chromeMediaSource: 'desktop' }; } }; })()`;
const CASI = {
  'riquadro vuoto per indice, solo l\'audio del computer': `const w = ${VUOTO}; return w.MediaDevices.prototype.getUserMedia.call(navigator.mediaDevices, { audio: ${CAMBIA}, video: false });`,
  'riquadro vuoto per indice, vincoli dietro un Proxy': `const w = ${VUOTO}; let n = 0; const c = new Proxy({ video: false }, { get(t, k) { if (k === 'audio') { n++; return n < 2 ? true : { mandatory: { chromeMediaSource: 'desktop' } }; } return t[k]; } }); return w.MediaDevices.prototype.getUserMedia.call(navigator.mediaDevices, c);`,
  'riquadro vuoto, la sua funzione': `const w = ${VUOTO}; return w.navigator.mediaDevices.getUserMedia({ audio: ${CAMBIA}, video: false });`,
  'pagina, solo l\'audio del computer': `return navigator.mediaDevices.getUserMedia({ audio: ${CAMBIA}, video: false });`,
  'pagina, microfono e schermo': `return navigator.mediaDevices.getUserMedia({ audio: true, video: ${CAMBIA} });`,
};
for (const [nome, codice] of Object.entries(CASI)) {
  test(`r1 ${nome}: la scheda resta, il testo pure, e al sito arriva un no`, async () => {
    test.setTimeout(90_000);
    const p = await apri();
    await p.locator('#nota').fill('appunti da non perdere');
    await p.evaluate((c) => { window.__azione = new Function(`return (async () => { const s = await (async () => { ${c} })(); return 'OK:' + s.getTracks().map((t) => t.kind).join(','); })()`); }, codice);
    await p.locator('#vai').click({ timeout: 10_000 }).catch(() => {});
    // Se Filo chiede, si sceglie lo schermo come farebbe l'utente: anche così al sito arriva un no.
    const fonte = barra().locator('.permesso-fonte[data-tipo="schermo"]');
    await expect.poll(async () => esiti.length > 0 || !paginaDi(origine) || await fonte.isVisible().catch(() => false), { timeout: 15_000 }).toBe(true);
    if (await fonte.isVisible().catch(() => false)) await fonte.click();
    await expect.poll(() => esiti.slice(), { timeout: 10_000, message: 'la pagina riceve un no' }).toEqual(['ERR:NotAllowedError:Permission denied']);
    await new Promise((r) => setTimeout(r, 1500));
    expect(paginaDi(origine), 'la scheda è ancora il sito, non la pagina d\'errore').toBeTruthy();
    expect(await paginaDi(origine).evaluate(() => document.querySelector('#nota').value)).toBe('appunti da non perdere');
  });
}
