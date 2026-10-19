// Verifica #1057 giro 2: altre strade per un riquadro vuoto di fabbrica, prese prima che Filo lo sistemi.
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
    p.then((x) => m(String(x)), (e) => m(e && e.name));
  });
</script>`;
const esiti = [];
let server, origine;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.end('ok'); return; }
    if (u.pathname === '/lento') { const t = setTimeout(() => { try { res.end('x'); } catch (_) {} }, 20_000); t.unref?.(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (u.pathname === '/statico') { res.end(PAGINA + '<iframe></iframe>'); return; }
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
async function apri(percorso = '/modulo') {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), origine + percorso);
  await expect.poll(() => Boolean(paginaDi(origine)), { timeout: 10_000 }).toBe(true);
  const p = paginaDi(origine);
  await p.waitForLoadState('load');
  return p;
}

const SOLO_AUDIO = `{ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video: false }`;
const CHIEDI = `w.MediaDevices.prototype.getUserMedia.call(navigator.mediaDevices, ${SOLO_AUDIO})`;
const STRADE = {
  'elemento personalizzato inserito insieme a un riquadro che aspetta il suo indirizzo': ['/modulo', `
    let w; customElements.define('x-spia', class extends HTMLElement { connectedCallback() { w = window[window.length - 1]; } });
    const fr = document.createDocumentFragment(); const f = document.createElement('iframe'); f.src = '/lento';
    fr.append(f, document.createElement('x-spia')); document.body.append(fr);
    return await ${CHIEDI};`],
  'script inserito insieme a un riquadro che aspetta il suo indirizzo': ['/modulo', `
    const fr = document.createDocumentFragment(); const f = document.createElement('iframe'); f.src = '/lento';
    const s = document.createElement('script'); s.textContent = 'window.__w = window[window.length - 1];';
    fr.append(f, s); document.body.append(fr); const w = window.__w;
    return await ${CHIEDI};`],
  'riquadro scritto nella pagina fin dall\\'inizio': ['/statico', `const w = window[0]; return await ${CHIEDI};`],
  'riquadro srcdoc': ['/modulo', `const f = document.createElement('iframe'); f.srcdoc = '<p>x</p>'; document.body.append(f);
    await new Promise((ok) => f.addEventListener('load', ok, { once: true })); const w = window[window.length - 1]; return await ${CHIEDI};`],
  'riquadro blob': ['/modulo', `const f = document.createElement('iframe'); f.src = URL.createObjectURL(new Blob(['<p>x</p>'], { type: 'text/html' })); document.body.append(f);
    await new Promise((ok) => f.addEventListener('load', ok, { once: true })); const w = window[window.length - 1]; return await ${CHIEDI};`],
  'riquadro javascript:': ['/modulo', `const f = document.createElement('iframe'); document.body.append(f); f.src = "javascript:'<p>x</p>'";
    await new Promise((ok) => f.addEventListener('load', ok, { once: true })); const w = window[window.length - 1]; return await ${CHIEDI};`],
};
for (const [nome, [percorso, codice]] of Object.entries(STRADE)) {
  test(`sonda ${nome}: la scheda resta, il testo pure, e al sito arriva un no`, async () => {
    test.setTimeout(60_000);
    const p = await apri(percorso);
    await p.locator('#nota').fill('appunti da non perdere');
    await p.evaluate((c) => { window.__azione = new Function(`return (async () => { const s = await (async () => { ${c} })(); return 'OK:' + s.getTracks().map((t) => t.kind).join(','); })()`); }, codice);
    await p.locator('#vai').click({ timeout: 10_000 }).catch(() => {});
    const fonte = barra().locator('.permesso-fonte[data-tipo="schermo"]');
    await expect.poll(async () => esiti.length > 0 || !paginaDi(origine) || await fonte.isVisible().catch(() => false), { timeout: 15_000 }).toBe(true);
    if (await fonte.isVisible().catch(() => false)) await fonte.click();
    await expect.poll(() => esiti.slice(), { timeout: 10_000, message: 'la pagina riceve un no' }).toEqual(['NotAllowedError']);
    await new Promise((r) => setTimeout(r, 1500));
    expect(paginaDi(origine), 'la scheda è ancora il sito, non la pagina d\'errore').toBeTruthy();
    expect(await paginaDi(origine).evaluate(() => document.querySelector('#nota').value)).toBe('appunti da non perdere');
  });
}
