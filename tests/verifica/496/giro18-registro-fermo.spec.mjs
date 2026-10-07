// VERIFICA #496 — giro 18. Il registro delle esecuzioni si muove solo a rimorchio.
//
// La scheda lasciata aperta si rimette in pari col giro della pagina, ma quel
// giro rilegge il registro delle routine SOLO quando almeno una segnalazione è
// cambiata. Mentre l'esploratore gira senza trovare niente — o mentre le
// routine lavorano su numeri che non sono fra le segnalazioni caricate — i tre
// numeri che vengono dal registro (esplorazioni, lavorati, lanci) restano
// fermi a quando hai aperto la scheda, accanto a numeri che invece camminano,
// e niente lo dice.
//
// Senza il fix il controllo è rosso: il registro cresce, il numero non si
// muove.

import { test, expect } from '../../fixtures/electron.mjs';
import { URL_GESTIONE, giorniFa as g, segnalazione as fb, apriStatistiche } from './giro17-aiuto-comune.mjs';

const A = fb({ _id: 'g18-l1', seq: 1101, _updateTime: 't1' });

test('#496 giro18 — il registro delle routine cammina anche senza segnalazioni nuove', async ({ openTab }) => {
  const page = await openTab(URL_GESTIONE);

  // Il registro vero lo serve il main: qui lo stubbiamo, e lo facciamo
  // crescere sotto gli occhi della scheda.
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate((primo) => {
    window.__registro = [primo];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'worker_log_get') return { ok: true, entries: window.__registro };
      return orig(msg);
    };
  }, { role: 'prober', startedAt: g(1), num: '' });

  await apriStatistiche(page, { feedbacks: [A], workerLog: [{ role: 'prober', startedAt: g(1), num: '' }] }, [A]);
  await page.locator('[data-fs-range="30g"]').click();
  await expect(page.locator('[data-fs-id="prober"] .mg-tile-n')).toHaveText('1');

  // Parte una seconda esplorazione. Non trova niente, quindi nessuna
  // segnalazione cambia: cambia solo il registro.
  await page.evaluate((nuova) => {
    window.__registro = window.__registro.concat([nuova]);
    window.__liveState = { versions: [{ _id: 'g18-l1', _updateTime: 't1' }] };
    window.__mgTest.setLiveSources({
      listVersions: async () => window.__liveState.versions,
      getMany: async () => [],
    });
  }, { role: 'prober', startedAt: new Date().toISOString(), num: '' });
  await page.evaluate(() => window.__mgTest.pollNow());

  await expect(page.locator('[data-fs-id="prober"] .mg-tile-n')).toHaveText('2', { timeout: 15000 });
});
