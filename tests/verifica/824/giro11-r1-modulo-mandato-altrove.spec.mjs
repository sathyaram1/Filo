// #824 giro 11, rilievo 1: un modulo mandato in un'altra scheda o in un riquadro lascia il testo nella sua casella,
// e la pulizia deve tenere aperta la scheda come per ogni casella col testo ancora lì.
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
      if (p === '/modulo-nuova') return res.end(MODULO('/anteprima', 'target="_blank"'));
      if (p === '/modulo-riquadro') return res.end(MODULO('/anteprima', 'target="dietro"') + '<iframe name="dietro" style="width:10px;height:10px"></iframe>');
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

for (const [nome, percorso] of [['in una scheda nuova', '/modulo-nuova'], ['in un riquadro della pagina', '/modulo-riquadro']]) {
  test(`r1 il testo rimasto nella casella dopo un modulo mandato ${nome} tiene aperta la scheda`, async ({ app, shell }) => {
    const sito = await apriSito();
    try {
      const page = await apriEsatta(app, shell, `${sito.o}${percorso}`);
      await page.locator('#c').click();
      await page.keyboard.type(LETTERA);
      await expect.poll(async () => (await schede(shell)).find((t) => t.title === 'Contatti')?.formDirty, { timeout: 8000 }).toBe(true);
      const id = (await schede(shell)).find((t) => t.title === 'Contatti').id;
      await page.locator('#pub').click();
      await page.waitForTimeout(1500);
      expect(await page.locator('#c').inputValue()).toBe(LETTERA);
      const aperte = await archiviaTutto(app, shell, sito);
      expect(aperte).toContain(id);
    } finally { await sito.chiudi(); }
  });
}
