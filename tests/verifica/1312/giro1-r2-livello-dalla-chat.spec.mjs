// Verifica #1312 giro 1, rilievo 2: il livello di autonomia ora si cambia dalla chat (con «conferma» per alzarlo),
// quindi nessun testo che arriva al modello deve dirgli che lo cambia solo l'utente in Preferenze.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

test('r2 la descrizione dello strumento, il contesto del turno e l\'intervista non dicono al modello che il livello non lo può cambiare', async ({ app }) => {
  await home(app);
  const testi = await app.evaluate(async () => {
    const defs = globalThis.SN_ACTION_TOOLS.definitions({ onboarding: true });
    const imposta = defs.find((d) => d.function.name === 'IMPOSTA_PREFERENZA').function.description;
    const S = globalThis.SN_FILO_STATE;
    const contesto = S.renderForPrompt(await S.assemble({ sistema: false }));
    const voce = globalThis.SN_ONBOARDING.VOCI
      ? JSON.stringify(globalThis.SN_ONBOARDING.VOCI)
      : JSON.stringify(globalThis.SN_ONBOARDING);
    return { imposta, contesto, voce };
  });
  expect(testi.imposta, 'la chiave autonomia c\'è nell\'elenco').toMatch(/• autonomia:/);
  expect(testi.imposta).not.toMatch(/autonomia di Filo non è fra queste/i);
  expect(testi.contesto).toMatch(/AUTONOMIA DI FILO/);
  expect(testi.contesto).not.toMatch(/Lo cambia solo l'utente/);
  expect(testi.voce).not.toMatch(/non hai un.azione per farlo/);
});
