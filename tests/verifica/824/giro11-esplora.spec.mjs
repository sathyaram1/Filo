// Esplorazione del giro 11 di #824: invii di moduli che lasciano il testo solo nella pagina di prima.
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

const MODULO = (azione, extra = '') => `<!doctype html><html><head><meta charset="utf-8"><title>Contatti</title></head><body>
  <form method="post" action="${azione}" ${extra}><input name="nome" id="n"><textarea name="msg" id="c" style="width:400px;height:100px"></textarea><button id="pub">Invia</button></form>
  </body></html>`;

async function apriSito() {
  const server = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      const p = req.url.split('?')[0];
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (p === '/modulo') return res.end(MODULO('/invia'));
      if (p === '/modulo-nuova') return res.end(MODULO('/anteprima', 'target="_blank"'));
      if (p === '/invia') return res.end(`<!doctype html><title>Contatti</title><p style="color:red">Codice di controllo sbagliato, riprova.</p>${MODULO('/invia').replace(/^[\s\S]*<form/, '<form')}`);
      if (p === '/anteprima') return res.end('<!doctype html><title>Anteprima</title><p>Anteprima del messaggio');
      return res.end('<!doctype html><title>Altra</title><p>altra');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const o = `http://127.0.0.1:${server.address().port}`;
  return { o, async chiudi() { try { server.closeAllConnections(); } catch (_) {} await new Promise((r) => server.close(r)); } };
}

async function archiviaTutto(app, shell, sito) {
  await apriEsatta(app, shell, `${sito.o}/altra`);
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({ decisions: tabs.map((t, i) => ({ i, action: 'archive', reason: 'pulizia' })) });
    return win._filoTabs.runAutoTriage({ trigger: 'manual' });
  });
  return (await schede(shell)).map((t) => t.id);
}

const LETTERA = 'Buongiorno, vi scrivo per il rimborso del biglietto del treno di sabato scorso';

test('esplora: modulo respinto con una pagina 200 che lo ripropone vuoto', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const page = await apriEsatta(app, shell, `${sito.o}/modulo`);
    await page.locator('#n').click(); await page.keyboard.type('Anna');
    await page.locator('#c').click(); await page.keyboard.type(LETTERA);
    await expect.poll(async () => (await schede(shell)).find((t) => t.title === 'Contatti')?.formDirty, { timeout: 8000 }).toBe(true);
    const id = (await schede(shell)).find((t) => t.title === 'Contatti').id;
    await page.locator('#pub').click();
    await expect(page.locator('text=Codice di controllo sbagliato')).toBeVisible();
    await page.waitForTimeout(800);
    const aperte = await archiviaTutto(app, shell, sito);
    console.log('RESPINTO-200 aperta:', aperte.includes(id));
  } finally { await sito.chiudi(); }
});

test('esplora: modulo mandato in una scheda nuova lascia il testo nella casella', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const page = await apriEsatta(app, shell, `${sito.o}/modulo-nuova`);
    await page.locator('#c').click(); await page.keyboard.type(LETTERA);
    await expect.poll(async () => (await schede(shell)).find((t) => t.title === 'Contatti')?.formDirty, { timeout: 8000 }).toBe(true);
    const id = (await schede(shell)).find((t) => t.title === 'Contatti').id;
    await page.locator('#pub').click();
    await expect.poll(async () => (await schede(shell)).some((t) => t.title === 'Anteprima'), { timeout: 8000 }).toBe(true);
    await page.waitForTimeout(800);
    console.log('NUOVA-SCHEDA testo nel campo:', JSON.stringify(await page.locator('#c').inputValue()));
    console.log('NUOVA-SCHEDA formDirty:', (await schede(shell)).find((t) => t.id === id)?.formDirty);
    const aperte = await archiviaTutto(app, shell, sito);
    console.log('NUOVA-SCHEDA aperta:', aperte.includes(id));
  } finally { await sito.chiudi(); }
});
