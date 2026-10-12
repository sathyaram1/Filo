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

// Si cerca l'etichetta della cella, non il testo: la tendina aperta di un'altra funzione elenca modelli con le stesse parole.
const cella = (page, etichetta) => page.locator('#modelsGrid > div')
  .filter({ has: page.locator(':scope > label', { hasText: etichetta }) });

// #667.7: il cambio da fuori riscrive la catena che è cambiata, non tutta la griglia; ridisegnarla intera portava
// via la spiegazione del modello appena respinto in un'altra funzione.
test('un modello cambiato da fuori non cancella la spiegazione di un rifiuto in un\'altra funzione', async ({ openTab }) => {
  const altrove = await openTab('filo://newtab/');
  const opts = await openTab('filo://options/options.html');
  await opts.waitForSelector('#useDefaultModels');
  await opts.uncheck('#useDefaultModels');
  await expect.poll(async () => (await salvate(opts)).useDefaultModels, { timeout: 8_000 }).toBe(false);

  const spiega = cella(opts, 'Spiega (inline)').locator('.sn-chain-seg').first();
  await spiega.locator('.sn-chain-input').fill('kokoro');
  await opts.keyboard.press('Tab');
  await expect(spiega.locator('.sn-chain-msg')).toBeVisible({ timeout: 4_000 });

  await daFuori(altrove, { transcribe_audio: 'dettatore-scelto' });
  await expect(cella(opts, 'Dettatura').locator('.sn-chain-input').first()).toHaveValue('dettatore-scelto', { timeout: 8_000 });
  await expect(spiega.locator('.sn-chain-msg')).toHaveText(/Modello non adatto: \S/);
});

// Chi sta scrivendo in una funzione non ferma il cambio arrivato da fuori per un'altra: col primo salvataggio
// la griglia ferma l'avrebbe rimandato indietro.
test('mentre si scrive in una funzione, il modello cambiato da fuori per un\'altra arriva e resta', async ({ openTab }) => {
  const altrove = await openTab('filo://newtab/');
  const opts = await openTab('filo://options/options.html');
  await opts.waitForSelector('#useDefaultModels');
  await opts.uncheck('#useDefaultModels');
  await expect.poll(async () => (await salvate(opts)).useDefaultModels, { timeout: 8_000 }).toBe(false);

  const spiega = cella(opts, 'Spiega (inline)').locator('.sn-chain-input').first();
  await spiega.click();
  await opts.keyboard.press('End');
  await spiega.pressSequentially('abc');

  await daFuori(altrove, { transcribe_audio: 'dettatore-scelto' });
  await expect(cella(opts, 'Dettatura').locator('.sn-chain-input').first()).toHaveValue('dettatore-scelto', { timeout: 8_000 });
  await expect(spiega, 'la casella in uso non si tocca').toBeFocused();
  await expect(spiega).toHaveValue(/abc$/);

  await opts.keyboard.press('Tab');
  await expect.poll(async () => (await salvate(opts)).models?.explain || '', { timeout: 8_000 }).toContain('abc');
  expect((await salvate(opts)).models.transcribe_audio, 'il modello scelto altrove resta').toBe('dettatore-scelto');
});
