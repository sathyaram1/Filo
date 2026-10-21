// Verifica #1307, giro 1, rilievo 1: un'immagine dentro un link verso un sito della lista dei bloccati. Il sito non
// viene contattato (questo regge), ma il menu non dice che il link porta a un sito in lista, come fa per il link di testo.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const HOSTS = ['sito-bloccato.test'];
const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function serverCheConta() {
  const arrivate = [];
  const server = createServer((req, res) => {
    arrivate.push(req.url);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>Pagina</title></head><body>ok</body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { arrivate, port: server.address().port, chiudi: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

async function preparaMain(app, port) {
  await app.evaluate(async (_e, { port: p, hosts }) => {
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
    const finto = async ({ onDelta }) => {
      const text = 'Un rettangolo arancione';
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {}, finishReason: 'stop' };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
  }, { port, hosts: HOSTS });
}

let rete;
test.beforeEach(async () => { rete = await serverCheConta(); });
test.afterEach(async () => { await rete.chiudi(); });

test('r1 immagine dentro un link verso un sito della lista: il menu dice che il link porta a un sito in lista', async ({ app, shell, openTab, testServer }) => {
  await preparaMain(app, rete.port);
  await shell.evaluate(() => window.filoShell.message({
    type: 'update_settings',
    settings: { security: { siteBlock: { enabled: true, useAdblockLists: false, blacklist: ['sito-bloccato.test'] } } },
  }));
  await shell.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">
    <a href="https://sito-bloccato.test/offerta"><img id="banner" src="${PX}" width="320" height="160" style="background:#e07b39" alt="Offerta"></a>
  </body></html>`, { pubblico: true });
  await page.locator('#banner').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voce('Apri in nuova tab')).toBeVisible();
  await expect(menu.principale).toContainText(/nella tua lista dei siti bloccati/, { timeout: 8000 });
  expect(rete.arrivate).toEqual([]);
});
