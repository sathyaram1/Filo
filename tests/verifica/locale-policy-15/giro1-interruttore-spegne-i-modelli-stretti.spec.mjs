// Verifica locale, giro 1: l'interruttore «solo modelli a pesi aperti» deve
// spegnere anche i modelli stretti ammessi dalla politica, non solo Anthropic.
// Le domande si fanno al processo vero dell'app, non a una copia dei moduli.

import { test, expect } from '../../fixtures/electron.mjs';

test('acceso, il produttore del modello stretto finisce fra gli esclusi', async ({ app }) => {
  const esito = await app.evaluate(() => {
    const C = globalThis.SN_CONST;
    const acceso = C.effectiveExcludedProviders([], true);
    const spento = C.effectiveExcludedProviders([], false);
    return {
      acceso,
      spento,
      ignoreAcceso: C.providerIgnoreList(acceso),
      violazioneAcceso: C.isProviderExcluded('TypeSafe', acceso),
      violazioneSpento: C.isProviderExcluded('TypeSafe', spento),
    };
  });

  const minuscole = esito.acceso.map((x) => String(x).toLowerCase());
  expect(minuscole).toContain('typesafe');
  expect(minuscole).toContain('anthropic');

  // Con l'interruttore spento il modello stretto è ammesso: è il senso della
  // terza categoria.
  expect(esito.spento.map((x) => String(x).toLowerCase())).not.toContain('typesafe');

  // La lista viaggia davvero con la richiesta, e il riscontro a risposta
  // arrivata riconosce il nome.
  expect(esito.ignoreAcceso.map((x) => String(x).toLowerCase())).toContain('typesafe');
  expect(esito.violazioneAcceso).toBe(true);
  expect(esito.violazioneSpento).toBe(false);
});

test('acceso, una funzione che usa il modello stretto si ferma invece di partire', async ({ app }) => {
  const esito = await app.evaluate(() => {
    const C = globalThis.SN_CONST;
    const registry = {
      jev: { provider: 'typesafe', model: 'jev-1', inputs: ['text'], outputs: ['text'] },
      deepseek: { provider: 'openrouter', model: 'deepseek/deepseek-v4', weights: 'open', inputs: ['text'], outputs: ['text'] },
    };
    return {
      soloStretto: C.applyOpenWeightsPolicy(['jev'], registry, 'classify'),
      conRipiego: C.applyOpenWeightsPolicy(['jev', 'deepseek'], registry, 'classify'),
      impatto: C.openWeightsImpact({ classify: 'jev' }, registry),
      provaBloccata: C.openWeightsBlockKind(true, registry.jev),
      provaLibera: C.openWeightsBlockKind(false, registry.jev),
    };
  });

  // Niente ripiego silenzioso: il modello stretto esce dalla catena.
  expect(esito.soloStretto.refs).toEqual([]);
  expect(esito.soloStretto.dropped).toContain('jev');
  // Con un equivalente aperto in catena, la funzione continua su quello.
  expect(esito.conRipiego.refs).toEqual(['deepseek']);
  // La pagina delle opzioni sa dire che quella funzione si ferma.
  expect(esito.impatto.unavailable.map((u) => u.action)).toContain('classify');
  // E il pulsante «Prova» sulla riga di quel modello non parte.
  expect(esito.provaBloccata).not.toBe('');
  expect(esito.provaLibera).toBe('');
});
