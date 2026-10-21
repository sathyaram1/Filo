// Verifica #1307, giro 2: le altre forme di collegamento (zona di mappa, link SVG) verso un sito della lista e verso un
// sito pulito, e l'aspetto della nota del sito in lista nei due temi.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const TITOLO = 'TITOLO-GIRO2-1307';
const SENZA = 'Spiegazione senza anteprima';
const HOSTS = ['notizie-pulite.test', 'sito-bloccato.test', 'www.sito-bloccato.test'];
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function serverCheConta() {
  const arrivate = [];
  const server = createServer((req, res) => {
    arrivate.push(req.url);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head><title>${TITOLO}</title></head><body>ok</body></html>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { arrivate, port: server.address().port, chiudi: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

async function preparaMain(app, port) {
  await app.evaluate(async (_e, { port: p, hosts, titolo, senza }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_LINK]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const dns = process.getBuiltinModule('dns');
    const prima = { lookup: dns.promises.lookup, fetch: globalThis.fetch };
    dns.promises.lookup = async (h, o) => (hosts.includes(h) ? [{ address: '93.184.216.34', family: 4 }] : prima.lookup.call(dns.promises, h, o));
    globalThis.fetch = async (url, o) => {
      let u = null;
      try { u = new URL(String(url)); } catch (_) {}
      if (u && hosts.includes(u.hostname)) return prima.fetch(`http://127.0.0.1:${p}/${u.hostname}${u.pathname}${u.search}`, o);
      return prima.fetch(url, o);
    };
    const finto = async ({ messages, onDelta }) => {
      const t = JSON.stringify(messages || []);
      const text = t.includes(titolo) ? `Un articolo: ${titolo}` : senza;
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {}, finishReason: 'stop' };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
  }, { port, hosts: HOSTS, titolo: TITOLO, senza: SENZA });
}

async function lista(shell, blacklist) {
  await shell.evaluate((l) => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: l } } },
  }), blacklist);
  await shell.evaluate(() => new Promise((r) => setTimeout(r, 300)));
}

const mappa = (href) => `<!doctype html><html><body style="margin:0;padding:24px">
  <img id="mappa" src="${PX}" usemap="#offerte" width="320" height="160" style="background:#e07b39" alt="Offerte">
  <map name="offerte"><area shape="rect" coords="0,0,160,160" href="${href}" alt="Accedi al conto"></map>
</body></html>`;

const disegno = (href) => `<!doctype html><html><body style="margin:0;padding:24px">
  <svg xmlns="http://www.w3.org/2000/svg" width="320" height="120">
    <a href="${href}"><rect id="disegno" width="320" height="120" fill="#e07b39"/></a>
  </svg></body></html>`;

let rete;
test.beforeEach(async () => { rete = await serverCheConta(); });
test.afterEach(async () => { await rete.chiudi(); });

test('zona di mappa verso un sito della lista: nessuna richiesta, e il menu dice che è in lista', async ({ app, shell, openTab, testServer }) => {
  await preparaMain(app, rete.port);
  await lista(shell, ['sito-bloccato.test']);
  const page = await testServer.openReady(openTab, mappa('https://sito-bloccato.test/offerta'), { pubblico: true });
  await page.locator('#mappa').click({ button: 'right', position: { x: 40, y: 40 } });
  const sezione = menuDi(page).locator('.sn-menu .sn-menu-inline[data-subject="link"]');
  await expect(sezione.locator('.sn-menu-link-body')).toHaveText(/nella tua lista dei siti bloccati/, { timeout: 8000 });
  await page.waitForTimeout(500);
  expect(rete.arrivate).toEqual([]);
});

test('link SVG verso un sito della lista (con www): nessuna richiesta, e il menu dice che è in lista', async ({ app, shell, openTab, testServer }) => {
  await preparaMain(app, rete.port);
  await lista(shell, ['sito-bloccato.test']);
  const page = await testServer.openReady(openTab, disegno('https://www.sito-bloccato.test/offerta'), { pubblico: true });
  await page.locator('#disegno').click({ button: 'right', position: { x: 200, y: 30 } });
  const sezione = menuDi(page).locator('.sn-menu .sn-menu-inline[data-subject="link"]');
  await expect(sezione.locator('.sn-menu-link-body')).toHaveText(/nella tua lista dei siti bloccati/, { timeout: 8000 });
  await page.waitForTimeout(500);
  expect(rete.arrivate).toEqual([]);
});

test('zona di mappa verso un sito pulito: l\'anteprima arriva', async ({ app, openTab, testServer }) => {
  await preparaMain(app, rete.port);
  const page = await testServer.openReady(openTab, mappa('https://notizie-pulite.test/articolo'), { pubblico: true });
  await page.locator('#mappa').click({ button: 'right', position: { x: 40, y: 40 } });
  const sezione = menuDi(page).locator('.sn-menu .sn-menu-inline[data-subject="link"]');
  await expect(sezione.locator('.sn-menu-link-body')).toContainText(TITOLO, { timeout: 8000 });
  expect(rete.arrivate).toEqual(['/notizie-pulite.test/articolo']);
});

test('link SVG relativo: Copia URL dà l\'indirizzo intero', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, disegno('/pagina-relativa?x=1'));
  await page.locator('#disegno').click({ button: 'right', position: { x: 200, y: 30 } });
  const menu = menuDi(page);
  await app.evaluate(({ clipboard }) => clipboard.writeText('vuoto'));
  await menu.voce('Copia URL').click();
  const atteso = new URL('/pagina-relativa?x=1', page.url()).href;
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(atteso);
});

test('la nota del sito in lista sopra un\'immagine, nei due temi', async ({ app, shell, openTab, testServer }) => {
  await preparaMain(app, rete.port);
  await lista(shell, ['sito-bloccato.test']);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <a href="https://sito-bloccato.test/offerta"><img id="banner" src="${PX}" width="320" height="160" style="background:#e07b39" alt="Offerta"></a>
  </body></html>`, { pubblico: true });
  const menu = menuDi(page);
  for (const tema of ['light', 'dark']) {
    await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
    await page.locator('#banner').click({ button: 'right' });
    const m = menuDi(page);
    await expect(m.locator('.sn-menu .sn-menu-inline[data-subject="image"] .sn-menu-link-nota')).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(600);
    await m.superficie.screenshot({ path: `tests/.shots/1307-g2-nota-${tema}.png` });
    await m.superficie.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  expect(rete.arrivate).toEqual([]);
  void menu;
});
