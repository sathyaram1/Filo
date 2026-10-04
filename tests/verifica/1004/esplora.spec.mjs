// esplorazione giro 2 (da cancellare)
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..', '..');

test('dominio registrabile: accesso a Google', async ({ app }) => {
  const r = await app.evaluate(async () => {
    await globalThis.SN_DELICATE.segnaCampi('https://accounts.google.com/signin/v2/identifier');
    const f = await globalThis.SN_DELICATE.filtro();
    return ['https://docs.google.com/document/d/1/edit', 'https://www.google.com/maps/place/Roma', 'https://www.google.com/search?q=pizza', 'https://www.youtube.com/watch?v=1']
      .map((u) => [u, f(u)]);
  });
  console.log(JSON.stringify(r));
});

test('aspetto sicurezza e preferenze', async ({ app, openTab }) => {
  const sec = await openTab('filo://security/security.html');
  await expect(sec.locator('#sec-delicate')).toBeChecked({ timeout: 8000 });
  await sec.locator('#sec-delicate-sites').fill('studio-rossi.it\n<b>x</b>\n😀\ncommercialista');
  await sec.locator('#sec-delicate-sites').blur();
  await sec.waitForTimeout(500);
  const pref = await openTab('filo://preferences/preferences.html');
  for (const tema of ['light', 'dark']) {
    await app.evaluate(async ({}, t) => globalThis.SN_STORAGE.updateSettings({ theme: t }), tema);
    await sec.bringToFront();
    await sec.waitForTimeout(700);
    await sec.locator('#sec-delicate').scrollIntoViewIfNeeded();
    await sec.screenshot({ path: join(ROOT, 'tests', '.shots', `v1004-sec-${tema}.png`) });
    await pref.bringToFront();
    await pref.waitForTimeout(700);
    await pref.locator('#riassuntoSchede').scrollIntoViewIfNeeded();
    await pref.screenshot({ path: join(ROOT, 'tests', '.shots', `v1004-pref-${tema}.png`) });
  }
  console.log('ERR', await sec.locator('#sec-delicate-sites-error').innerText());
});
