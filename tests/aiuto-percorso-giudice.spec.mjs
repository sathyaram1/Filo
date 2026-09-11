// Il modello che decide se un percorso può essere pubblicato deve AVERE DAVANTI
// quello che verrebbe pubblicato (#584).
//
// Nel percorso condiviso ci sono due parti che nessuna regola di forma sa
// ripulire fino in fondo: l'indirizzo della pagina di partenza e i nomi degli
// elementi su cui si è cliccato. Un nome di persona scritto a lettere — dentro
// un'etichetta, o come primo pezzo di un indirizzo — è una parola come le
// altre. L'unica cosa che lo riconosce è il modello che giudica il percorso
// prima che parta, e per riconoscerlo deve vederlo.
//
// Perché è una spec e non un unit test: fra chi raccoglie il percorso e il testo
// che parte verso il modello c'è il pezzo che compone la domanda, e quello vive
// nel processo principale di Filo. I due lati erano verdi tutti e due — chi
// raccoglie mandava indirizzo ed elementi, il testo della domanda sapeva
// scriverli — e in mezzo si perdevano: al modello arrivava «(nessuna)» e
// «(nessun elemento)», e approvava alla cieca.
//
// Senza il fix questa spec è rossa.

import { test, expect } from './fixtures/electron.mjs';

const PARTENZA = '/negozio/ordini';
const ELEMENTO = '[aria-label="Profilo di Mario Rossi"]';

test('al modello che giudica un percorso condiviso arrivano l’indirizzo di partenza e i nomi degli elementi', async ({ app }) => {
  const { errore, testo } = await app.evaluate(async (_electron, { partenza, elemento }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP_INTENT_JUDGE]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const veroC = P.completeWithFallback;
    const veroS = P.streamCompleteWithFallback;
    const visti = [];
    const finto = async ({ messages }) => {
      visti.push(messages);
      return { text: '{"ok":true}', model: 'finto', provider: 'finto', costEur: 0, usage: {} };
    };
    P.completeWithFallback = finto;
    P.streamCompleteWithFallback = finto;
    let errore = null;
    try {
      await globalThis.__filoHandlers.handleAIRequest({
        action: C.ACTIONS.HELP_INTENT_JUDGE,
        payload: {
          proposedIntent: 'vedere gli ordini',
          userMessages: ['dove sono i miei ordini?'],
          initialUrl: partenza,
          steps: [{ selector: elemento, action: 'click' }],
        },
        origin: 'test',
        noCache: true,
      });
    } catch (e) {
      errore = String((e && e.message) || e);
    } finally {
      P.completeWithFallback = veroC;
      P.streamCompleteWithFallback = veroS;
    }
    return { errore, testo: JSON.stringify(visti) };
  }, { partenza: PARTENZA, elemento: ELEMENTO });

  expect(errore).toBeNull();
  expect(testo).toContain('vedere gli ordini');
  expect(testo).toContain(PARTENZA);
  expect(testo).toContain('Profilo di Mario Rossi');
  // e il testo non deve dire al modello che non c'è niente da guardare
  expect(testo).not.toContain('(nessuna)');
  expect(testo).not.toContain('(nessun elemento)');
});
