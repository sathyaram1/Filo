// #584, dodicesimo giro — la porta che l'undicesimo giro aveva trovato aperta.
//
// Il pendolo di questa famiglia ha oscillato per quattro giri: l'ottavo chiude
// il cognome e mangia le sezioni, il nono rimette le sezioni e lascia uscire il
// cognome che sta accanto a una parola da sezione, il decimo chiude il cognome
// e rimangia le sezioni a due parole. Qui si guardano le DUE cose insieme,
// perche' e' chiudendone una che si e' riaperta l'altra ogni volta.
//
// Si guarda anche dal lato della LETTURA: un percorso gia' pubblicato viene
// ripulito di nuovo quando qualcuno lo riusa, quindi la stessa regola decide
// due volte e deve dare la stessa risposta.

import { test, expect } from '../../fixtures/electron.mjs';

async function pulisci(app, casi) {
  return app.evaluate(async ({ app: _a }, casi) => {
    const S = globalThis.SN_PATHS_SAFETY;
    return casi.map(([host, percorso]) => {
      const scritto = S._internal.redigiPercorso(percorso, host);
      const riletto = S._internal.sanitizeInitialUrl(scritto, host);
      return { percorso, scritto, riletto };
    });
  }, casi);
}

// Le sezioni vere delle aree personali: il nome della sezione deve restare
// leggibile, perche' e' l'unica cosa per cui chi riusa un percorso lo legge.
const SEZIONI = [
  ['banca.it', '/clienti/12345/fatture-elettroniche', 'fatture'],
  ['banca.it', '/clienti/12345/documenti-fiscali', 'documenti'],
  ['banca.it', '/clienti/12345/rimborsi-richiesti', 'rimborsi'],
  ['negozio.it', '/utenti/12345/ordini-annullati', 'ordini'],
  ['luce.it', '/utente/12345/bollette-scadute', 'bollette'],
  ['corriere.it', '/utente/12345/consegne-programmate', 'consegne'],
  ['azienda.it', '/utenti/12345/spese-viaggio', 'spese'],
  ['sito.it', '/utente/12345/note-legali', 'note'],
  ['sito.it', '/clienti/12345/dati-fatturazione', 'dati'],
  ['sito.it', '/clienti/12345/pagamenti-ricorrenti', 'pagamenti'],
  ['sito.it', '/clienti/12345/contratti-attivi', 'contratti'],
  ['shop.com', '/users/12345/order-tracking', 'order'],
  ['shop.com', '/users/12345/saved-searches', 'saved'],
  ['shop.com', '/users/12345/returns-center', 'returns'],
  // E il pezzo SUBITO dopo la parola che annuncia la persona, che fino al
  // decimo giro era un segnaposto e basta.
  ['sito.it', '/utente/ordini', 'ordini'],
  ['sito.it', '/utente/preferiti', 'preferiti'],
  ['sito.it', '/profilo/notifiche', 'notifiche'],
  ['sito.it', '/user/settings', 'settings'],
  ['sito.it', '/clienti/fatture', 'fatture'],
  ['sito.it', '/utente/metodi-di-pagamento', 'pagamento'],
];

// I nomi di persona: non devono uscire, in nessuna delle forme che i giri
// passati hanno trovato.
const NOMI = [
  ['studio.it', '/clienti/12345/rossi-fatture'],
  ['studio.it', '/clienti/12345/rossi-documenti'],
  ['negozio.it', '/clienti/999/bianchi-ordini'],
  ['sito.it', '/utenti/mariorossi-profilo'],
  ['sito.it', '/users/smith-account'],
  ['sito.it', '/utenti/mario-rossi-privacy'],
  ['sito.it', '/utenti/mario-nuovo'],
  ['sito.it', '/users/12345/mario-rossi'],
  ['sito.it', '/utenti/12345/rossi-mario/documenti'],
  ['sito.it', '/user/12345/12345-mario-rossi'],
  ['ebay.it', '/usr/mariorossi'],
  ['sito.it', '/utenti/12345/carta-rossi'],
  ['sito.it', '/utenti/12345/piano-rossi'],
  ['github.com', '/mariorossi/progetto'],
];

test('il nome della sezione resta leggibile, in scrittura e quando il percorso viene riusato', async ({ app }) => {
  const out = await pulisci(app, SEZIONI.map(([h, p]) => [h, p]));
  const persi = [];
  out.forEach((r, i) => {
    const parola = SEZIONI[i][2];
    if (!r.scritto.includes(parola)) persi.push(`${r.percorso} → ${r.scritto}`);
    // La seconda pulizia non deve mangiare quello che la prima aveva tenuto.
    if (r.riletto !== r.scritto) persi.push(`in lettura cambia: ${r.scritto} → ${r.riletto}`);
  });
  expect(persi).toEqual([]);
});

test('e il nome di una persona non esce, nemmeno quando sta accanto a una parola da sezione', async ({ app }) => {
  const out = await pulisci(app, NOMI);
  const usciti = [];
  for (const r of out) {
    if (/rossi|mario|bianchi|smith|luca/i.test(r.scritto)) usciti.push(`${r.percorso} → ${r.scritto}`);
    if (/rossi|mario|bianchi|smith|luca/i.test(r.riletto)) usciti.push(`in lettura: ${r.percorso} → ${r.riletto}`);
  }
  expect(usciti).toEqual([]);
});

test('due sezioni diverse dello stesso sito non arrivano all’assistente scritte uguali', async ({ app }) => {
  const out = await pulisci(app, [
    ['banca.it', '/clienti/12345/fatture-elettroniche'],
    ['banca.it', '/clienti/12345/documenti-fiscali'],
    ['sito.it', '/utente/ordini'],
    ['sito.it', '/utente/preferiti'],
  ]);
  const scritti = out.map((r) => r.scritto);
  expect(new Set(scritti).size).toBe(scritti.length);
});

test('e sul cammino vero il percorso che entra in coda porta la sezione, non il cognome', async ({ app }) => {
  const esito = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const P = globalThis.SN_PATHS;
    C._reset(); C._setAuto(false); C._setSorteggio(() => 0);
    const vero = P.submit;
    P.submit = async () => ({ id: 'mai' });
    await C.collectAndSave({
      session: {
        rawUrl: 'https://studio.it/clienti/12345/rossi-fatture',
        rawSteps: [{ selector: '[aria-label="Apri la cartella"]', action: 'click' }],
        rawUserMessages: ['dove sono le fatture del cliente?'],
        success: true,
      },
      invokeAI: async ({ action }) => (action === 'help_intent_guess'
        ? { text: 'aprire la cartella delle fatture' }
        : { text: '{"ok": true}' }),
    });
    const coda = C._peek();
    P.submit = vero;
    C._reset();
    return coda;
  });
  expect(esito.length).toBe(1);
  expect(JSON.stringify(esito[0])).not.toMatch(/rossi/i);
});
