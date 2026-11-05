// Esplorazione della verifica #1808.2 giro 1: editor in riquadro srcdoc mandato con una richiesta della pagina.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

test.describe.configure({ timeout: 300_000 });

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
const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => ({ id: t.id, title: t.title, formDirty: t.formDirty, url: t.url })));
async function archiviaTutto(app, shell, sito) {
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
      if (percorso === '/api/rifiuta') { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"errore":"Devi accedere"}'); return; }
      if (percorso === '/api/ok') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true,"id":991}'); return; }
      const p = pagine.get(percorso.replace(/^\//, ''));
      if (!p) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(p);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const origine = `http://127.0.0.1:${port}`;
  return {
    pagina(h) { const id = `p${++n}`; pagine.set(id, h); return `${origine}/${id}`; },
    async chiudi() { try { server.closeAllConnections(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

const LETTERA = 'Buongiorno, vi scrivo per il rimborso dell’ordine 4471: il pacco è arrivato rotto e vorrei sapere come procedere';
const RIQ = '<iframe id="ifr" style="width:420px;height:120px" srcdoc="<body contenteditable=true style=\'min-height:100px\'></body>"></iframe>';

test('editor srcdoc mandato con una richiesta della pagina', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ris = {};
    let k = 0;
    for (const [api, svuota, dove] of [['/api/rifiuta', true, 'R'], ['/api/rifiuta', false, 'R'], ['/api/ok', true, 'A'], ['/api/ok', false, 'A']]) {
      const titolo = `Fe${++k}`;
      const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title><ul id="msg"></ul>${RIQ}<button id="pub">Invia</button><p id="esito"></p>
        <script>pub.onclick = () => { const b = ifr.contentDocument.body; const t = b.innerHTML; ${svuota ? "b.innerHTML = '';" : ''}
          fetch('${api}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ testo: t }) }).then((r) => { esito.textContent = r.ok ? 'ok' : 'no'; }); };</script>`));
      await page.frameLocator('#ifr').locator('body').click();
      await page.keyboard.type(LETTERA);
      let id;
      await expect.poll(async () => { const t = (await schede(shell)).find((x) => x.title === titolo); id = t?.id; return t?.formDirty; }, { timeout: 8_000 }).toBe(true);
      await page.locator('#pub').click();
      await expect(page.locator('#esito')).toHaveText(api === '/api/ok' ? 'ok' : 'no');
      await page.waitForTimeout(1000);
      ris[`${dove} ${api} svuota=${svuota}`] = id;
    }
    const aperte = await archiviaTutto(app, shell, sito);
    console.log('FETCH', JSON.stringify(Object.fromEntries(Object.entries(ris).map(([a, id]) => [a, aperte.includes(id) ? 'aperta' : 'archiviata'])), null, 1));
  } finally { await sito.chiudi(); }
});
