// #724, secondo giro — l'importo in euro torna a dodici cifre quando fra il
// numero e la valuta c'è una PAROLA e non solo della formattatura.
//
// Filo capisce che quel numero è un prezzo guardando cosa gli sta attaccato:
// il primo giro ha allargato lo sguardo agli asterischi, alle parentesi e alle
// virgolette, ma basta una parola in mezzo («... in euro», «..., cioè meno di
// trenta euro») per spegnerlo, e chi legge si ritrova davanti esattamente il
// numero della segnalazione.
//
// Senza il rimedio le prove sono rosse: nel riquadro compare 27,4473924977.

import { test, expect } from '../../fixtures/electron.mjs';

async function preparaModello(app, pezzi) {
  await app.evaluate(async (_electron, frammenti) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__origProvider724 = globalThis.__origProvider724 || globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origProvider724,
      streamComplete: async ({ onDelta }) => {
        for (const p of frammenti) {
          onDelta(p);
          await new Promise((r) => setTimeout(r, 30));
        }
        return { text: frammenti.join(''), usage: {} };
      },
    };
  }, pezzi);
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

// Due modi normali di scrivere la stessa frase: in mezzo al numero e all'euro
// c'è una parola, non un asterisco.
const CASI = [
  {
    nome: 'l\'euro dopo una preposizione',
    pezzi: ['3000 rupie indiane sono ', 'circa [[calc: 3000/109.3]]', ' in euro al cambio di oggi.'],
    coda: 'al cambio di oggi',
  },
  {
    nome: 'l\'euro in fondo alla frase',
    pezzi: ['3000 rupie indiane sono ', 'circa [[calc: 3000/109.3]]', ', cioè meno di trenta euro.'],
    coda: 'meno di trenta euro',
  },
];

for (const caso of CASI) {
  test(`«3000 rupie», ${caso.nome}: l'importo si legge come un prezzo`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    const page = await openTab('filo://newtab/');
    await preparaModello(app, caso.pezzi);
    await spiega(page, '3000 rupie');
    // La risposta è finita quando è arrivata anche la coda della frase.
    await expect(page.locator('.sn-popup-body')).toContainText(caso.coda, { timeout: 60_000 });

    const testo = await page.locator('.sn-popup-body').innerText();
    // SUCCESSO: quello che chi ha segnalato voleva leggere.
    expect(testo, `l'importo non si legge come un prezzo: ${testo}`).toContain('27,45');
    expect(testo, 'tornano le dodici cifre della segnalazione').not.toContain('27,4473924977');
  });
}
