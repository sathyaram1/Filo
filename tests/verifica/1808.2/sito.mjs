// Aiuti delle prove della verifica #1808.2: un sito minimo che respinge o accetta, e la pulizia che archivia tutto.
import { expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

export const LETTERA = 'Buongiorno, vi scrivo per il rimborso dell’ordine 4471: il pacco è arrivato rotto e vorrei sapere come procedere';

export async function apriEsatta(app, shell, url) {
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  let page = null;
  await expect.poll(() => {
    page = app.windows().find((w) => { try { return w.url() === url; } catch (_) { return false; } });
    return !!page;
  }, { timeout: 10_000 }).toBe(true);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

export const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => ({ id: t.id, title: t.title, formDirty: t.formDirty })));

export async function sporca(shell, titolo) {
  await expect.poll(async () => (await schede(shell)).find((t) => t.title === titolo)?.formDirty, { timeout: 8_000 }).toBe(true);
  return (await schede(shell)).find((t) => t.title === titolo).id;
}

export async function archiviaTutto(app, shell, sito) {
  await apriEsatta(app, shell, sito.pagina('<!doctype html><title>Altra</title><p>altra pagina'));
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => ({ decisions: tabs.map((t, i) => ({ i, action: 'archive', reason: 'pulizia' })) });
    return win._filoTabs.runAutoTriage({ trigger: 'manual' });
  });
  return (await schede(shell)).map((t) => t.id);
}

export async function apriSito() {
  const pagine = new Map();
  let n = 0;
  const server = createServer((req, res) => {
    const [percorso] = req.url.split('?');
    req.on('data', () => {});
    req.on('end', () => {
      const html = (s, t) => { res.writeHead(s, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(t); };
      if (percorso === '/err500') return html(500, '<!doctype html><title>Errore</title><p>Errore del server');
      if (percorso === '/ok') { res.writeHead(302, { Location: '/fatto' }); res.end(); return; }
      if (percorso === '/fatto') return html(200, '<!doctype html><title>Fatto</title><p>Ricevuto');
      if (percorso === '/api/rifiuta') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"errore":"Devi accedere"}'); return; }
      if (percorso === '/api/ok') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true,"id":991}'); return; }
      const p = pagine.get(percorso.replace(/^\//, ''));
      if (!p) { res.writeHead(404); res.end('no'); return; }
      html(200, p);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origine = `http://127.0.0.1:${server.address().port}`;
  return {
    pagina(h) { const id = `p${++n}`; pagine.set(id, h); return `${origine}/${id}`; },
    async chiudi() { try { server.closeAllConnections(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}
