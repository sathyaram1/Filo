// Esplorazione giro 5 di #1307: altre forme di link verso un sito della lista (sottodominio e maiuscole, disegno SVG,
// zona di mappa) e il sito tolto dalla lista che torna ad avere l'anteprima.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const TITOLO = 'TITOLO-ANTEPRIMA-1307';
const SENZA = 'Spiegazione senza anteprima';
const HOSTS = ['sito-bloccato.test', 'www.sito-bloccato.test'];
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
  await app.evaluate(async (_e, { port: p, hosts, TITOLO: titolo, SENZA: senza }) => {
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
      if (u && hosts.includes(u.hostname)) return prima.fetch(`http://127.0.0.1:${p}/${u.hostname}${u.pathname}`, o);
      return prima.fetch(url, o);
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ messages, onDelta }) => {
      const t = JSON.stringify(messages);
      const text = t.includes(titolo) ? `Un articolo: ${titolo}` : senza;
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {}, finishReason: 'stop' };
    };
  }, { port, hosts: HOSTS, TITOLO, SENZA });
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

const FORME = {
  'sottodominio in maiuscolo': { html: '<a id="t" href="https://WWW.Sito-Bloccato.test/x">Leggi</a>', click: {} },
  'disegno SVG': {
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><a href="https://sito-bloccato.test/x"><rect id="t" width="320" height="120" fill="#e07b39"/></a></svg>`,
    click: { position: { x: 200, y: 30 } },
  },
  'zona di mappa': {
    html: `<img id="t" src="${PX}" usemap="#m" width="320" height="160" style="background:#e07b39" alt="x"><map name="m"><area shape="rect" coords="0,0,160,160" href="https://sito-bloccato.test/x" alt="Offerta"></map>`,
    click: { position: { x: 40, y: 40 } },
  },
};

for (const [forma, { html, click }] of Object.entries(FORME)) {
  test(`${forma} verso un sito in lista: nessuna richiesta, e il menu lo dice`, async ({ app, shell, openTab, testServer }) => {
    await preparaMain(app, rete.port);
    await lista(shell, ['sito-bloccato.test']);
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:24px">${html}</body></html>`, { pubblico: true });
    await page.locator('#t').click({ button: 'right', ...click });
    const corpo = menuDi(page).locator('.sn-menu .sn-menu-inline[data-subject="link"] .sn-menu-link-body');
    await expect(corpo).toHaveText(/nella tua lista dei siti bloccati/i, { timeout: 8000 });
    await page.waitForTimeout(500);
    expect(rete.arrivate).toEqual([]);
  });
}

test('tolto dalla lista, lo stesso link torna ad avere l\'anteprima', async ({ app, shell, openTab, testServer }) => {
  await preparaMain(app, rete.port);
  await lista(shell, ['sito-bloccato.test']);
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="padding:40px"><a id="t" href="https://sito-bloccato.test/x">Leggi</a></body></html>', { pubblico: true });
  await page.locator('#t').click({ button: 'right' });
  const corpo = menuDi(page).locator('.sn-menu .sn-menu-inline[data-subject="link"] .sn-menu-link-body');
  await expect(corpo).toHaveText(/nella tua lista dei siti bloccati/i, { timeout: 8000 });
  await page.keyboard.press('Escape');
  await lista(shell, []);
  await page.locator('#t').click({ button: 'right' });
  await expect(corpo).toContainText(TITOLO, { timeout: 8000 });
  expect(rete.arrivate).toEqual(['/sito-bloccato.test/x']);
});
