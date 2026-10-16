// Verifica #855: il clic sull'avviso all'owner (sulla carta, non sul suo pulsante) apre la pagina dei crediti dell'owner.
import { test, expect, aspettaFinestra } from '../../fixtures/electron.mjs';

const VISTA = {
  config: { invitesRemaining: 9 },
  totals: { maxGrantCredits: 100000, grantedCredits: 85000 },
  users: [],
  reconcile: { summary: { flagged: 0 } },
};

test('r1 il clic sul testo dell’avviso apre filo://credits/owner.html, come chiede la segnalazione', async ({ app }) => {
  const home = await aspettaFinestra(app, (w) => w.url().startsWith('filo://newtab'), 'la home non è nata');
  await app.evaluate(async ({}, v) => {
    await globalThis.SN_WALLET.applicaAvvisiOwner(globalThis.SN_FILO_MEMORY, [], v);
  }, VISTA);
  await home.reload();
  const carta = home.locator('#accade .dash-carta[data-tipo="avviso"]').filter({ hasText: 'all\'85% del tetto' });
  await expect(carta).toHaveCount(1, { timeout: 15_000 });
  await carta.locator('.dash-carta-stato, .dash-carta-tit').first().click();
  await aspettaFinestra(app, (w) => w.url().startsWith('filo://credits/owner.html'), 'il clic sull’avviso non apre la pagina dell’owner');
});
