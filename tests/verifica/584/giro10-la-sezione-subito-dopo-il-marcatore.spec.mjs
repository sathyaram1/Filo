// #584, decimo giro — RILIEVO: il pezzo SUBITO DOPO la parola che annuncia una
// persona diventa un segnaposto comunque, anche quando è il nome di una
// sezione.
//
// È lo stesso danno del quinto giro («un indirizzo ridotto a /[ID] non dice più
// da che punto del sito si parte, che è l'unica cosa per cui chi riusa un
// percorso lo legge») e del nono («la sezione mangiata dalla zona della
// persona»), una posizione più indietro.
//
// Il nono giro ha insegnato alla pulizia a guardare le PAROLE del pezzo e non
// solo la sua forma — ma solo DENTRO la zona, cioè dal secondo pezzo dopo il
// marcatore in poi. Il primo pezzo dopo il marcatore non passa da nessun
// controllo: è `[ID]` e basta. E `/utente/ordini`, `/profilo/impostazioni`,
// `/user/settings` sono la forma più comune che un'area personale abbia.
//
// La regola gemella, quella dei siti col nome in testa, una lista ce l'ha già:
// `github.com/notifications` resta leggibile perché `notifications` è una
// sezione pubblica. Le due strade decidono la stessa cosa e una sola guarda.
//
// AGGIORNATE DALL'UNDICESIMO GIRO. La correzione ha chiuso questa porta
// insieme all'altra: adesso anche il primo pezzo dopo il marcatore passa dalla
// stessa regola, cioè tiene le parole da sezione finché ne trova e diventa un
// segnaposto dalla prima parola che non lo è. `/utente/ordini` resta leggibile,
// `/user/mariorossi` no. Le attese qui sotto sono quelle nuove; restano
// marcate RILIEVO solo quelle ancora aperte, cioè le sezioni comuni che nella
// lista delle parole non ci sono.

import { test, expect } from '../../fixtures/electron.mjs';

async function ripulisci(app, urls) {
  return app.evaluate(async ({ app: _a }, { urls }) => {
    const S = globalThis.SN_PATHS_SAFETY;
    const out = {};
    for (const u of urls) out[u] = S._internal.normalizedPath(u);
    return out;
  }, { urls });
}

test('la sezione subito dopo il marcatore resta, e sono le pagine più comuni di un\'area personale', async ({ app }) => {
  const casi = {
    'https://sito-esempio.it/utente/ordini': '/utente/ordini',
    'https://sito-esempio.it/utente/preferiti': '/utente/preferiti',
    'https://sito-esempio.it/utente/impostazioni': '/utente/impostazioni',
    'https://sito-esempio.it/profilo/impostazioni': '/profilo/impostazioni',
    'https://sito-esempio.it/profilo/notifiche': '/profilo/notifiche',
    'https://sito-esempio.it/user/settings': '/user/settings',
    'https://sito-esempio.it/user/orders': '/user/orders',
    'https://sito-esempio.it/profile/edit': '/profile/edit',
    'https://sito-esempio.it/clienti/fatture': '/clienti/fatture',
    'https://sito-esempio.it/clienti/documenti': '/clienti/documenti',
    'https://sito-esempio.it/customer/orders': '/customer/orders',
    'https://sito-esempio.it/users/settings/security': '/users/settings/security',
    // «registrazione» nella lista delle parole non c'è: resta un segnaposto,
    // ed è il residuo aperto qui sotto.
    'https://sito-esempio.it/utenti/registrazione': '/utenti/[ID]',
  };
  const r = await ripulisci(app, Object.keys(casi));
  for (const [u, atteso] of Object.entries(casi)) expect(`${u} -> ${r[u]}`).toBe(`${u} -> ${atteso}`);
});

test('e un nome di persona in quella stessa posizione sparisce come prima', async ({ app }) => {
  const casi = {
    'https://sito-esempio.it/user/mariorossi': '/user/[ID]',
    'https://ebay-esempio.it/usr/mariorossi': '/usr/[ID]',
    'https://sito-esempio.it/in/mario-rossi': '/in/[ID]',
    'https://sito-esempio.it/clienti/12345': '/clienti/[ID]',
    'https://sito-esempio.it/user/mariorossi.html': '/user/[ID]',
  };
  const r = await ripulisci(app, Object.keys(casi));
  for (const [u, atteso] of Object.entries(casi)) expect(`${u} -> ${r[u]}`).toBe(`${u} -> ${atteso}`);
});

