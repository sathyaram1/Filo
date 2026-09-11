// #584, terzo giro — il giudice che dovrebbe fermare un nome scritto a lettere.
//
// La pulizia per forme prende email, codici, chiocciole e numeri lunghi. Un
// nome di persona scritto a lettere («Profilo di Mario Rossi», oppure un
// indirizzo come /mariorossi) nessuna forma lo distingue da una parola
// qualunque: a fermarlo dovrebbe essere il modello che giudica, al quale — dice
// il lavoro — adesso si mostra anche l'indirizzo di partenza e i nomi degli
// elementi, non più la sola frase.
//
// Qui si guarda il PROMPT VERO che parte verso il modello, non il pacchetto che
// il raccoglitore passa a chi lo spedisce: è fra i due che si perde.

import { test, expect } from '../../fixtures/electron.mjs';

const SELETTORE = '[aria-label="Profilo di Mario Rossi"]';
const PARTENZA = '/mariorossi/ordini';

async function promptDelGiudice(app, payload) {
  return app.evaluate(async ({ app: _a }, { payload }) => {
    const req = process.mainModule.require.bind(process.mainModule);
    const H = req('./services/handlers');
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
      await H.handleAIRequest({
        action: globalThis.SN_CONST.ACTIONS.HELP_INTENT_JUDGE,
        payload,
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
  }, { payload });
}

test('il giudice si trova davanti l’indirizzo di partenza e i nomi degli elementi che verrebbero pubblicati', async ({ app }) => {
  const { errore, testo } = await promptDelGiudice(app, {
    proposedIntent: 'aprire il profilo',
    userMessages: ['aprimi il profilo'],
    initialUrl: PARTENZA,
    steps: [{ selector: SELETTORE, action: 'click' }],
  });

  expect(errore).toBeNull();
  // la frase c'era già prima e non è in discussione
  expect(testo).toContain('aprire il profilo');
  // queste due sono la difesa che il lavoro dichiara
  expect(testo).toContain(PARTENZA);
  expect(testo).toContain('Profilo di Mario Rossi');
  // e il prompt non deve dire al modello che non c'è niente da guardare
  expect(testo).not.toContain('(nessuna)');
  expect(testo).not.toContain('(nessun elemento)');
});
