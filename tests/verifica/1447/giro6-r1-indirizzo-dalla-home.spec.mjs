// Giro 6, rilievo 1: aperto un indirizzo dalla casella della home con «/», la casella si svuota ma lo strato dei segni
// del correttore tiene ancora il testo di prima; il controllo esistente sul cammino (#398) diventa rosso.
import { test, expect } from '../../fixtures/electron.mjs';

test('r1 aperto un indirizzo dalla home, nella home non resta traccia del testo scritto', async ({ app, openTab, testServer }) => {
  const fullUrl = testServer.html('<!doctype html><title>locale-ok</title><h1 id="marker">locale ok</h1>');
  const typed = fullUrl.replace(/^https?:\/\//, '');
  const dash = await openTab('filo://newtab/');
  const input = dash.locator('#input');
  await input.waitFor({ state: 'visible', timeout: 8000 });
  await input.fill('/' + typed);
  await input.press('Enter');

  await expect.poll(() => app.windows().some((w) => { try { return w.url() === `http://${typed}`; } catch (_) { return false; } }),
    { timeout: 10_000 }).toBe(true);
  await expect(input).toHaveValue('');
  const resta = await dash.evaluate((addr) =>
    Array.from(document.querySelectorAll('.sn-spell-overlay')).some((o) => (o.textContent || '').includes(addr)), typed);
  expect(resta, 'svuotata la casella, lo strato dei segni non tiene più il testo di prima').toBe(false);
});
