// Verifica #1926 giro 3, r1: nella domanda di fine sessione le etichette «Per chi» e «Domanda» stanno sulla stessa
// riga, come quelle della parola d'ordine nuova sopra.
import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';
import { MANAGE } from '../../helpers/gestioneMainFinto.mjs';

test('r1 «Per chi» e «Domanda» cominciano alla stessa altezza', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && window.filo && window.__mgStrumenti);
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, isAdmin: true, signedIn: true };
      if (t === 'routine_chiavi_elenco') return { ok: true, keys: [] };
      if (t === 'routine_chiusura_get') return { ok: true, slots: [], ripiego: '', risposte: [] };
      if (t === 'manutentore_recap_get') return { ok: true, recap: [], stato: null };
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await apriScheda(page, 'automation');
  const perChi = page.locator('#mgChiusuraNuova label').filter({ has: page.locator('#mgChiusuraSlotNuovo') });
  const domanda = page.locator('#mgChiusuraNuova label').filter({ has: page.locator('#mgChiusuraTesto') });
  await expect(perChi).toBeVisible();
  const a = await perChi.boundingBox();
  const b = await domanda.boundingBox();
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(3);
});
