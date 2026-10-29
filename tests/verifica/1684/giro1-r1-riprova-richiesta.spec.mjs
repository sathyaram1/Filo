// Verifica #1684, giro 1, rilievo 1: «Riprova» deve rifare la richiesta che l'utente aveva fatto col clic, non
// riprendere l'indirizzo finale dopo i rimandi né presentarsi senza la pagina da cui era partito.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';

const PDF = Buffer.from('%PDF-1.4\n% finto pdf di prova\n' + 'x'.repeat(4096));

// /firmato: la prima richiesta trova il server occupato. /rimando dà ogni volta un indirizzo firmato che vale una volta
// sola (siti di file grandi, archivi in cloud). /protetto serve il file solo a chi arriva dalla sua pagina.
async function apriServer() {
  const visti = new Map();
  const usati = new Set();
  let gettone = 0;
  const primaVolta = (nome) => { const n = (visti.get(nome) || 0) + 1; visti.set(nome, n); return n === 1; };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const nome = decodeURIComponent(u.pathname.split('/').pop() || 'file.pdf');
    const file = () => {
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': PDF.length, 'Content-Disposition': `attachment; filename="${nome}"` });
      res.end(PDF);
    };
    const no = (codice) => { res.writeHead(codice, { 'Content-Type': 'text/plain' }); res.end(String(codice)); };
    if (u.pathname.startsWith('/pagina/')) {
      const dove = u.searchParams.get('verso');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body style="padding:40px"><a id="l" download href="/${dove}/${nome}">${nome}</a></body></html>`);
      return;
    }
    if (u.pathname.startsWith('/rimando/')) {
      gettone += 1;
      res.writeHead(302, { Location: `/firmato/${encodeURIComponent(nome)}?t=${gettone}` });
      res.end();
      return;
    }
    if (u.pathname.startsWith('/firmato/')) {
      const t = u.searchParams.get('t');
      if (usati.has(t)) return no(403);
      usati.add(t);
      return primaVolta(nome) ? no(503) : file();
    }
    if (u.pathname.startsWith('/protetto/')) {
      if (!String(req.headers.referer || '').includes('/pagina/')) return no(403);
      return primaVolta(nome) ? no(503) : file();
    }
    no(404);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${srv.address().port}`,
    async close() {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

const elenco = async (shell) => ((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [];
const voce = async (shell, prova) => (await elenco(shell)).find(prova) || null;
const cartella = (app) => app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);

for (const [caso, verso, nome] of [
  ['un file servito da un indirizzo firmato dopo un rimando', 'rimando', 'estratto.pdf'],
  ['un file che il sito dà solo a chi arriva dalla sua pagina', 'protetto', 'listino.pdf'],
]) {
  test(`r1 «Riprova» sull’avviso: ${caso} riparte e arriva`, async ({ app, shell, openTab, avvisi }) => {
    test.setTimeout(90_000);
    const srv = await apriServer();
    try {
      const dir = await cartella(app);
      const page = await openTab(`${srv.base}/pagina/${nome}?verso=${verso}`);
      await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
      await page.locator('#l').click();
      let primo = null;
      await expect.poll(async () => {
        primo = await voce(shell, (x) => x.filename === nome || x.url.includes(`/${nome}`));
        return primo && primo.state;
      }, { timeout: 30000 }).toBe('interrupted');
      const vista = await avvisi();
      const carta = vista.locator('.shell-notif', { hasText: 'Scaricamento non riuscito' }).last();
      await expect(carta).toBeVisible({ timeout: 10000 });
      await carta.locator('.shell-notif-action', { hasText: 'Riprova' }).click();
      // Se l'utente rifacesse il clic sul link, il file arriverebbe: «Riprova» deve fare lo stesso.
      await expect.poll(async () => (await voce(shell, (x) => x.id === primo.id))?.state, { timeout: 45000 }).toBe('completed');
      expect(existsSync(dir) ? readdirSync(dir) : []).toContain(nome);
    } finally { await srv.close(); }
  });
}
