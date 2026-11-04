// #1808 giro 2: editor in un riquadro, modulo mandato e respinto, nelle sue varianti comuni.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

test.describe.configure({ timeout: 240_000 });

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
      if (percorso === '/err500') { res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><title>Errore</title><p>Errore del server'); return; }
      const p = pagine.get(percorso.replace(/^\//, ''));
      if (!p) { res.writeHead(404); res.end('no'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(p);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origine = `http://127.0.0.1:${server.address().port}`;
  return {
    pagina(html) { const id = `p${++n}`; pagine.set(id, html); return `${origine}/${id}`; },
    async chiudi() { try { server.closeAllConnections(); } catch (_) {} await new Promise((r) => server.close(r)); },
  };
}

const LETTERA = 'Buongiorno, vi scrivo per il rimborso dell’ordine 4471: il pacco è arrivato rotto e vorrei sapere come procedere';
const SCRIVI = 'const d = ifr.contentDocument; d.open(); d.write(\'<body contenteditable="true" style="min-height:100px"></body>\'); d.close();';
const CAMPI = {
  textarea: '<textarea name="corpo" id="nasc" style="display:none"></textarea>',
  hidden: '<input type="hidden" name="corpo" id="nasc">',
};
const RIQUADRI = {
  scritto: { tag: '<iframe id="ifr" style="width:420px;height:120px"></iframe>', script: SCRIVI },
  srcdoc: { tag: '<iframe id="ifr" style="width:420px;height:120px" srcdoc="<body contenteditable=true style=\'min-height:100px\'></body>"></iframe>', script: '' },
};
const INVII = {
  bottone: { el: '<button id="pub">Invia</button>', script: 'f.addEventListener(\'submit\', () => { nasc.value = ifr.contentDocument.body.innerHTML; });' },
  script: { el: '<a href="#" id="pub">Pubblica</a>', script: 'pub.onclick = (e) => { e.preventDefault(); nasc.value = ifr.contentDocument.body.innerHTML; f.submit(); };' },
};

test('r1 un editor in un riquadro mandato e respinto tiene aperta la scheda, in ogni variante comune', async ({ app, shell }) => {
  const sito = await apriSito();
  try {
    const ids = {};
    let k = 0;
    for (const [nr, r] of Object.entries(RIQUADRI)) for (const [nc, c] of Object.entries(CAMPI)) for (const [ni, inv] of Object.entries(INVII)) {
      const titolo = `Ed${++k}`;
      const page = await apriEsatta(app, shell, sito.pagina(`<!doctype html><title>${titolo}</title>
        <form id="f" method="post" action="/err500">${c}${r.tag}${inv.el}</form>
        <script>window.addEventListener('load', () => {}); ${r.script} ${inv.script}</script>`));
      await page.frameLocator('#ifr').locator('body').click();
      await page.keyboard.type(LETTERA);
      await expect.poll(async () => (await schede(shell)).find((t) => t.title === titolo)?.formDirty, { timeout: 8_000 }).toBe(true);
      const id = (await schede(shell)).find((t) => t.title === titolo).id;
      ids[`riquadro ${nr}, campo ${nc}, invio da ${ni}`] = id;
      await page.locator('#pub').click();
      await expect.poll(async () => (await schede(shell)).find((t) => t.id === id)?.title, { timeout: 10_000 }).toBe('Errore');
      await page.waitForTimeout(600);
    }
    const aperte = await archiviaTutto(app, shell, sito);
    for (const [nome, id] of Object.entries(ids)) expect.soft(aperte, nome).toContain(id);
  } finally { await sito.chiudi(); }
});
