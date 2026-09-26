// #724 — «3000 rupie» selezionate, e la spiegazione dice quanto fanno in euro.
//
// Due pezzi, uno per metà della segnalazione:
//  1. il prompt porta al modello il cambio delle rupie (prima ne portava
//     dieci, scelte a mano, e per le rupie il modello andava a memoria);
//  2. il numero che compare nel riquadro è un prezzo — «27,45 €» — e non
//     «27,4473924977 €», che è quello che leggeva chi ha segnalato.
//
// Senza il rimedio il primo test è rosso perché nel prompt non c'è INR, il
// secondo perché nel riquadro arrivano dodici cifre dopo la virgola.

import { test, expect } from './fixtures/electron.mjs';

// Il modello finto risponde come risponde quello vero: il conto lo lascia al
// marker. I pezzi sono spezzati apposta col «€» staccato dal marker, che è la
// sequenza in cui il riquadro si riempiva di cifre prima di sapere che quel
// numero era un prezzo.
async function preparaModello(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__promptValuta = '';
    globalThis.__origProviderValuta = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origProviderValuta,
      streamComplete: async ({ messages, onDelta }) => {
        globalThis.__promptValuta = (messages || []).map((m) => m.content).join('\n');
        const pezzi = ['3000 rupie indiane, ', 'circa [[calc: 3000/109.3]]', ' €', ' al cambio di oggi.'];
        for (const p of pezzi) {
          onDelta(p);
          await new Promise((r) => setTimeout(r, 30));
        }
        return { text: pezzi.join(''), usage: {} };
      },
    };
  });
}

async function ripristinaModello(app) {
  await app.evaluate(() => {
    if (globalThis.__origProviderValuta) globalThis.SN_PROVIDER_OPENROUTER = globalThis.__origProviderValuta;
  });
}

async function spiega(page, selection) {
  await page.waitForFunction(
    () => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST,
    null, { timeout: 8000 },
  );
  await page.evaluate((sel) => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: sel, sentence: `Il biglietto costa ${sel}.` },
      anchor: { x: 120, y: Math.round(window.innerHeight * 0.35) },
      title: 'Approfondisci',
    });
  }, selection);
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
}

test('il cambio delle rupie arriva al modello, non solo quello di dieci valute', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await preparaModello(app);
  await spiega(page, '3000 rupie');
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 30_000 });

  const prompt = await app.evaluate(() => globalThis.__promptValuta);
  // SUCCESSO: il modello ha davanti il cambio della valuta della segnalazione.
  expect(prompt, 'nel prompt non c\'è il cambio delle rupie: il modello può solo andare a memoria')
    .toMatch(/\d[\d.]*\s+INR\b/);
  // E non è un caso isolato: ci sono anche le altre che la BCE pubblica.
  for (const sigla of ['BRL', 'PLN', 'KRW', 'ZAR', 'THB']) {
    expect(prompt, `manca ${sigla}`).toContain(` ${sigla}`);
  }

  await ripristinaModello(app);
});

test('l\'importo convertito si legge come un prezzo', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await preparaModello(app);
  await spiega(page, '3000 rupie');
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 30_000 });

  const testo = await page.locator('.sn-popup-body').innerText();
  // SUCCESSO: quello che l'utente voleva leggere.
  expect(testo, `la conversione non si legge come un prezzo: ${testo}`).toContain('27,45 €');
  expect(testo, 'il riquadro mostra ancora le dodici cifre della segnalazione')
    .not.toContain('27,4473924977');
  // Il marker non deve mai restare a vista: è roba di Filo, non testo.
  expect(testo).not.toContain('[[calc:');

  await ripristinaModello(app);
});

test('la domanda dopo riparte dal prompt vero, non da una copia senza cambi', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await preparaModello(app);
  await spiega(page, '3000 rupie');
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 30_000 });

  // L'utente chiede dell'altro nello stesso riquadro.
  await page.fill('.sn-popup textarea', 'e in dollari?');
  await page.press('.sn-popup textarea', 'Enter');
  await expect.poll(
    async () => app.evaluate(() => globalThis.__promptValuta),
    { timeout: 30_000 },
  ).toContain('e in dollari?');

  const prompt = await app.evaluate(() => globalThis.__promptValuta);
  // SUCCESSO: la conversazione è intera (domanda + risposta di prima) e porta
  // ancora i cambi, quindi la seconda conversione non va a memoria.
  expect(prompt).toContain('3000 rupie');
  expect(prompt, 'la risposta di prima è sparita dalla conversazione').toContain('27,45 €');
  expect(prompt).toMatch(/\d[\d.]*\s+INR\b/);
});
