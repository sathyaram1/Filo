// #824 giro 10: esplorazione.

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

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, formDirty: t.formDirty })));

async function pulisciTutto(app, shell, sito) {
  await apriEsatta(app, shell, sito.pagina('<!doctype html><title>Altra</title><p>altra pagina'));
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({ decisions: tabs.map((t, i) => ({ i, action: 'archive', reason: 'pulizia' })) });
    return win._filoTabs.runAutoTriage({ trigger: 'manual' });
  });
  return (await schede(shell)).map((t) => t.id);
}

async function apriSito() {
  const pagine = new Map();
  let n = 0;
  const server = createServer((req, res) => {
    const [percorso] = req.url.split('?');
    req.on('data', () => {});
    req.on('end', () => {
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

const LETTERA = 'Buongiorno, vorrei sapere se il divano grigio è ancora disponibile e quanto costa la consegna a Torino';

test('E1 ricarica: il testo rimesso nel campo', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Ricarica</title><form><textarea id="c" name="m" style="width:400px;height:100px"></textarea></form>`));
    await page.locator('#c').click();
    await page.keyboard.type(LETTERA);
    await expect.poll(async () => (await schede(shell)).find((t) => t.title === 'Ricarica')?.formDirty, { timeout: 8_000 }).toBe(true);
    const id = (await schede(shell)).find((t) => t.title === 'Ricarica').id;
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await page.waitForTimeout(800);
    const v = await page.locator('#c').inputValue();
    console.log('E1 valore dopo ricarica:', JSON.stringify(v));
    const aperte = await pulisciTutto(app, shell, sito);
    console.log('E1 aperta:', aperte.includes(id));
  } finally { await sito.chiudi(); }
});

test('E2 casella del messaggio chiamata query', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Contatti</title><form method="post" action="/api/x">
      Nome <input name="name"> Your query <textarea id="c" name="query" style="width:400px;height:100px"></textarea><button>Send</button></form>`));
    await page.locator('#c').click();
    await page.keyboard.type(LETTERA);
    await page.waitForTimeout(1000);
    const id = (await schede(shell)).find((t) => t.title === 'Contatti').id;
    const aperte = await pulisciTutto(app, shell, sito);
    console.log('E2 aperta:', aperte.includes(id));
    expect.soft(aperte).toContain(id);
  } finally { await sito.chiudi(); }
});

test('E3 home con una domanda scritta e non mandata', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
    let page = null;
    await expect.poll(() => {
      page = app.windows().filter((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } }).pop();
      return !!page;
    }, { timeout: 10_000 }).toBe(true);
    await page.waitForSelector('#input', { timeout: 10_000 });
    await page.waitForTimeout(1500);
    await page.locator('#input').click();
    await page.keyboard.type(LETTERA);
    await page.waitForTimeout(1000);
    const tutte = await schede(shell);
    console.log('E3 schede', JSON.stringify(tutte));
    const home = tutte.filter((t) => t.url.startsWith('filo://newtab'));
    const id = home[home.length - 1].id;
    const aperte = await pulisciTutto(app, shell, sito);
    console.log('E3 aperta:', aperte.includes(id));
    expect.soft(aperte).toContain(id);
  } finally { await sito.chiudi(); }
});

test('E4 testo corto e richiesta di controllo periodica', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Chat</title><textarea id="c" style="width:400px;height:100px"></textarea>
      <script>setInterval(() => fetch('/api/poll', { method: 'POST', body: JSON.stringify({ status: 'ok', since: Date.now(), visible: document.visibilityState, notification: 'none' }) }), 500);</script>`));
    await page.locator('#c').click();
    await page.keyboard.type('Ok, ci vediamo domani alle nove');
    await page.waitForTimeout(1500);
    const id = (await schede(shell)).find((t) => t.title === 'Chat').id;
    const aperte = await pulisciTutto(app, shell, sito);
    console.log('E4 aperta:', aperte.includes(id));
  } finally { await sito.chiudi(); }
});

test('E7 modulo di soli campi di una riga non inviato', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Spedizione</title><form method="post" action="/api/x">
      Nome <input id="n" name="nome"> Indirizzo <input id="i" name="indirizzo"> Città <input id="c" name="citta"><button>Continua</button></form>`));
    await page.locator('#n').click(); await page.keyboard.type('Mario Rossi');
    await page.locator('#i').click(); await page.keyboard.type('Via Garibaldi 12');
    await page.locator('#c').click(); await page.keyboard.type('Torino');
    await page.waitForTimeout(1000);
    const id = (await schede(shell)).find((t) => t.title === 'Spedizione').id;
    const aperte = await pulisciTutto(app, shell, sito);
    console.log('E7 aperta:', aperte.includes(id));
    expect.soft(aperte).toContain(id);
  } finally { await sito.chiudi(); }
});
