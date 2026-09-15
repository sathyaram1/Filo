// #584, undicesimo giro — RILIEVO: la correzione del decimo giro ha richiuso il
// cognome e ha riaperto la sezione.
//
// La storia di questa porta, in breve. Il quinto giro aveva stabilito una
// regola: quello che non dice chi sei resta leggibile, perché un punto di
// partenza ridotto a segnaposti non serve più a nessuno che voglia riusare il
// percorso. L'ottavo giro, chiudendo il nome di persona che sta un pezzo più in
// là del numero, l'ha riaperta: `/clienti/12345/note-spese` usciva
// `/clienti/[ID]/[ID]`. Il nono giro l'ha segnata (livello due) e la correzione
// ha insegnato alla pulizia un elenco di PAROLE da sezione. Il decimo giro ha
// trovato che bastava UNA parola dell'elenco a salvare tutto il pezzo, cognome
// compreso (`rossi-fatture`), e la correzione ha rovesciato la domanda: adesso
// un pezzo è una sezione solo se OGNI sua parola sta nell'elenco.
//
// Il cognome è chiuso davvero (lo prova `giro10-il-cognome-…`, verde). Il
// prezzo però non è il caso di bordo che il commento descrive: sono le sezioni
// a due parole dove UNA sola sta nell'elenco, cioè la maggioranza di quelle
// vere. `fatture-elettroniche`, `documenti-fiscali`, `ordini-annullati`,
// `order-tracking`, `returns-center` tornano tutte `[ID]`.
//
// AGGIORNATE dopo la correzione di questo stesso giro. La domanda non è più sul
// pezzo ma sulla POSIZIONE: il pezzo tiene le parole da sezione finché ne trova,
// e dalla prima parola che una sezione non è in poi resta un segnaposto. Il nome
// sta sempre dalla parte del segnaposto, perché apre il pezzo e si porta via
// tutto quello che lo segue.
//
//   fatture-elettroniche → fatture-[ID]     rossi-fatture → [ID]
//   note-spese           → note-spese       mario-nuovo   → [ID]

import { test, expect } from '../../fixtures/electron.mjs';

async function ripulisci(app, urls) {
  return app.evaluate(async ({ app: _a }, { urls }) => {
    const S = globalThis.SN_PATHS_SAFETY;
    const out = {};
    for (const u of urls) out[u] = S._internal.normalizedPath(u);
    return out;
  }, { urls });
}

test('una sezione a due parole dice ancora da dove si parte', async ({ app }) => {
  const casi = {
    // portale di una banca / di uno studio
    'https://banca-esempio.it/clienti/12345/fatture-elettroniche': '/clienti/[ID]/fatture-[ID]',
    'https://banca-esempio.it/clienti/12345/documenti-fiscali': '/clienti/[ID]/documenti-[ID]',
    'https://banca-esempio.it/clienti/12345/rimborsi-richiesti': '/clienti/[ID]/rimborsi-[ID]',
    // negozio / operatore
    'https://negozio-esempio.it/utenti/12345/ordini-annullati': '/utenti/[ID]/ordini-[ID]',
    'https://negozio-esempio.it/utenti/12345/bollette-scadute': '/utenti/[ID]/bollette-[ID]',
    'https://negozio-esempio.it/utente/12345/consegne-programmate': '/utente/[ID]/consegne-[ID]',
    // e in inglese, dove le stesse sezioni si chiamano allo stesso modo
    'https://shop-esempio.com/user/12345/order-tracking': '/user/[ID]/order-[ID]',
    'https://shop-esempio.com/user/12345/saved-searches': '/user/[ID]/saved-[ID]',
    'https://shop-esempio.com/customer/9/returns-center': '/customer/[ID]/returns-[ID]',
  };
  const r = await ripulisci(app, Object.keys(casi));
  for (const [u, atteso] of Object.entries(casi)) expect(`${u} -> ${r[u]}`).toBe(`${u} -> ${atteso}`);
});

