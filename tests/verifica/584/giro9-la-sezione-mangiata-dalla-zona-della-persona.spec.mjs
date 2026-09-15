// #584, nono giro — la zona della persona si mangiava anche il nome della
// sezione, e riapriva la porta che il quinto giro aveva chiuso.
//
// Il quinto giro aveva stabilito che la pulizia dell'indirizzo non deve togliere
// quello che non dice chi sei: «un indirizzo ridotto a /[ID] non dice più
// nemmeno da che punto del sito si parte, che è l'unica cosa per cui chi riusa
// un percorso lo legge». Da lì la regola per sottrazione.
//
// L'ottavo giro ha aggiunto la «zona della persona»: dopo un marcatore, per due
// pezzi ancora, un pezzo con la FORMA di un nome per esteso diventava un
// segnaposto. La forma è «due parole attaccate da - . o _» — e le sezioni delle
// aree personali si chiamano tutte così: `note-spese`, `ordini-recenti`,
// `change-password`, `edit-profile`, `dati-personali`. Sono proprio le pagine
// dove l'Aiuto serve di più (banca, negozio, area clienti), e il punto di
// partenza che Filo pubblicava per loro era `/clienti/[ID]/[ID]`.
//
// GIRATE dopo la correzione di questo stesso giro: dentro la zona la forma non
// basta più, si guardano anche le parole del pezzo. Una sola parola da sezione
// e quello non è il nome di una persona.

import { test, expect } from '../../fixtures/electron.mjs';

async function ripulisci(app, urls) {
  return app.evaluate(async ({ app: _a }, { urls }) => {
    const S = globalThis.SN_PATHS_SAFETY;
    const out = {};
    for (const u of urls) out[u] = S._internal.normalizedPath(u);
    return out;
  }, { urls });
}

test('il nome della sezione resta leggibile anche dopo il segnaposto della persona', async ({ app }) => {
  const r = await ripulisci(app, [
    'https://banca-esempio.it/clienti/12345/note-spese',
    'https://banca-esempio.it/clienti/12345/metodi-di-pagamento',
    'https://negozio-esempio.it/utenti/12345/ordini-recenti',
    'https://sito-esempio.it/users/12345/change-password',
    'https://sito-esempio.it/user/12345/edit-profile',
    'https://sito-esempio.it/utente/12345/dati-personali/modifica',
    'https://banca-esempio.it/clienti/12345/estratto-conto',
    'https://sito-esempio.it/users/12345/two-factor',
  ]);
  expect(r['https://banca-esempio.it/clienti/12345/note-spese']).toBe('/clienti/[ID]/note-spese');
  expect(r['https://banca-esempio.it/clienti/12345/metodi-di-pagamento']).toBe('/clienti/[ID]/metodi-di-pagamento');
  expect(r['https://negozio-esempio.it/utenti/12345/ordini-recenti']).toBe('/utenti/[ID]/ordini-recenti');
  expect(r['https://sito-esempio.it/users/12345/change-password']).toBe('/users/[ID]/change-password');
  expect(r['https://sito-esempio.it/user/12345/edit-profile']).toBe('/user/[ID]/edit-profile');
  expect(r['https://sito-esempio.it/utente/12345/dati-personali/modifica']).toBe('/utente/[ID]/dati-personali/modifica');
  expect(r['https://banca-esempio.it/clienti/12345/estratto-conto']).toBe('/clienti/[ID]/estratto-conto');
  expect(r['https://sito-esempio.it/users/12345/two-factor']).toBe('/users/[ID]/two-factor');
});

test('e una sezione di una parola sola resta come prima', async ({ app }) => {
  const r = await ripulisci(app, [
    'https://banca-esempio.it/clienti/12345/estratto',
    'https://negozio-esempio.it/utenti/12345/fatture',
  ]);
  expect(r['https://banca-esempio.it/clienti/12345/estratto']).toBe('/clienti/[ID]/estratto');
  expect(r['https://negozio-esempio.it/utenti/12345/fatture']).toBe('/utenti/[ID]/fatture');
});

