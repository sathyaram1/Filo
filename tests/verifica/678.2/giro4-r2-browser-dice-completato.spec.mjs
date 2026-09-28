// #678.2 giro 4, rilievo 2 — il browser non deve dire «Accesso a Filo completato» a un
// accesso che un attimo dopo Filo dichiara non riuscito.

import { test, expect } from '../../fixtures/electron.mjs';

test('codice rifiutato dopo il browser: la pagina del browser non dice «completato»', async ({ app, openTab }) => {
  await app.evaluate(({ shell }) => {
    globalThis.__aperture = [];
    shell.openExternal = async (u) => { globalThis.__aperture.push(u); };
  });
  const page = await openTab('filo://board/board.html');
  await page.waitForFunction(() => window.__boardTest, null, { timeout: 15_000 });
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 15_000 });
  await page.locator('#bdSignIn').click();
  await expect.poll(() => app.evaluate(() => globalThis.__aperture.length)).toBe(1);
  const u = new URL(await app.evaluate(() => globalThis.__aperture[0]));
  const state = encodeURIComponent(u.searchParams.get('state'));
  const testo = await fetch(`${u.searchParams.get('redirect_uri')}/?code=finto&state=${state}`).then((r) => r.text());
  await expect(page.locator('#bdAuthMsg')).toHaveClass(/bd-auth-ko/, { timeout: 30_000 });
  expect(testo).not.toContain('completato');
});
