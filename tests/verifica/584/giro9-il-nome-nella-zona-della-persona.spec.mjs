// #584, nono giro — RILIEVO: dentro la zona della persona il nome esce lo
// stesso, se non è scritto in inglese.
//
// L'ottavo giro ha aperto una «zona della persona»: dopo `/utenti/`, `/user/`,
// `/clienti/` il pezzo che segue diventa un segnaposto, e per due pezzi ancora
// un pezzo che ha la FORMA di un nome per esteso diventa anche lui un
// segnaposto. `/users/12345/mario-rossi` esce `/users/[ID]/[ID]`.
//
// La forma però è scritta con le sole ventisei lettere dell'alfabeto inglese, e
// vuole che il pezzo finisca con una parola di lettere. Quindi `niccolò-rossi`,
// `josé-garcía` e `mario-rossi-1980` — tre forme comunissime nella stessa
// identica posizione, sullo stesso identico sito — escono interi, mentre
// `mario-rossi` sparisce.
//
// Le prove fissano il comportamento di OGGI e sono marcate RILIEVO: quando la
// zona della persona imparerà le lettere accentate e i nomi con l'anno in coda,
// diventeranno rosse, ed è chi corregge a doverne aggiornare l'attesa.

import { test, expect } from '../../fixtures/electron.mjs';

async function ripulisci(app, urls) {
  return app.evaluate(async ({ app: _a }, { urls }) => {
    const S = globalThis.SN_PATHS_SAFETY;
    const out = {};
    for (const u of urls) out[u] = S._internal.normalizedPath(u);
    return out;
  }, { urls });
}

test('RILIEVO: un nome con una lettera accentata resta nell’indirizzo pubblicato', async ({ app }) => {
  const r = await ripulisci(app, [
    'https://forum-esempio.it/utenti/12345/niccolò-rossi',
    'https://foro-ejemplo.es/usuarios/999/josé-garcía',
  ]);
  // Il pezzo col numero sparisce, quello col nome no.
  expect(r['https://forum-esempio.it/utenti/12345/niccolò-rossi']).toBe('/utenti/[ID]/niccolò-rossi');
  expect(r['https://foro-ejemplo.es/usuarios/999/josé-garcía']).toBe('/usuarios/[ID]/josé-garcía');
});

test('RILIEVO: e un nome con l’anno di nascita in coda, che è la forma di mezzo mondo dei forum', async ({ app }) => {
  const r = await ripulisci(app, [
    'https://forum-esempio.it/utenti/12345/mario-rossi-1980',
    'https://forum-esempio.it/user/98765/rossi.mario.85',
  ]);
  expect(r['https://forum-esempio.it/utenti/12345/mario-rossi-1980']).toBe('/utenti/[ID]/mario-rossi-1980');
  expect(r['https://forum-esempio.it/user/98765/rossi.mario.85']).toBe('/user/[ID]/rossi.mario.85');
});

test('mentre la porta che l’ottavo giro ha chiuso regge: il nome in lettere inglesi sparisce', async ({ app }) => {
  const r = await ripulisci(app, [
    'https://stackoverflow.com/users/12345/mario-rossi',
    'https://portale-esempio.it/utenti/98765/rossi-mario/documenti',
    'https://www.ebay.it/usr/mariorossi',
  ]);
  expect(r['https://stackoverflow.com/users/12345/mario-rossi']).toBe('/users/[ID]/[ID]');
  expect(r['https://portale-esempio.it/utenti/98765/rossi-mario/documenti']).toBe('/utenti/[ID]/[ID]/documenti');
  expect(r['https://www.ebay.it/usr/mariorossi']).toBe('/usr/[ID]');
});

test('RILIEVO: e sul cammino vero il nome accentato arriva fino alla coda di partenza', async ({ app }) => {
  const voce = await app.evaluate(async () => {
    const C = globalThis.SN_PATHS_COLLECTOR;
    const P = globalThis.SN_PATHS;
    C._reset(); C._setAuto(false); C._setSorteggio(() => 0.5);
    const vero = P.submit;
    P.submit = async () => ({ id: 'mai' });
    await C.collectAndSave({
      session: {
        rawUrl: 'https://forum-esempio.it/utenti/12345/niccolò-rossi/messaggi',
        rawSteps: [{ selector: '[aria-label="Messaggi"]', action: 'click' }],
        rawUserMessages: ['dove sono i messaggi?'],
        success: true,
      },
      invokeAI: async ({ action }) => (action === 'help_intent_guess'
        ? { text: 'aprire i messaggi del profilo' }
        : { text: '{"ok": true}' }),
    });
    const coda = C._peek();
    P.submit = vero;
    C._reset();
    return coda[coda.length - 1] || null;
  });
  expect(voce).not.toBeNull();
  expect(voce.initialUrl).toContain('niccolò-rossi');
});
