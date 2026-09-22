// Verifica #591 — giro 9. Quello che si paga per un tentativo che si rompe a
// metà non entra in nessun conto.
//
// La segnalazione chiede due cose al passaggio unico: che il tetto di spesa
// valga per tutti, e che il costo COMPARISCA nel conteggio. La seconda ha un
// buco: quando la risposta arriva in streaming e si interrompe dopo che il
// modello ha già prodotto del testo, Filo butta il parziale e riprova — sullo
// stesso fornitore o sul successivo — e registra soltanto il costo dell'ultimo
// tentativo. I gettoni già generati si pagano lo stesso: sulla chiave
// condivisa, quindi all'owner, e nel conto del mese non si vedono. Il tetto
// mensile, che è l'unico fondo vero di tutto questo lavoro, non li conta.
//
// Logica pura: il fornitore è finto, nessuna rete.

import { test, expect } from '@playwright/test';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require_ = createRequire(join(REPO, 'package.json'));
require_(join(REPO, 'src/main/services/providers/index.js'));
const Gate = require_(join(REPO, 'src/main/services/modelGate.js'));

// Due tentativi sullo stesso fornitore finto: il primo produce del testo e poi
// si rompe, il secondo risponde. Il fornitore sa dire a posteriori quanto è
// costata una generazione, come quello vero.
function fornitore(costi) {
  let chiamate = 0;
  const perId = new Map();
  return {
    async streamComplete({ onDelta }) {
      chiamate += 1;
      if (chiamate === 1) {
        if (onDelta) onDelta('Ecco la prima metà della risposta, già generata e già pagata');
        costi.push(0.004);
        perId.set('gen-rotta', 0.004);
        const e = new Error('stream troncato');
        e.status = 500;
        e.generationId = 'gen-rotta';
        throw e;
      }
      costi.push(0.006);
      return { text: 'risposta', usage: { promptTokens: 900, completionTokens: 300, costUsd: 0.006 } };
    },
    async lookupServedBy({ generationId }) {
      const c = perId.get(generationId);
      return c === undefined ? null : { servedBy: 'finto', costUsd: c };
    },
  };
}

test('il costo di un tentativo che si rompe a metà deve entrare nel conto', async () => {
  test.setTimeout(60000);
  const costiVeri = [];
  globalThis.SN_PROVIDER_FINTO = fornitore(costiVeri);

  const registrati = [];
  globalThis.SN_COSTS = {
    isOverLimit: async () => false,
    record: async ({ usage }) => {
      const c = Number(usage && usage.costUsd) || 0;
      registrati.push(c);
      return c;
    },
  };

  Gate.configure({
    modelForAction: () => 'modello-finto',
    buildAttemptChain: () => ([
      { provider: 'finto', apiKey: 'k', model: 'modello-finto' },
      { provider: 'finto', apiKey: 'k', model: 'modello-finto' },
    ]),
    noteServedProvider: () => ({ servedBy: 'finto', violation: false }),
  });

  await Gate.stream({ settings: { monthlyLimitEur: 5 }, action: 'prova', messages: [], onDelta: () => {} });
  // Il costo del tentativo rotto lo si chiede al fornitore poco dopo.
  await new Promise((r) => setTimeout(r, 6000));

  const speso = costiVeri.reduce((a, b) => a + b, 0);
  const contato = registrati.reduce((a, b) => a + b, 0);
  expect(
    contato,
    `il fornitore ha fatturato ${speso} USD in due tentativi, nel conto ne sono finiti ${contato}: `
    + 'quello che si paga per il tentativo rotto non si vede da nessuna parte e il tetto mensile non lo conta',
  ).toBeCloseTo(speso, 6);
});
