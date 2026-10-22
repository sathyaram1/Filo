// Verifica #1505 giro 1: sopra una pagina web un collegamento scritto da Filo che al clic chiede l'OK (dati codificati
// nell'indirizzo) non deve essere contattato prima dal tasto destro. Il main crede che il nome stia su internet e lo
// porta a un server di prova che conta le richieste.
import { createServer } from 'node:http';
import { test, expect } from '../../fixtures/electron.mjs';

const RACCOLTA = 'raccolta-giro1-1505.test';
const LINK = `https://${RACCOLTA}/c?d=aGVsbG8gd29ybGQgZnJvbSBmaWxvIGFuZCBtb3Jl`;

async function serverCheConta() {
  const arrivate = [];
  const server = createServer((req, res) => {
    arrivate.push(req.url);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>Raccolta</title></head><body>ok</body></html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { arrivate, port: server.address().port, chiudi: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

let rete;
test.beforeEach(async () => { rete = await serverCheConta(); });
test.afterEach(async () => { await rete.chiudi(); });
test.use({ hostInPiu: [RACCOLTA] });

test('r1 sopra un sito il tasto destro non contatta un collegamento di Filo che al clic chiede l\'OK', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await testServer.openReady(openTab, '<!doctype html><html><body><p>Ciao Mario, ecco il tuo profilo.</p></body></html>', { pubblico: true });
  await app.evaluate(async (_e, { port, host }) => {
    const rq = process.mainModule.require;
    const dns = process.getBuiltinModule('dns');
    const lookup = dns.promises.lookup;
    dns.promises.lookup = async (h, o) => (h === host ? [{ address: '93.184.216.34', family: 4 }] : lookup.call(dns.promises, h, o));
    const proto = Object.getPrototypeOf(rq('electron').session.defaultSession);
    const resolveHost = proto.resolveHost;
    proto.resolveHost = function (h, o) {
      return h === host ? Promise.resolve({ endpoints: [{ address: '93.184.216.34', family: 'ipv4' }] }) : resolveHost.call(this, h, o);
    };
    const dip = rq(rq('node:path').join(process.cwd(), 'src/main/services/perContoDellaScheda.js'))._dip;
    const richiesta = dip.richiesta;
    dip.richiesta = (ses, url, o) => {
      let u = null;
      try { u = new URL(String(url)); } catch (_) {}
      if (u && u.hostname === host) return richiesta(ses, `http://127.0.0.1:${port}/${u.hostname}${u.pathname}${u.search}`, o);
      return richiesta(ses, url, o);
    };
  }, { port: rete.port, host: RACCOLTA });

  const dalSito = (msg) => app.evaluate(async ({ BrowserWindow }, m) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tab = win._filoTabs.tabs.find((t) => String(t.url || '').includes('sito-pubblico.test'));
    const code = `chrome.runtime.sendMessage(${JSON.stringify(m)})`;
    return tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code }]);
  }, msg);

  // Il clic su quel collegamento scritto da Filo sopra la pagina chiede l'OK: è un indirizzo in attesa di OK.
  const MSG = await app.evaluate(() => globalThis.SN_MSG.MSG.APRI_COLLEGAMENTO_FILO);
  const clic = await dalSito({ type: MSG, url: LINK });
  expect(clic.aperto, 'il clic dovrebbe chiedere l\'OK').toBe(false);
  expect(clic.conferma, 'il clic dovrebbe chiedere l\'OK').toBeTruthy();

  // Il tasto destro (anteprima del collegamento) non deve mandare l'indirizzo al sito prima di quell'OK.
  const r = await dalSito({ type: 'fetch_link_meta', url: LINK });
  await new Promise((res) => setTimeout(res, 1500));
  expect(rete.arrivate, 'l\'anteprima ha mandato al sito un indirizzo che al clic chiede l\'OK').toEqual([]);
  expect(r.ok).toBe(false);
});
