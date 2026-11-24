// Verifica #2646.1 giro 1: un fornitore che parla http e socks5 sulla stessa porta (gli elenchi di Webshare,
// ip:porta:utente:password) va usato in http quando ha le credenziali: in socks5 Chromium non le manda.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';

const require = createRequire(import.meta.url);
const P = require('../../../src/main/services/proxyTab.js');

async function fornitoreMisto() {
  const server = createServer((s) => {
    s.on('error', () => {});
    s.once('data', (b) => {
      if (b[0] === 0x05) s.end(Buffer.from([0x05, 0xff]));
      else s.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, close: () => new Promise((r) => { server.close(r); }) };
}

test('r1 un elenco con utente e password su una porta http e socks5 apre le schede in http', async () => {
  const f = await fornitoreMisto();
  try {
    const settings = { proxy: { datacenter: `127.0.0.1:${f.port}:mario-{country}:passwordsegreta` } };
    const r = await P.resolveSentito('de', { settings, env: {} });
    expect(r.proxyRules).toBe(`http://127.0.0.1:${f.port}`);
    expect(r.auth).toEqual({ username: 'mario-de', password: 'passwordsegreta' });
  } finally { await f.close(); }
});
