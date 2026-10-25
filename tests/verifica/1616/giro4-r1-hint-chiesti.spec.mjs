// #1616 giro 4: la pagina di accesso di Google chiede con Accept-CH i client hints ad alta entropia; Chrome li manda
// dalla richiesta dopo (il «Avanti»), coerenti con quello che navigator.userAgentData dà alla pagina.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

// L'Accept-CH che accounts.google.com manda con la pagina di accesso.
const ACCEPT_CH = 'Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Full-Version, Sec-CH-UA-Full-Version-List, Sec-CH-UA-Model, Sec-CH-UA-WoW64, Sec-CH-UA-Form-Factors, Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version';

test('r1 gli hint che la pagina di accesso chiede con Accept-CH partono con la richiesta dopo, uguali a quelli che la pagina legge', async ({ openTab }) => {
  const viste = new Map();
  const server = createServer((req, res) => {
    viste.set(req.url, { ...req.headers });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Accept-CH': ACCEPT_CH });
    res.end('<title>Accedi</title><p>email</p>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const page = await openTab(`http://127.0.0.1:${server.address().port}/accedi`);
    await page.waitForLoadState('load').catch(() => {});
    const js = await page.evaluate(() => navigator.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'fullVersionList']));
    await page.evaluate(() => fetch('/avanti', { method: 'POST', body: 'email' }).then((r) => r.text()));
    const h = viste.get('/avanti');
    expect(h, 'la richiesta dopo il clic su Avanti non è arrivata').toBeTruthy();
    const lista = js.fullVersionList.map((b) => `"${b.brand}";v="${b.version}"`).join(', ');
    expect({
      arch: h['sec-ch-ua-arch'], bitness: h['sec-ch-ua-bitness'], lista: h['sec-ch-ua-full-version-list'],
    }).toEqual({ arch: `"${js.architecture}"`, bitness: `"${js.bitness}"`, lista });
  } finally { try { server.closeAllConnections?.(); } catch (_) {} await new Promise((r) => server.close(r)); }
});