test('e tre pagine diverse dello stesso sito non arrivano più scritte nello stesso modo', async ({ app }) => {
  const r = await ripulisci(app, [
    'https://banca-esempio.it/clienti/12345/fatture-elettroniche',
    'https://banca-esempio.it/clienti/12345/documenti-fiscali',
    'https://banca-esempio.it/clienti/12345/spese-viaggio',
  ]);
  const usciti = Object.values(r);
  expect(new Set(usciti).size).toBe(3);
  expect(usciti.every((u) => u !== '/clienti/[ID]/[ID]')).toBe(true);
});

test('e in lettura vale lo stesso, sui percorsi già pubblicati', async ({ app }) => {
  // Un documento scritto per intero nella raccolta perde il nome della sezione
  // mentre arriva all'assistente: non è solo quello che si pubblica da oggi.
  const blocco = await app.evaluate(async () => globalThis.SN_PATHS_SAFETY.formatKnownPathsForPrompt([{
    domain: 'banca-esempio.it',
    initialUrl: '/clienti/[ID]/fatture-elettroniche',
    intent: 'scaricare una fattura',
    steps: [{ selector: 'Scarica', action: 'click' }],
    success: true,
  }]));
  expect(blocco).toContain('(da /clienti/[ID]/fatture-[ID])');
});

test('e sul cammino vero la sezione arriva alla coda da cui il percorso parte', async ({ app }) => {
  const voce = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const P = globalThis.SN_PATHS;
    C._reset(); C._setAuto(false); C._setSorteggio(() => 0.5);
    const vero = P.submit;
    P.submit = async () => ({ id: 'mai' });
    await C.collectAndSave({
      session: {
        rawUrl: 'https://banca-esempio.it/clienti/12345/fatture-elettroniche',
        rawSteps: [{ selector: '[aria-label="Scarica la fattura"]', action: 'click' }],
        rawUserMessages: ['dove trovo le fatture elettroniche?'],
        success: true,
      },
      invokeAI: async ({ action }) => (action === 'help_intent_guess'
        ? { text: 'scaricare una fattura' }
        : { text: '{"ok": true}' }),
    });
    const coda = C._peek();
    P.submit = vero;
    C._reset();
    return coda[coda.length - 1] || null;
  });
  expect(voce).not.toBeNull();
  expect(voce.initialUrl).toBe('/clienti/[ID]/fatture-[ID]');
});

test('mentre il cognome che il decimo giro è andato a chiudere resta chiuso', async ({ app }) => {
  const casi = {
    'https://studio-esempio.it/clienti/12345/rossi-fatture': '/clienti/[ID]/[ID]',
    'https://negozio-esempio.it/utenti/12345/bianchi-ordini': '/utenti/[ID]/[ID]',
    'https://sito-esempio.it/utenti/12345/mario-nuovo': '/utenti/[ID]/[ID]',
    'https://sito-esempio.it/users/12345/mario-rossi': '/users/[ID]/[ID]',
  };
  const r = await ripulisci(app, Object.keys(casi));
  for (const [u, atteso] of Object.entries(casi)) expect(`${u} -> ${r[u]}`).toBe(`${u} -> ${atteso}`);
});

test('e le sezioni che il nono giro aveva salvato sono ancora leggibili', async ({ app }) => {
  const casi = {
    'https://banca-esempio.it/clienti/12345/note-spese': '/clienti/[ID]/note-spese',
    'https://banca-esempio.it/clienti/12345/metodi-di-pagamento': '/clienti/[ID]/metodi-di-pagamento',
    'https://negozio-esempio.it/utenti/12345/ordini-recenti': '/utenti/[ID]/ordini-recenti',
    'https://sito-esempio.it/users/12345/change-password': '/users/[ID]/change-password',
  };
  const r = await ripulisci(app, Object.keys(casi));
  for (const [u, atteso] of Object.entries(casi)) expect(`${u} -> ${r[u]}`).toBe(`${u} -> ${atteso}`);
});
