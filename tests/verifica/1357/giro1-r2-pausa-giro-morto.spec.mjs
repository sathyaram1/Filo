// #1357, giro 1: la pausa di un account dopo giri nati morti (accensione accettata, sessione mai partita) non va
// raccontata come «rifiuti» di claude.ai nell'hover di Gestione → Automazioni.
import { test, expect } from '../../fixtures/electron.mjs';

test('r2 pausa dopo giri nati morti: l’hover non parla di rifiuti', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => window.SN_ROUTINE_SESSIONI && window.SN_ROUTINE_SESSIONI.pausaInParole);
  const p = await page.evaluate(() => {
    const ora = Date.now();
    return window.SN_ROUTINE_SESSIONI.pausaInParole('Account A',
      { finoMs: ora + 3 * 3600000, perche: 'dead_round', dettaglio: '', strikes: 2, oggi: 3 }, ora);
  });
  expect(p.testo).toContain('la sessione non è partita');
  expect(p.dettaglio).not.toMatch(/rifiut/i);
});
