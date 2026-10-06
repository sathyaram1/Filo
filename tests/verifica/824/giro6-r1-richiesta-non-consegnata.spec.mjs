// #824 giro 6, rilievo 1: una richiesta che porta il testo al sito non vuol dire che il sito l'abbia
// tenuto (rifiuto del server, connessione caduta, anteprima): la scheda resta aperta col testo.

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

const moduloDi = (shell, title) => shell.evaluate(async (t) => {
  const s = await window.filoShell.tabs.snapshot();
  const tab = s.tabs.find((x) => x.title === t);
  return tab ? tab.formDirty : null;
}, title);

const titoliAperti = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.title));

async function pulisciTutto(app, shell, sito) {
  await apriEsatta(app, shell, sito.pagina('<!doctype html><title>Altra</title><p>altra pagina'));
  return app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({
      decisions: tabs.map((t, i) => ({ i, action: 'archive', reason: 'pulizia' })),
    });
    return win._filoTabs.runAutoTriage({ trigger: 'manual' });
  });
}

// Il sito risponde come i siti veri: un rifiuto, una connessione che cade, un'anteprima.
async function apriSito() {
  const pagine = new Map();
  let n = 0;
  const server = createServer((req, res) => {
    const percorso = req.url.split('?')[0];
    let corpo = '';
    req.on('data', (c) => { if (corpo.length < 100_000) corpo += c; });
    req.on('end', () => {
      if (percorso === '/api/rispondi') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ errore: 'Devi accedere per rispondere' }));
        return;
      }
      if (percorso === '/api/manda') { req.socket.destroy(); return; }
      if (percorso === '/api/anteprima') {
        let t = '';
        try { t = JSON.parse(corpo).testo || ''; } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<p>' + t.replace(/[<&]/g, '').replace(/\n/g, '<br>') + '</p>');
        return;
      }
      const html = pagine.get(percorso.replace(/^\//, ''));
      if (!html) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origine = `http://127.0.0.1:${server.address().port}`;
  return {
    pagina(html) { const id = `p${++n}`; pagine.set(id, html); return `${origine}/${id}`; },
    async chiudi() { try { server.closeAllConnections(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

test('r1 la risposta respinta dal server resta protetta', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><html><head><title>Rifiutata</title></head><body>
      <textarea id="corpo" style="width:400px;height:100px"></textarea><button id="pub">Pubblica la risposta</button><p id="err"></p>
      <script>pub.onclick = async () => { const r = await fetch('/api/rispondi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testo: corpo.value }) });
        if (!r.ok) err.textContent = (await r.json()).errore; };</script>
      </body></html>`));
    const TESTO = 'Il problema nasce dal ciclo che non si ferma mai';
    await page.locator('#corpo').click();
    await page.keyboard.type(TESTO);
    await expect.poll(() => moduloDi(shell, 'Rifiutata'), { timeout: 8_000 }).toBe(true);
    await page.locator('#pub').click();
    await expect(page.locator('#err')).toHaveText('Devi accedere per rispondere');
    await page.waitForTimeout(800);

    await pulisciTutto(app, shell, sito);
    expect(await titoliAperti(shell)).toContain('Rifiutata');
    expect(await page.locator('#corpo').inputValue()).toBe(TESTO);
  } finally { await sito.chiudi(); }
});

test('r1 il messaggio che non parte per la connessione caduta resta protetto', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><html><head><title>Caduta</title></head><body>
      <textarea id="mail" style="width:400px;height:100px"></textarea><button id="invia">Invia</button><p id="err"></p>
      <script>invia.onclick = async () => { try { await fetch('/api/manda', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ corpo: mail.value }) }); }
        catch (_) { err.textContent = 'Non sono riuscito a inviare: controlla la connessione'; } };</script>
      </body></html>`));
    await page.locator('#mail').click();
    await page.keyboard.type('Ciao Marco, ti mando il riepilogo della riunione di ieri');
    await expect.poll(() => moduloDi(shell, 'Caduta'), { timeout: 8_000 }).toBe(true);
    await page.locator('#invia').click();
    await expect(page.locator('#err')).toHaveText(/controlla la connessione/);
    await page.waitForTimeout(800);

    await pulisciTutto(app, shell, sito);
    expect(await titoliAperti(shell)).toContain('Caduta');
  } finally { await sito.chiudi(); }
});

test('r1 il commento mandato solo per l’anteprima resta protetto', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><html><head><title>Commento</title></head><body>
      <textarea id="c" style="width:400px;height:100px"></textarea><button id="ant">Anteprima</button><button id="com">Commenta</button><div id="vista"></div>
      <script>ant.onclick = async () => { const r = await fetch('/api/anteprima', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testo: c.value }) });
        vista.innerHTML = await r.text(); };</script>
      </body></html>`));
    await page.locator('#c').click();
    await page.keyboard.type('Ho provato la patch e il crash sparisce');
    await page.keyboard.press('Enter');
    await page.keyboard.type('resta solo il problema del tema scuro');
    await expect.poll(() => moduloDi(shell, 'Commento'), { timeout: 8_000 }).toBe(true);
    await page.locator('#ant').click();
    await expect(page.locator('#vista')).toContainText('Ho provato la patch');
    await page.waitForTimeout(800);

    await pulisciTutto(app, shell, sito);
    expect(await titoliAperti(shell)).toContain('Commento');
  } finally { await sito.chiudi(); }
});
