// Verifica #1307, giro 1: altre forme del collegamento verso un sito della lista e verso un sito pulito.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const TITOLO = 'TITOLO-ANTEPRIMA-1307';
const HOSTS = ['notizie-pulite.test', 'sito-bloccato.test'];
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
  await app.evaluate(async (_e, { port: p, hosts, TITOLO: titolo }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_LINK]: 'deepseek-flash', [C.ACTIONS.EXPLAIN_IMAGE]: 'deepseek-flash' },
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
      const t = JSON.stringify(messages);
      const text = t.includes(titolo) ? `Un articolo: ${titolo}` : 'Spiegazione senza anteprima';
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {}, finishReason: 'stop' };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
  }, { port, hosts: HOSTS, TITOLO });
}

async function lista(shell, blacklist) {
  await shell.evaluate((l) => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: l } } },
  }), blacklist);
  await shell.evaluate(() => new Promise((r) => setTimeout(r, 300)));
}

let rete;
test.beforeEach(async () => { rete = await serverCheConta(); });
test.afterEach(async () => { await rete.chiudi(); });

test('immagine dentro un link verso un sito della lista: nessuna richiesta e il menu dice che è in lista', async ({ app, shell, openTab, testServer }) => {
  await preparaMain(app, rete.port);
  await lista(shell, ['sito-bloccato.test']);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <a href="https://sito-bloccato.test/offerta"><img id="banner" src="${PX}" width="320" height="160" style="background:#e07b39" alt="Offerta"></a>
  </body></html>`, { pubblico: true });
  await page.locator('#banner').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.principale).toBeVisible();
  await expect(menu.voce('Apri in nuova tab')).toBeVisible();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'tests/.shots/v1307-img-link-bloccato.png' });
  expect(rete.arrivate).toEqual([]);
  await expect(menu.principale).toContainText(/nella tua lista dei siti bloccati/);
});

test('zona di una mappa d\'immagine verso un sito della lista: nessuna richiesta e il menu dice che è in lista', async ({ app, shell, openTab, testServer }) => {
  await preparaMain(app, rete.port);
  await lista(shell, ['sito-bloccato.test']);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <img id="mappa" src="${PX}" usemap="#m" width="320" height="160" style="background:#e07b39" alt="Offerte">
    <map name="m"><area shape="rect" coords="0,0,160,160" href="https://sito-bloccato.test/x" alt="Vai"></map>
  </body></html>`, { pubblico: true });
  await page.locator('#mappa').click({ button: 'right', position: { x: 40, y: 40 } });
  const corpo = menuDi(page).locator('.sn-menu .sn-menu-inline[data-subject="link"] .sn-menu-link-body');
  await expect(corpo).toHaveText(/sito-bloccato\.test.*nella tua lista dei siti bloccati/, { timeout: 8000 });
  expect(rete.arrivate).toEqual([]);
});

test('link SVG verso un sito pulito: l\'anteprima arriva', async ({ app, openTab, testServer }) => {
  await preparaMain(app, rete.port);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><a href="https://notizie-pulite.test/art"><rect id="d" width="320" height="120" fill="#3a7"/></a></svg>
  </body></html>`, { pubblico: true });
  await page.locator('#d').click({ button: 'right', position: { x: 100, y: 40 } });
  const corpo = menuDi(page).locator('.sn-menu .sn-menu-inline[data-subject="link"] .sn-menu-link-body');
  await expect(corpo).toContainText(TITOLO, { timeout: 8000 });
  expect(rete.arrivate).toEqual(['/notizie-pulite.test/art']);
});

test('tema scuro: il messaggio del sito in lista', async ({ app, shell, openTab, testServer }) => {
  await preparaMain(app, rete.port);
  await lista(shell, ['sito-bloccato.test']);
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
    <p><a id="lnk" href="https://www.sito-bloccato.test/pagina">Leggi qui</a></p></body></html>`, { pubblico: true });
  await page.locator('#lnk').click({ button: 'right' });
  const corpo = menuDi(page).locator('.sn-menu .sn-menu-inline[data-subject="link"] .sn-menu-link-body');
  await expect(corpo).toHaveText(/nella tua lista dei siti bloccati/, { timeout: 8000 });
  await page.waitForTimeout(400);
  await menuDi(page).superficie.screenshot({ path: 'tests/.shots/v1307-bloccato-scuro.png' });
  expect(rete.arrivate).toEqual([]);
});
