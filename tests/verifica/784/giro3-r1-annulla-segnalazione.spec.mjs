// #784 giro 3, rilievo 1: SECURITY.md §3 promette che le funzioni che gestiscono
// i feedback rispondono solo alle pagine di Filo. L'annullamento di una
// segnalazione automatica cambia lo stato di un feedback: da un sito deve
// tornare «rifiutato per provenienza», come le altre porte dei feedback.

import { test, expect } from '../../fixtures/electron.mjs';

const SITO = { url: 'https://evil.example/pagina' };
const SITO_CON_SCHEDA = { tab: { id: 1, url: 'https://evil.example/pagina' }, url: 'https://evil.example/pagina' };

test('r1 da un sito visitato l\'annullamento di una segnalazione rifiuta per provenienza', async ({ app, shell }) => {
  void shell;
  const out = await app.evaluate(async (_electron, mittenti) => {
    const MSG = globalThis.SN_MSG.MSG;
    const msg = { type: MSG.CANCEL_AUTO_FEEDBACK, id: 'fb-uno' };
    const conTetto = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r({ scaduto: true }), 20000))]);
    return {
      sito: await conTetto(globalThis.SN_HANDLE_MESSAGE(msg, mittenti.sito)),
      sitoConScheda: await conTetto(globalThis.SN_HANDLE_MESSAGE(msg, mittenti.sitoConScheda)),
    };
  }, { sito: SITO, sitoConScheda: SITO_CON_SCHEDA });

  for (const provenienza of ['sito', 'sitoConScheda']) {
    const r = out[provenienza];
    expect(r, `${provenienza}: nessuna risposta`).toBeTruthy();
    expect(r.ok, `${provenienza}: un sito visitato non deve ottenere niente`).toBe(false);
    expect(
      String(r.code || ''),
      `${provenienza}: rifiutato per il motivo sbagliato (${JSON.stringify(r)}) — con la sessione del proprietario passerebbe`,
    ).toBe('forbidden');
  }
});
