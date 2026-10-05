// #758 giro 5 (riallineamento): esplorazione delle zone in conflitto. Si cancella dopo il giro.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

test('accesso con password: sito fra quelli con accesso E fra i delicati; Sicurezza mostra entrambi gli elenchi', async ({ app, openTab }) => {
  const server = createServer((req, res) => {
    if (req.url.startsWith('/entra')) {
      res.writeHead(302, { Location: '/dentro', 'Set-Cookie': ['sessionid=m1; Max-Age=86400; Path=/; HttpOnly'] });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (req.url.startsWith('/dentro')) { res.end('<title>DENTRO</title>'); return; }
    res.end('<title>ACCESSO</title><form method="post" action="/entra"><input name="u" id="u">'
      + '<input type="password" name="p" id="pw"><button id="vai">Entra</button></form>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;
  try {
    const p = await openTab(`http://b.localhost:${porta}/modulo`);
    await p.waitForSelector('#pw');
    await expect.poll(() => app.evaluate(() => globalThis.SN_DELICATE.haCampi('b.localhost')), { timeout: 8_000 }).toBe(true);
    await p.fill('#u', 'io');
    await p.fill('#pw', 'segreta');
    await p.click('#vai');
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.cookies.loggedSites || []),
      { timeout: 10_000 }).toContain('b.localhost');

    const sec = await openTab('filo://security/security.html');
    const acc = sec.locator('#cookie-accessi-list li', { hasText: 'b.localhost' });
    const del = sec.locator('#sec-delicate-campi-list li', { hasText: 'b.localhost' });
    await expect(acc).toBeVisible({ timeout: 8_000 });
    await expect(del).toBeVisible({ timeout: 8_000 });
    expect(await acc.evaluate((el) => getComputedStyle(el).display)).toBe('flex');
    expect(await del.evaluate((el) => getComputedStyle(el).display)).toBe('flex');
    const desc = await sec.locator('#sec-cookies-whitelist').innerText();
    console.log('FIDATI:', desc.slice(0, 600));
    console.log('NOTA:', await sec.locator('#sec-cookies-trusted-note').innerText());
    await sec.locator('#sec-cookies-accessi').scrollIntoViewIfNeeded();
    await sec.screenshot({ path: 'tests/.shots/v758-giro5-sicurezza.png', fullPage: false });

    await acc.getByRole('button', { name: 'Togli' }).click();
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.cookies.loggedSites || []),
      { timeout: 5_000 }).toEqual([]);
    await expect(del).toBeVisible();
  } finally {
    try { server.closeAllConnections?.(); } catch (_) {}
    await new Promise((r) => server.close(r));
  }
});
