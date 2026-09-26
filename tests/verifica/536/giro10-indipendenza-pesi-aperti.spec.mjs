// Verifica #536 giro 10 — l'indipendenza del secondo giudizio.
//
// Il feedback chiede che il guardiano NON giri sul modello che ha scritto il
// testo: due contesti sullo stesso modello cadono insieme. Qui si guarda se la
// regola regge quando l'interruttore «solo modelli a pesi aperti» riscrive la
// catena dopo che l'indipendenza è già stata verificata.

import { test, expect } from './../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

test('con «solo modelli a pesi aperti» il guardiano non finisce sul modello che ha scritto il testo', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: true,
      apiKeys: { openrouter: 'k-test' },
      models: {
        // Il testo lo scrive un modello a pesi aperti; il guardiano ne ha uno
        // suo, diverso, proprietario.
        [C.ACTIONS.FILO_CHAT]: 'deepseek',
        [C.ACTIONS.NOTICE_GUARD]: 'claude',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__modelli = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => {
      globalThis.__modelli.push(attempts.map((a) => a.model).join('|'));
      return {
        text: '{"passa":true,"motivo":null}',
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
      };
    };
  });

  const dash = await openTab(NEWTAB);
  const r = await dash.evaluate(async () => {
    const { MSG } = window.SN_MSG;
    return chrome.runtime.sendMessage({
      type: MSG.FILO_AVVISO_PROPOSTO,
      testo: 'Tre mail nuove: due newsletter e una da tua sorella.',
      fonte: 'posta@example.invalid',
      classe: 'messaggio',
      richiesta: 'avvisami delle mail importanti',
      modelloProduttore: 'deepseek',
    });
  });
  expect(r.ok).toBe(true);

  const modelli = await app.evaluate(() => globalThis.__modelli);
  expect(modelli.length, 'il guardiano è stato interpellato').toBeGreaterThan(0);
  expect(modelli.join(' '), 'il guardiano è girato sul modello che ha scritto il testo')
    .not.toContain('deepseek-v4-pro');
});