test('due punti di partenza diversi dello stesso sito non arrivano più uguali all\'assistente', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const S = globalThis.SN_PATHS_SAFETY;
    const uno = S._internal.normalizedPath('https://sito-esempio.it/utente/ordini');
    const due = S._internal.normalizedPath('https://sito-esempio.it/utente/preferiti');
    const blocco = S.formatKnownPathsForPrompt([
      { domain: 'sito-esempio.it', initialUrl: uno, intent: 'vedere gli ordini', steps: [{ selector: 'a', action: 'click' }], success: true },
      { domain: 'sito-esempio.it', initialUrl: due, intent: 'togliere un preferito', steps: [{ selector: 'b', action: 'click' }], success: true },
    ]);
    return { uno, due, blocco };
  });
  expect(r.uno).toBe('/utente/ordini');
  expect(r.due).toBe('/utente/preferiti');
  expect(r.blocco).toContain('(da /utente/ordini)');
  expect(r.blocco).toContain('(da /utente/preferiti)');
});

test('mentre la regola gemella, quella dei siti col nome in testa, la sezione la riconosce', async ({ app }) => {
  const r = await ripulisci(app, [
    'https://github.com/notifications',
    'https://instagram.com/explore',
    'https://github.com/mariorossi',
  ]);
  expect(r['https://github.com/notifications']).toBe('/notifications');
  expect(r['https://instagram.com/explore']).toBe('/explore');
  // E il nome di una persona sparisce lo stesso: la lista non apre nessuna porta.
  expect(r['https://github.com/mariorossi']).toBe('/[ID]');
});

test('RILIEVO: e dentro la zona restano fuori dalla lista sezioni comuni quanto quelle che ci sono entrate', async ({ app }) => {
  const casi = {
    'https://banca-esempio.it/clienti/12345/carta-fedelta': '/clienti/[ID]/[ID]',
    'https://banca-esempio.it/clienti/12345/note-legali': '/clienti/[ID]/note-[ID]',
    'https://energia-esempio.it/clienti/12345/auto-lettura': '/clienti/[ID]/[ID]',
    'https://tel-esempio.it/clienti/12345/piano-tariffario': '/clienti/[ID]/[ID]',
    'https://sito-esempio.it/clienti/12345/prenota-appuntamento': '/clienti/[ID]/[ID]',
    'https://sito-esempio.it/utenti/123/stato-richiesta': '/utenti/[ID]/[ID]',
  };
  const r = await ripulisci(app, Object.keys(casi));
  for (const [u, atteso] of Object.entries(casi)) expect(`${u} -> ${r[u]}`).toBe(`${u} -> ${atteso}`);
});

test('e il nome di una persona, dove la correzione del nono giro lo toglieva, continua a sparire', async ({ app }) => {
  const casi = {
    'https://sito-esempio.it/users/12345/mario-rossi': '/users/[ID]/[ID]',
    'https://sito-esempio.it/utenti/12345/rossi-mario/documenti': '/utenti/[ID]/[ID]/documenti',
    'https://banca-esempio.it/clienti/12345/note-spese': '/clienti/[ID]/note-spese',
    'https://sito-esempio.it/users/12345/change-password': '/users/[ID]/change-password',
  };
  const r = await ripulisci(app, Object.keys(casi));
  for (const [u, atteso] of Object.entries(casi)) expect(`${u} -> ${r[u]}`).toBe(`${u} -> ${atteso}`);
});

test('e in lettura vale lo stesso, sui percorsi già pubblicati', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const S = globalThis.SN_PATHS_SAFETY;
    // Un documento che nella raccolta è scritto per intero (l'ha messo lì una
    // versione precedente della pulizia): chi lo rilegge lo ripulisce di nuovo.
    return {
      letto: S._internal.sanitizeInitialUrl('/utente/ordini', 'sito-esempio.it'),
      leggeIlBlocco: S.formatKnownPathsForPrompt([
        { domain: 'sito-esempio.it', initialUrl: '/utente/ordini', intent: 'vedere gli ordini', steps: [{ selector: 'a', action: 'click' }], success: true },
      ]),
    };
  });
  expect(r.letto).toBe('/utente/ordini');
  expect(r.leggeIlBlocco).toContain('(da /utente/ordini)');
});
