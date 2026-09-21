// Verifica locale, giro 3: la strada equivalente. L'interruttore si accende
// anche CHIEDENDOLO a Filo, non solo dal pannello: qui si guarda che quella
// strada porti allo stesso stato, e che si torni indietro. Prova del giro.

import { test, expect } from '../../fixtures/electron.mjs';

// Fa quello che fa Filo quando l'utente gli chiede di cambiare l'impostazione:
// interpreta la frase, ne ricava la modifica e la applica alle impostazioni.
async function chiediAFilo(app, frase, valore) {
  return app.evaluate(async (_electron, { frase: f, valore: v }) => {
    const cambio = globalThis.SN_PREF.buildPreferencePartial(f, v);
    if (!cambio) return { riconosciuta: false };
    const S = globalThis.__filoStorage;
    const cur = (await S.get('settings')).settings || {};
    await S.set({ settings: { ...cur, ...cambio.partial } });
    const eff = await globalThis.__filoHandlers.getEffectiveSettings();
    const esclusi = eff.excludedProviders || [];
    return {
      riconosciuta: true,
      etichetta: cambio.label,
      acceso: eff.openWeightsOnly === true,
      // Quello che viaggia DAVVERO con ogni richiesta allo smistatore.
      ignore: globalThis.SN_CONST.providerIgnoreList(esclusi).map((x) => String(x).toLowerCase()),
    };
  }, { frase, valore });
}

test('chiedendolo a Filo a parole, il produttore del modello stretto entra fra gli esclusi', async ({ app }) => {
  const acceso = await chiediAFilo(app, 'solo pesi aperti', 'sì');
  expect(acceso.riconosciuta, 'Filo deve riconoscere la richiesta a parole').toBe(true);
  expect(acceso.acceso).toBe(true);
  expect(acceso.ignore).toContain('typesafe');
  expect(acceso.ignore).toContain('anthropic');

  // Invariante: quello che si accende si toglie, dalla stessa strada.
  const spento = await chiediAFilo(app, 'solo pesi aperti', 'no');
  expect(spento.acceso).toBe(false);
  expect(spento.ignore).not.toContain('typesafe');
  // I laboratori esclusi dalla politica restano fuori in tutti e due i casi.
  expect(spento.ignore).toContain('openai');
});

test('le altre parole con cui un utente chiederebbe la stessa cosa portano allo stesso posto', async ({ app }) => {
  for (const frase of ['niente modelli proprietari', 'solo modelli aperti', 'open weights']) {
    const r = await chiediAFilo(app, frase, 'sì');
    expect(r.riconosciuta, `frase non riconosciuta: ${frase}`).toBe(true);
    expect(r.ignore, `${frase}: il produttore stretto deve viaggiare con la richiesta`).toContain('typesafe');
    await chiediAFilo(app, frase, 'no');
  }
});
