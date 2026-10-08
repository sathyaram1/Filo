// La pagina Opzioni aperta segue i cambiamenti fatti da fuori (#667).
// Il modello di un'azione si sceglie anche dal tasto destro di una pagina web
// (la dettatura): se la pagina Opzioni restasse ferma alla fotografia
// dell'apertura, il primo campo toccato lì rimanderebbe indietro quella scelta.

import { test, expect } from './fixtures/electron.mjs';

const daFuori = (page, models) => page.evaluate(
  (m) => chrome.runtime.sendMessage({
    type: window.SN_MSG.MSG.UPDATE_SETTINGS,
    settings: { models: m },
  }),
  models,
);

const salvate = (page) => page.evaluate(async () => {
  const r = await chrome.storage.local.get('settings');
  return (r && r.settings) || {};
});

test('il modello scelto altrove resta scelto dopo un campo toccato in Opzioni', async ({ openTab }) => {
  const altrove = await openTab('filo://newtab/');
  const opts = await openTab('filo://options/options.html');
  await opts.waitForSelector('#monthlyLimit');

  await daFuori(altrove, { transcribe_audio: 'dettatore-scelto' });
  await expect
    .poll(async () => (await salvate(opts)).models?.transcribe_audio, { timeout: 8_000 })
    .toBe('dettatore-scelto');

  // Un campo che coi modelli non c'entra: il limite di spesa.
  await opts.fill('#monthlyLimit', '7');
  await opts.locator('#monthlyLimit').blur();
  await expect.poll(async () => (await salvate(opts)).monthlyLimitEur, { timeout: 8_000 }).toBe(7);

  const dopo = await salvate(opts);
  expect(dopo.models.transcribe_audio, 'il modello scelto altrove resta').toBe('dettatore-scelto');
});
