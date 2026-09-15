// #584, decimo giro — la correzione del nono giro aveva riaperto la porta che
// l'ottavo aveva chiuso, per i pezzi dove un cognome sta attaccato a una parola
// di sezione.
//
// L'ottavo giro aveva chiuso «il nome che sta un pezzo più in là»: dentro la
// zona che segue una parola come «utenti» o «clienti», un pezzo con la forma di
// un nome per esteso (`mario-rossi`, `rossi.mario`) diventa un segnaposto.
//
// Il nono giro ha segnalato il prezzo: `note-spese` e `ordini-recenti` hanno la
// stessa forma e sparivano anche loro. La correzione ha insegnato alla pulizia
// un elenco di parole da sezione, ma bastava UNA di quelle parole, in qualunque
// punto del pezzo, perché l'intero pezzo smettesse di contare come nome. Così
// `rossi-fatture`, `bianchi-ordini` e `mariorossi-profilo` uscivano interi, col
// cognome dentro, dove prima della correzione uscivano come segnaposto.
//
// GIRATE dopo la correzione di questo stesso giro: la domanda è rovesciata. Un
// pezzo è una sezione quando NON CI RESTA nessuna parola che una sezione non
// sia. `fatture` sì, `note-spese` sì, `rossi-fatture` no.

import { test, expect } from '../../fixtures/electron.mjs';

async function ripulisci(app, urls) {
  return app.evaluate(async ({ app: _a }, { urls }) => {
    const S = globalThis.SN_PATHS_SAFETY;
    const out = {};
    for (const u of urls) out[u] = S._internal.normalizedPath(u);
    return out;
  }, { urls });
}

test('un cognome attaccato a una parola di sezione non esce', async ({ app }) => {
  const casi = {
    // la cartella di un cliente su un portale professionale
    'https://studio-esempio.it/clienti/12345/rossi-fatture': '/clienti/[ID]/[ID]',
    'https://studio-esempio.it/clienti/12345/rossi-documenti': '/clienti/[ID]/[ID]',
    'https://negozio-esempio.it/utenti/12345/bianchi-ordini': '/utenti/[ID]/[ID]',
    'https://sito-esempio.it/clienti/12345/mariorossi-profilo': '/clienti/[ID]/[ID]',
    'https://sito-esempio.it/users/12345/smith-account': '/users/[ID]/[ID]',
    'https://sito-esempio.it/utenti/12345/mario-rossi-privacy': '/utenti/[ID]/[ID]',
  };
  const r = await ripulisci(app, Object.keys(casi));
  for (const [u, atteso] of Object.entries(casi)) expect(`${u} -> ${r[u]}`).toBe(`${u} -> ${atteso}`);
});

test('e un cognome che È una parola di sezione non si salva più da solo', async ({ app }) => {
  // «Nuovo» è un cognome italiano vero, ed è anche fra le parole da sezione:
  // finché ne bastava una, «mario-nuovo» usciva intero.
  const r = await ripulisci(app, [
    'https://sito-esempio.it/utenti/12345/mario-nuovo',
    'https://sito-esempio.it/utenti/12345/renzo-piano',
    'https://sito-esempio.it/utenti/12345/maria-carta',
  ]);
  expect(r['https://sito-esempio.it/utenti/12345/mario-nuovo']).toBe('/utenti/[ID]/[ID]');
  expect(r['https://sito-esempio.it/utenti/12345/renzo-piano']).toBe('/utenti/[ID]/[ID]');
  expect(r['https://sito-esempio.it/utenti/12345/maria-carta']).toBe('/utenti/[ID]/[ID]');
});

test('e sul cammino vero il cognome non arriva alla coda da cui il percorso parte', async ({ app }) => {
  const voce = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const P = globalThis.SN_PATHS;
    C._reset(); C._setAuto(false); C._setSorteggio(() => 0.5);
    const vero = P.submit;
    P.submit = async () => ({ id: 'mai' });
    await C.collectAndSave({
      session: {
        rawUrl: 'https://studio-esempio.it/clienti/12345/rossi-fatture',
        rawSteps: [{ selector: '[aria-label="Scarica fattura"]', action: 'click' }],
        rawUserMessages: ['dove scarico la fattura?'],
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
  expect(voce.initialUrl).toBe('/clienti/[ID]/[ID]');
  expect(JSON.stringify(voce)).not.toContain('rossi');
});

test('e la lettura non fa uscire il cognome dai percorsi già pubblicati', async ({ app }) => {
  const blocco = await app.evaluate(async () => globalThis.SN_PATHS_SAFETY.formatKnownPathsForPrompt([{
    domain: 'studio-esempio.it',
    initialUrl: '/clienti/[ID]/rossi-fatture',
    intent: 'scaricare una fattura',
    steps: [{ selector: '[aria-label="Scarica fattura"]', action: 'click' }],
    success: true,
  }]));
  expect(blocco).toContain('/clienti/[ID]/[ID]');
  expect(blocco).not.toContain('rossi-fatture');
});

test('mentre le sezioni che il nono giro aveva salvato restano leggibili', async ({ app }) => {
  const casi = {
    'https://banca-esempio.it/clienti/12345/note-spese': '/clienti/[ID]/note-spese',
    'https://banca-esempio.it/clienti/12345/metodi-di-pagamento': '/clienti/[ID]/metodi-di-pagamento',
    'https://negozio-esempio.it/utenti/12345/ordini-recenti': '/utenti/[ID]/ordini-recenti',
    'https://sito-esempio.it/users/12345/change-password': '/users/[ID]/change-password',
    'https://sito-esempio.it/user/12345/edit-profile': '/user/[ID]/edit-profile',
    'https://banca-esempio.it/clienti/12345/estratto-conto': '/clienti/[ID]/estratto-conto',
    // e quelle fatte anche di articoli o possessivi, che senza la lista
    // allargata sarebbero diventate segnaposti con questa correzione
    'https://sito-esempio.it/user/12345/my-orders': '/user/[ID]/my-orders',
    'https://sito-esempio.it/clienti/12345/i-miei-documenti': '/clienti/[ID]/i-miei-documenti',
  };
  const r = await ripulisci(app, Object.keys(casi));
  for (const [u, atteso] of Object.entries(casi)) expect(`${u} -> ${r[u]}`).toBe(`${u} -> ${atteso}`);
});

test('e i nomi senza parole di sezione accanto continuano a sparire, come dall\'ottavo giro', async ({ app }) => {
  const casi = {
    'https://sito-esempio.it/users/12345/mario-rossi': '/users/[ID]/[ID]',
    'https://sito-esempio.it/utenti/12345/rossi-mario/documenti': '/utenti/[ID]/[ID]/documenti',
    'https://sito-esempio.it/user/12345-mario-rossi': '/user/[ID]',
    'https://sito-esempio.it/usuarios/999/jose-garcia': '/usuarios/[ID]/[ID]',
  };
  const r = await ripulisci(app, Object.keys(casi));
  for (const [u, atteso] of Object.entries(casi)) expect(`${u} -> ${r[u]}`).toBe(`${u} -> ${atteso}`);
});
