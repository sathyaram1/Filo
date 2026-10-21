// Verifica #1307, giro 2, rilievo 1: un link pulito che rimanda a un'imitazione. Filo si ferma al rinvio (il sosia non
// riceve la visita), ma il menu non dice niente: per il rinvio a un sito in lista lo dice, per quello a un sosia tace.

import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const HOSTS = ['rinvio-pulito.test', 'paypa1.com'];

async function serverCheConta() {
  const arrivate = [];
  const server = createServer((req, res) => {
    arrivate.push(req.url);
    if (req.url.startsWith('/rinvio-pulito.test/')) {
      res.writeHead(302, { Location: 'https://paypa1.com/login' });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>PayPal: accedi</title></head><body>ok</body></html>');
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
    // Il modello finto non sa niente del rinvio: ripete solo che manca l'anteprima.
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ onDelta }) => {
      const text = 'Un link a rinvio-pulito.test';
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: 'finto', provider: 'openrouter', costEur: 0, usage: {}, finishReason: 'stop' };
    };
  }, { port, hosts: HOSTS });
}

let rete;
test.beforeEach(async () => { rete = await serverCheConta(); });
test.afterEach(async () => { await rete.chiudi(); });

test('r1 link pulito che rimanda a un sosia di PayPal: il menu dice che porta a un\'imitazione', async ({ app, openTab, testServer }) => {
  await preparaMain(app, rete.port);
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px;font:16px sans-serif">
    <p><a id="lnk" href="https://rinvio-pulito.test/vai">Accedi al tuo conto</a></p></body></html>`, { pubblico: true });
  await page.locator('#lnk').click({ button: 'right' });
  const sezione = menuDi(page).locator('.sn-menu .sn-menu-inline[data-subject="link"]');
  await expect(sezione.locator('.sn-menu-link-body')).toContainText('rinvio-pulito.test', { timeout: 8000 });
  // Il sosia non ha ricevuto la visita: questo regge.
  expect(rete.arrivate).toEqual(['/rinvio-pulito.test/vai']);
  // Filo sa dove porta il rinvio e cosa imita: l'utente lo deve leggere nel menu.
  await expect(sezione).toContainText(/paypa1\.com/, { timeout: 3000 });
  await expect(sezione).toContainText(/imita|sospett/i);
});
