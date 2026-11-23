// Verifica #591.7, giro 1: la copia nascosta non deve aprire la finestra di stampa del sistema, per nessuna strada.
// Ogni caso conta sulla stampa che, se apre la sua finestra, ferma la pagina sulla chiamata: «dopo:stampa» non arriva.

import { test, expect, _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { argomentiScala } from '../../helpers/scala.mjs';
import { chiudiApp } from '../../fixtures/electron.mjs';
import { primaFinestra } from '../../helpers/primaFinestra.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const esiti = [];
const SEGNA = `const m = (x) => fetch('/esito?m=' + encodeURIComponent(x));`;
const STAMPA = `setTimeout(() => { m('prima:stampa'); window.print(); m('dopo:stampa'); }, 300);`;
let porta = 0;

const pagine = {
  '/avviso': () => `<!doctype html><meta charset="utf-8"><title>Avviso</title><p>Il tuo computer è infetto</p>
<script>${SEGNA}
  addEventListener('load', () => {
    setTimeout(() => { alert('Il tuo computer è infetto, chiama il numero'); m('dopo:avviso'); }, 100);
    ${STAMPA}
  });
</script>`,
  // La stampa chiesta da un riquadro di un altro sito, a pagina caricata.
  '/riquadro': () => `<!doctype html><meta charset="utf-8"><title>Riquadro</title>
<iframe src="http://localhost:${porta}/stampa-sola"></iframe>`,
  '/stampa-sola': () => `<!doctype html><meta charset="utf-8"><script>${SEGNA}
  addEventListener('load', () => { ${STAMPA} });</script>`,
  // Un riquadro senza indirizzo, scritto dalla pagina, chiede la stampa.
  '/riquadro-vuoto': () => `<!doctype html><meta charset="utf-8"><title>Vuoto</title><iframe id="f"></iframe>
<script>${SEGNA}
  addEventListener('load', () => setTimeout(() => {
    const w = document.getElementById('f').contentWindow;
    m('prima:stampa'); w.print(); m('dopo:stampa');
  }, 300));</script>`,
  // La pagina si riapre da un blob: che si è scritta da sola.
  '/blob': () => `<!doctype html><meta charset="utf-8"><title>Blob</title><script>${SEGNA}
  addEventListener('load', () => {
    const html = '<!doctype html><scr' + 'ipt>const m = (x) => fetch("${origine}/esito?m=" + encodeURIComponent(x));'
      + 'm("blob:aperta"); addEventListener("load", () => setTimeout(() => { m("prima:stampa"); print(); m("dopo:stampa"); }, 300));</scr' + 'ipt>';
    location.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  });</script>`,
  // La pagina si fa servire da un suo service worker e si ricarica.
  '/sw-pagina': () => `<!doctype html><meta charset="utf-8"><title>SW</title><script>${SEGNA}
  m('rete:pagina');
  addEventListener('load', async () => {
    if (sessionStorage.getItem('giro')) { m('rete:dopo-ricarica'); return; }
    try {
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      sessionStorage.setItem('giro', '1');
      m('sw:pronto');
      location.reload();
    } catch (e) { m('sw:errore:' + e.message); }
  });</script>`,
  // Il controllo profondo (non la ricerca della destinazione): un rimando, poi la pagina che stampa.
  '/rimando': null,
};

const SW = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(new Response('<!doctype html><script>const m = (x) => fetch("/esito?m=" + encodeURIComponent(x)); m("sw:servita");'
    + 'addEventListener("load", () => setTimeout(() => { m("prima:stampa"); print(); m("dopo:stampa"); }, 300));</scr' + 'ipt>',
    { headers: { 'Content-Type': 'text/html' } }));
});`;

let server;
let origine;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/esito') { esiti.push(u.searchParams.get('m')); res.setHeader('Access-Control-Allow-Origin', '*'); res.end('ok'); return; }
    if (u.pathname === '/sw.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(SW); return; }
    if (u.pathname === '/rimando') { res.writeHead(302, { Location: '/avviso' }); res.end(); return; }
    const p = pagine[u.pathname];
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(p ? p() : '<!doctype html><p>niente</p>');
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  porta = server.address().port;
  origine = `http://127.0.0.1:${porta}`;
});
test.afterAll(async () => {
  try { server.closeAllConnections?.(); } catch (_) {}
  await new Promise((ok) => server.close(ok));
});

let app;
let userData;
test.beforeEach(async () => {
  esiti.length = 0;
  userData = cartellaTemporanea('filo-verifica-5917-');
  app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  const shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
  app.on('window', (p) => p.on('dialog', () => {}));
});
test.afterEach(async () => {
  await chiudiApp(app);
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
});

const destinazione = (percorso) => app.evaluate(async (_e, u) => {
  await globalThis.SN_SAFEBROWSE.sandbox.destinazione(u, () => true);
  return true;
}, origine + percorso);

for (const [nome, percorso] of [
  ['finto avviso', '/avviso'],
  ['riquadro di un altro sito', '/riquadro'],
  ['riquadro senza indirizzo', '/riquadro-vuoto'],
  ['pagina riaperta da blob', '/blob'],
  ['pagina servita dal suo service worker', '/sw-pagina'],
]) {
  test(`destinazione: ${nome}, la stampa non apre la sua finestra`, async () => {
    test.setTimeout(60_000);
    expect(await destinazione(percorso)).toBe(true);
    console.log(nome, JSON.stringify(esiti));
    if (esiti.includes('prima:stampa')) expect(esiti, 'la stampa non apre la sua finestra').toContain('dopo:stampa');
  });
}

for (const [nome, corpo] of [
  ['meta refresh', '<meta http-equiv="refresh" content="0;url=/arrivo">'],
  ['script', '<script>location.replace("/arrivo")</script>'],
  ['script a pagina caricata', '<script>addEventListener("load", () => setTimeout(() => { location.href = "/arrivo"; }, 200))</script>'],
]) {
  test(`destinazione: l'accorciatore che rimanda con ${nome} si segue ancora`, async () => {
    test.setTimeout(60_000);
    pagine['/accorciatore'] = () => `<!doctype html><meta charset="utf-8">${corpo}`;
    const r = await app.evaluate(async (_e, u) => {
      const v = await globalThis.SN_SAFEBROWSE.sandbox.destinazione(u, (x) => !x.endsWith('/arrivo'));
      return v && v.destinazione;
    }, origine + '/accorciatore');
    expect(r).toBe(origine + '/arrivo');
  });
}

test('controllo profondo: rimando a un finto avviso, la stampa non apre la sua finestra', async () => {
  test.setTimeout(60_000);
  const r = await app.evaluate(async (_e, u) => {
    // Il verdetto sull'indirizzo d'arrivo prende un paio di secondi, come un controllo vero in rete.
    const v = await globalThis.SN_SAFEBROWSE.sandbox.detonate(u, () => new Promise((ok) => setTimeout(() => ok({ level: 'pulito' }), 2500)));
    return v && v.verdict;
  }, origine + '/rimando');
  console.log('detonate', r, JSON.stringify(esiti));
  expect(esiti).toContain('prima:stampa');
  expect(esiti, 'la stampa non apre la sua finestra').toContain('dopo:stampa');
});