test('mentre il nome di una persona sparisce come prima, cognomi che somigliano a parole compresi', async ({ app }) => {
  const r = await ripulisci(app, [
    'https://stackoverflow.com/users/12345/mario-rossi',
    'https://portale-esempio.it/utenti/98765/rossi-mario/documenti',
    'https://www.goodreads.com/user/show/12345-mario-rossi',
    // «Piano» e «Carta» sono parole comuni e cognomi veri: fuori dalla lista di
    // proposito, o il cognome uscirebbe intero. «Di» ci sta, e dall'undicesimo
    // giro non salva niente lo stesso: dalla prima parola che una sezione non è
    // in poi resta un segnaposto, e i due nomi stanno tutti e due dopo.
    'https://forum-esempio.it/utenti/12/di-rossi-mario',
    'https://forum-esempio.it/utenti/12/renzo-piano',
    'https://forum-esempio.it/utenti/12/giuseppe-carta',
  ]);
  expect(r['https://stackoverflow.com/users/12345/mario-rossi']).toBe('/users/[ID]/[ID]');
  expect(r['https://portale-esempio.it/utenti/98765/rossi-mario/documenti']).toBe('/utenti/[ID]/[ID]/documenti');
  expect(r['https://www.goodreads.com/user/show/12345-mario-rossi']).toBe('/user/[ID]/[ID]');
  expect(r['https://forum-esempio.it/utenti/12/di-rossi-mario']).toBe('/utenti/[ID]/di-[ID]');
  expect(r['https://forum-esempio.it/utenti/12/renzo-piano']).toBe('/utenti/[ID]/[ID]');
  expect(r['https://forum-esempio.it/utenti/12/giuseppe-carta']).toBe('/utenti/[ID]/[ID]');
});

test('e in lettura vale lo stesso: il percorso arriva all’assistente col nome della sezione', async ({ app }) => {
  const blocchi = await app.evaluate(async () => {
    const S = globalThis.SN_PATHS_SAFETY;
    const uno = (initialUrl) => S.formatKnownPathsForPrompt([{
      domain: 'banca-esempio.it',
      initialUrl,
      intent: 'aprire le note spese',
      steps: [{ selector: '[aria-label="Note spese"]', action: 'click' }],
      success: true,
    }]);
    return { sezione: uno('/clienti/[ID]/note-spese'), nome: uno('/clienti/[ID]/mario-rossi') };
  });
  expect(blocchi.sezione).toContain('/clienti/[ID]/note-spese');
  // e un nome rimasto dentro un documento vecchio si ripulisce alla rilettura
  expect(blocchi.nome).toContain('/clienti/[ID]/[ID]');
  expect(blocchi.nome).not.toContain('mario-rossi');
});

test('e sul cammino vero il punto di partenza che finisce in coda dice da dove si parte', async ({ app }) => {
  const voce = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const P = globalThis.SN_PATHS;
    C._reset(); C._setAuto(false); C._setSorteggio(() => 0.5);
    const vero = P.submit;
    P.submit = async () => ({ id: 'mai' });
    await C.collectAndSave({
      session: {
        rawUrl: 'https://banca-esempio.it/clienti/12345/note-spese',
        rawSteps: [{ selector: '[aria-label="Note spese"]', action: 'click' }],
        rawUserMessages: ['dove sono le note spese?'],
        success: true,
      },
      invokeAI: async ({ action }) => (action === 'help_intent_guess'
        ? { text: 'aprire le note spese' }
        : { text: '{"ok": true}' }),
    });
    const coda = C._peek();
    P.submit = vero;
    C._reset();
    return coda[coda.length - 1] || null;
  });
  expect(voce).not.toBeNull();
  expect(voce.initialUrl).toBe('/clienti/[ID]/note-spese');
});
