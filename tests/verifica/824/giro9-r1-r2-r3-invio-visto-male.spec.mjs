// #824 giro 9: r1 invio di un modulo vero che non passa dal suo bottone, r2 accesso in testata scambiato per
// sessione scaduta, r3 testo mandato attraverso il service worker del sito.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

async function apriEsatta(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => ({ id: t.id, title: t.title, formDirty: t.formDirty })));

async function pulisciTutto(app, shell, sito) {
  await apriEsatta(app, shell, sito.pagina('<!doctype html><title>Altra</title><p>altra pagina'));
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({ decisions: tabs.map((t, i) => ({ i, action: 'archive', reason: 'pulizia' })) });
    return win._filoTabs.runAutoTriage({ trigger: 'manual' });
  });
  return (await schede(shell)).map((t) => t.id);
}

const TESTATA = '<header><form action="/entra" method="post">Utente <input name="u"> Password <input type="password" name="p"><button>Entra</button></form></header>';

async function apriSito() {
  const pagine = new Map();
  let n = 0;
  const server = createServer((req, res) => {
    const [percorso] = req.url.split('?');
    req.on('data', () => {});
    req.on('end', () => {
      if (percorso === '/invia-500') { res.writeHead(500, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Errore</title><p>Errore del server'); return; }
      if (percorso === '/contatto') { res.writeHead(302, { Location: '/grazie' }); res.end(); return; }
      if (percorso === '/grazie') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(`<!doctype html><title>Grazie</title>${TESTATA}<p>Grazie, ti risponderemo presto`); return; }
      if (percorso === '/sw.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',(e)=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',(e)=>{e.respondWith(fetch(e.request));});");
        return;
      }
      if (percorso.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return; }
      const html = pagine.get(percorso.replace(/^\//, ''));
      if (!html) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origine = `http://127.0.0.1:${server.address().port}`;
  return {
    origine,
    pagina(html) { const id = `p${++n}`; pagine.set(id, html); return `${origine}/${id}`; },
    async chiudi() { try { server.closeAllConnections(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

const POST = 'Un post lungo scritto con calma sul consiglio di quartiere di ieri sera';

async function scriviEManda(app, shell, page, titolo) {
  await page.locator('#c').click();
  await page.keyboard.type(POST);
  await expect.poll(async () => (await schede(shell)).find((t) => t.title === titolo)?.formDirty, { timeout: 8_000 }).toBe(true);
  const id = (await schede(shell)).find((t) => t.title === titolo).id;
  await page.locator('#pub').click();
  await expect.poll(async () => (await schede(shell)).find((t) => t.id === id)?.title, { timeout: 10_000 }).not.toBe(titolo);
  await page.waitForTimeout(800);
  return id;
}

test('r1 un modulo vero mandato dalla pagina con uno script e respinto dal sito tiene aperta la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const link = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Forum</title>
      <form id="f" method="post" action="/invia-500"><textarea name="corpo" id="c" style="width:400px;height:100px"></textarea></form>
      <a href="#" id="pub" onclick="document.getElementById('f').submit();return false">Pubblica</a>`));
    const idLink = await scriviEManda(app, shell, link, 'Forum');
    const anti = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Contatti</title>
      <form id="f" method="post" action="/invia-500"><textarea name="corpo" id="c" style="width:400px;height:100px"></textarea><button id="pub">Invia</button></form>
      <script>f.addEventListener('submit', (e) => { e.preventDefault(); setTimeout(() => f.submit(), 300); });</script>`));
    const idAnti = await scriviEManda(app, shell, anti, 'Contatti');
    const ed = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Classe</title>
      <form id="f" method="post" action="/invia-500"><textarea name="corpo" id="nasc" style="display:none"></textarea>
      <iframe id="ifr" style="width:420px;height:120px"></iframe><button id="pub">Invia</button></form>
      <script>const d = ifr.contentDocument; d.open(); d.write('<body contenteditable="true" id="c" style="min-height:100px"></body>'); d.close();
        f.addEventListener('submit', () => { nasc.value = ifr.contentDocument.body.innerHTML; });</script>`));
    await ed.frameLocator('#ifr').locator('body').click();
    await ed.keyboard.type(POST);
    await expect.poll(async () => (await schede(shell)).find((t) => t.title === 'Classe')?.formDirty, { timeout: 8_000 }).toBe(true);
    const idEd = (await schede(shell)).find((t) => t.title === 'Classe').id;
    await ed.locator('#pub').click();
    await expect.poll(async () => (await schede(shell)).find((t) => t.id === idEd)?.title, { timeout: 10_000 }).not.toBe('Classe');
    await ed.waitForTimeout(800);
    const aperte = await pulisciTutto(app, shell, sito);
    expect.soft(aperte, 'collegamento «Pubblica»').toContain(idLink);
    expect.soft(aperte, 'controllo antispam').toContain(idAnti);
    expect.soft(aperte, 'editor classico in un riquadro').toContain(idEd);
  } finally { await sito.chiudi(); }
});

test('r2 un modulo mandato bene a un sito con l’accesso in testata non protegge la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Scrivici</title>${TESTATA}
      <form method="post" action="/contatto"><textarea name="msg" id="c" style="width:400px;height:100px"></textarea><button id="pub">Invia</button></form>`));
    const id = await scriviEManda(app, shell, page, 'Scrivici');
    const aperte = await pulisciTutto(app, shell, sito);
    expect(aperte).not.toContain(id);
  } finally { await sito.chiudi(); }
});

test('r3 un post mandato da una finestrella attraverso il service worker del sito non protegge la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Social</title>
      <div id="box"><textarea id="c" style="width:400px;height:100px"></textarea><button id="pub">Pubblica</button></div><p id="esito"></p>
      <script>
        window.pronto = navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then(() => new Promise((r) => {
          if (navigator.serviceWorker.controller) return r(true);
          navigator.serviceWorker.addEventListener('controllerchange', () => r(true));
        }));
        pub.onclick = async () => { const t = c.value; await fetch('/api/post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testo: t }) });
          box.remove(); esito.textContent = 'Post pubblicato'; };
      </script>`));
    expect(await page.evaluate(() => window.pronto)).toBe(true);
    await page.locator('#c').click();
    await page.keyboard.type(POST);
    await expect.poll(async () => (await schede(shell)).find((t) => t.title === 'Social')?.formDirty, { timeout: 8_000 }).toBe(true);
    const id = (await schede(shell)).find((t) => t.title === 'Social').id;
    await page.locator('#pub').click();
    await expect(page.locator('#esito')).toHaveText('Post pubblicato');
    await page.waitForTimeout(800);
    const aperte = await pulisciTutto(app, shell, sito);
    expect(aperte).not.toContain(id);
  } finally { await sito.chiudi(); }
});
