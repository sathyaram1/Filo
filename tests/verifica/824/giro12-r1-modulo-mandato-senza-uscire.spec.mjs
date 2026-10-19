// #824 giro 12, rilievo 1: un modulo di soli campi di una riga mandato senza che la pagina se ne vada
// (in una scheda nuova, da un dialogo) tiene la scheda protetta anche se il testo è già partito.

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

const titoliAperti = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.title));
const sporca = (shell, titolo) => shell.evaluate(async (t) => (await window.filoShell.tabs.snapshot()).tabs.find((x) => x.title === t)?.formDirty, titolo);

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

async function apriSito() {
  const pagine = new Map();
  let n = 0;
  const server = createServer((req, res) => {
    const [percorso] = req.url.split('?');
    req.resume();
    req.on('end', () => {
      if (percorso.startsWith('/api/')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><title>Risposta</title><p>ok');
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

test('r1 il codice mandato in una scheda nuova dello stesso sito non protegge più la scheda di partenza', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const p = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Traccia</title>
      <form action="/api/traccia" target="_blank"><input name="codice" id="c" style="width:300px"><button id="b">Traccia la spedizione</button></form>`));
    await p.locator('#c').click();
    await p.keyboard.type('RR123456789IT');
    await expect.poll(() => sporca(shell, 'Traccia')).toBe(true);
    await p.locator('#b').click();
    await expect.poll(async () => (await titoliAperti(shell)).includes('Risposta'), { timeout: 8000 }).toBe(true);
    await p.waitForTimeout(800);
    await pulisciTutto(app, shell, sito);
    expect(await titoliAperti(shell)).not.toContain('Traccia');
  } finally { await sito.chiudi(); }
});

test('r1 il nome scritto in un dialogo chiuso dal suo modulo non protegge più la scheda', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const p = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>Lista</title>
      <ul id="l"></ul><button id="apri">Nuova lista</button>
      <dialog id="d"><form method="dialog"><input id="c" style="width:300px"><button id="ok">Crea</button></form></dialog>
      <script>apri.onclick = () => d.showModal(); d.addEventListener('close', () => { const li = document.createElement('li'); li.textContent = c.value; l.append(li); });</script>`));
    await p.locator('#apri').click();
    await p.locator('#c').click();
    await p.keyboard.type('Spesa del sabato');
    await expect.poll(() => sporca(shell, 'Lista')).toBe(true);
    await p.locator('#ok').click();
    await expect(p.locator('#l li')).toHaveText('Spesa del sabato');
    await p.waitForTimeout(800);
    await pulisciTutto(app, shell, sito);
    expect(await titoliAperti(shell)).not.toContain('Lista');
  } finally { await sito.chiudi(); }
});
