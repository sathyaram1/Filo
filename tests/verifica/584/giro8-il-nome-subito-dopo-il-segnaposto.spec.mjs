// #584, ottavo giro — il nome di persona che sta UN PEZZO PIÙ IN LÀ.
//
// La pulizia dell'indirizzo sa già riconoscere che un pezzo annuncia una
// persona: dopo `/user/`, `/utente/`, `/clienti/`, `/in/` il pezzo che segue
// diventa un segnaposto. Quello che non faceva è guardare il pezzo DOPO ANCORA,
// ed è lì che moltissimi siti mettono il nome scritto a lettere della stessa
// persona che ha appena reso segnaposto: `/users/12345/mario-rossi`.
//
// Era la stessa regola del terzo giro applicata a metà: il codice SA che lì c'è
// una persona (il marcatore è scattato) e ripuliva un pezzo solo. Un nome utente
// è spesso lo stesso su più siti, ed è la ricucitura che questo lavoro è andato
// a chiudere.
//
// GIRATE dopo la correzione di questo stesso giro: adesso dopo il marcatore si
// resta in una zona della persona lunga due pezzi, e dentro quella zona un pezzo
// che ha la forma di un nome per esteso diventa anche lui un segnaposto. Fuori
// dalla zona, e per le parole singole tutte minuscole, non cambia niente: la
// correzione non doveva ripulire di più del necessario (quinto giro).

import { test, expect } from '../../fixtures/electron.mjs';

async function ripulisci(app, urls) {
  return app.evaluate(async ({ app: _a }, { urls }) => {
    const S = globalThis.SN_PATHS_SAFETY;
    const out = {};
    for (const u of urls) out[u] = S._internal.normalizedPath(u);
    return out;
  }, { urls });
}

test('dopo il segnaposto della persona sparisce anche il suo nome scritto a lettere', async ({ app }) => {
  const r = await ripulisci(app, [
    // la forma di Stack Overflow e di mezzo mondo dei forum: id + nome
    'https://stackoverflow.com/users/12345/mario-rossi',
    // stessa cosa con la parola italiana fra i marcatori
    'https://portale.it/utenti/98765/rossi-mario/documenti',
    // e con il nome nello stesso pezzo del numero
    'https://www.goodreads.com/user/show/12345-mario-rossi',
  ]);
  expect(r['https://stackoverflow.com/users/12345/mario-rossi']).toBe('/users/[ID]/[ID]');
  // e la sezione dopo il nome resta, perché dice in che punto del sito si parte
  expect(r['https://portale.it/utenti/98765/rossi-mario/documenti']).toBe('/utenti/[ID]/[ID]/documenti');
  expect(r['https://www.goodreads.com/user/show/12345-mario-rossi']).toBe('/user/[ID]/[ID]');
});

test('«usr», la forma abbreviata che usano i grandi negozi, adesso è fra i marcatori', async ({ app }) => {
  const r = await ripulisci(app, ['https://www.ebay.it/usr/mariorossi']);
  expect(r['https://www.ebay.it/usr/mariorossi']).toBe('/usr/[ID]');
});

test('il soprannome con la chiocciola sparisce nell\'indirizzo E nell\'etichetta del pulsante', async ({ app }) => {
  const r = await app.evaluate(async () => {
    const S = globalThis.SN_PATHS_SAFETY;
    return {
      indirizzo: S._internal.normalizedPath('https://www.youtube.com/@mariorossi/video'),
      etichetta: S._internal.redactSelector('[aria-label="Profilo di @mariorossi"]'),
      // e un nome di classe con la chiocciola protetta non è un soprannome
      classe: S._internal.redactSelector('.\\@sm\\:flex > button'),
    };
  });
  expect(r.indirizzo).toBe('/[ID]/video');
  expect(r.etichetta).toBe('[aria-label="Profilo di [ID]"]');
  expect(r.classe).toBe('.\\@sm\\:flex > button');
});

test('la zona della persona si chiude subito: quello che non è un nome resta', async ({ app }) => {
  const r = await ripulisci(app, [
    // «comments» non ha la forma di un nome: resta, e con lui quello che segue
    'https://www.reddit.com/user/mariorossi/comments/abc',
    'https://sito.it/u/mario.rossi/ordini/847362',
  ]);
  expect(r['https://www.reddit.com/user/mariorossi/comments/abc']).toBe('/user/[ID]/comments/abc');
  expect(r['https://sito.it/u/mario.rossi/ordini/847362']).toBe('/u/[ID]/ordini/[NUMERO]');
});

test('mentre la porta che il terzo giro ha chiuso regge: il pezzo subito dopo il marcatore sparisce', async ({ app }) => {
  const r = await ripulisci(app, [
    'https://it.linkedin.com/in/mario-rossi-12345',
    'https://banca.it/clienti/rossi-mario/estratto',
    'https://github.com/mariorossi/progetto',
  ]);
  expect(r['https://it.linkedin.com/in/mario-rossi-12345']).toBe('/in/[ID]');
  expect(r['https://banca.it/clienti/rossi-mario/estratto']).toBe('/clienti/[ID]/estratto');
  expect(r['https://github.com/mariorossi/progetto']).toBe('/[ID]/progetto');
});

test('e la correzione del quinto giro tiene: quello che non dice chi sei resta leggibile', async ({ app }) => {
  const r = await ripulisci(app, [
    'https://github.com/notifications',
    'https://www.comune.milano.it/servizi/carta-identita.html',
    'https://app.esempio.it/v2/user_settings',
    'https://negozio.it/c/scarpe-donna',
    'https://www.subito.it/annunci-lombardia/vendita/usato/',
    'https://www.trenitalia.com/it/biglietti.html',
  ]);
  expect(r['https://github.com/notifications']).toBe('/notifications');
  expect(r['https://www.comune.milano.it/servizi/carta-identita.html']).toBe('/servizi/carta-identita.html');
  expect(r['https://app.esempio.it/v2/user_settings']).toBe('/v2/user_settings');
  expect(r['https://negozio.it/c/scarpe-donna']).toBe('/c/scarpe-donna');
  expect(r['https://www.subito.it/annunci-lombardia/vendita/usato/']).toBe('/annunci-lombardia/vendita/usato/');
  expect(r['https://www.trenitalia.com/it/biglietti.html']).toBe('/it/biglietti.html');
});
