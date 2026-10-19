// Verifica #1057 giro 1, rilievo 3: la finestra vuota che la pagina apre con window.open legge negati i permessi mai
// decisi e il microfono chiesto da lì riceve un no senza domanda.
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



test('r3 la finestra vuota aperta dalla pagina legge «da chiedere» e il microfono passa dalla domanda di Filo', async () => {
  test.setTimeout(90_000);
  const p = await apri();
  await p.evaluate(() => { window.__azione = async () => {
    const w = window.open('', '_blank', 'width=200,height=200');
    const o = [];
    for (const n of ['camera', 'microphone', 'geolocation']) o.push(n + '=' + (await w.navigator.permissions.query({ name: n })).state);
    fetch('/esito?m=' + encodeURIComponent(o.join(' ')));
    const s = await w.navigator.mediaDevices.getUserMedia({ audio: true });
    return 'OK:' + s.getTracks().map((t) => t.kind).join(',');
  }; });
  await p.locator('#vai').click();
  await expect.poll(() => esiti.slice(0, 1), { timeout: 10_000 }).toEqual(['camera=prompt microphone=prompt geolocation=prompt']);
  await expect(barra()).toContainText('vuole usare il microfono', { timeout: 10_000 });
  await barra().getByRole('button', { name: 'Consenti', exact: true }).click();
  await expect.poll(() => esiti.slice(1), { timeout: 10_000 }).toEqual(['OK:audio']);
});
