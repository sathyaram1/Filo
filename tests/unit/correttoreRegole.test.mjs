// #1446 — le regole del correttore senza DOM: i candidati del codice, il pezzo nuovo da giudicare (mai la parola che si
// sta scrivendo), la risposta [pezzo][correzione][motivo][tipo] e il segno ritrovato nel testo di adesso.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/content/correttoreRegole.js');
const C = globalThis.SN_CORRETTORE;

const segnati = (testo, lista) => lista.map((s) => testo.slice(s.start, s.end));

test('le parole che il dizionario non conosce sono candidati, ma non dentro indirizzi, email, menzioni o cifre', () => {
  const sbagliate = new Set(['quseta', 'Zanzottera', 'xyz', 'abc', 'kg', 'gattino']);
  const testo = 'Ciao quseta, scrivi a mario@xyz.it o vai su https://abc.example/gattino, @Zanzottera 2kg; Zanzottera';
  const c = C.candidatiDizionario(testo, { sbagliata: (w) => sbagliate.has(w) });
  assert.deepEqual(segnati(testo, c), ['quseta', 'Zanzottera']);
  assert.equal(c[1].start, testo.lastIndexOf('Zanzottera'));
  assert.ok(c.every((x) => x.dubbio && x.segno === 'errore' && x.fonte === 'dizionario'));
  assert.deepEqual(C.candidatiDizionario(testo, { sbagliata: (w) => sbagliate.has(w), nota: (w) => w === 'quseta' }).map((x) => x.segment), ['Zanzottera']);
});

test('il dizionario riceve l\'apostrofo dritto: «l’America» si chiede come «l\'America»', () => {
  const chieste = [];
  C.candidatiDizionario('Ciao l’America', { sbagliata: (w) => { chieste.push(w); return false; } });
  assert.deepEqual(chieste, ['Ciao', "l'America"]);
});

test('«il il» e «di di» sono ripetizioni, «quasi quasi», «piano piano», «se se» e «la la la» no', () => {
  const testo = 'Ho visto il il cane, quasi quasi vado piano piano. Pensa di di andare se se ne va. La la la. And the the end';
  const r = C.ripetizioni(testo);
  assert.deepEqual(r.map((x) => x.segment), [' il', ' di', ' the']);
  assert.deepEqual(r[0].correzioni, ['']);
  const corretto = testo.slice(0, r[0].start) + r[0].correzioni[0] + testo.slice(r[0].end);
  assert.ok(corretto.startsWith('Ho visto il cane'));
  assert.deepEqual(C.ripetizioni('il\n\nil cane'), [], 'un a capo non è uno spazio fra due parole di fila');
});

test('gli errori fissi hanno la loro correzione nella forma scritta', () => {
  const testo = "Qual'è il motivo? Un pò di pazienza, PERCHÈ e' tardi. Non sò. Vieni quì";
  const f = C.erroriFissi(testo);
  assert.deepEqual(f.map((x) => [x.segment, x.correzioni[0]]), [["Qual'è", 'Qual è'], ['pò', "po'"], ['PERCHÈ', 'PERCHÉ'], ["e'", 'è'], ['quì', 'qui']]);
  assert.ok(f.every((x) => x.dubbio && x.fonte === 'fisso'));
  assert.deepEqual(C.erroriFissi('vai su www.pò.it'), []);
});

test('la parola al cursore è quella in scrittura; dopo uno spazio non c\'è', () => {
  assert.deepEqual(C.parolaAlCursore('oggi sonno', 10), { start: 5, end: 10 });
  assert.equal(C.parolaAlCursore('oggi sonno ', 11), null);
  assert.deepEqual(C.parolaAlCursore('oggi sonno andato', 7), { start: 5, end: 10 });
  assert.equal(C.parolaAlCursore('oggi', null), null);
});

test('il pezzo nuovo è a parole intere, e i soli spazi o punteggiatura non contano', () => {
  assert.deepEqual(C.regioneNuova('', 'ciao a tutti'), { start: 0, end: 12 });
  assert.deepEqual(C.regioneNuova('ciao a tutti', 'ciao a tuttissimi voi'), { start: 7, end: 21 });
  assert.equal(C.regioneNuova('ciao a tutti', 'ciao, a tutti!'), null);
  assert.deepEqual(C.regioneNuova('un amico', "un'amico"), { start: 0, end: 8 }, 'l\'apostrofo cambia le parole');
  assert.deepEqual(C.regioneNuova('alle 18', 'alle 19'), { start: 5, end: 7 }, 'una cifra cambiata è un cambio vero');
  const r = C.regioneNuova('la grande zaino', 'la zaino');
  assert.equal('la zaino'.slice(r.start, r.end), 'la zaino', 'una cancellazione porta le due parole che fa toccare');
});

test('la parola in scrittura non parte: la base la perde e il giro dopo la ritrova nuova', () => {
  const adesso = 'oggi sono andato al ma';
  const g = C.daGiudicare('', adesso, { inScrittura: C.parolaAlCursore(adesso, adesso.length) });
  assert.equal(adesso.slice(g.start, g.end).trim(), 'oggi sono andato al');
  const dopo = 'oggi sono andato al mare con Luca';
  const g2 = C.daGiudicare(g.base, dopo, { inScrittura: C.parolaAlCursore(dopo, dopo.length) });
  assert.equal(dopo.slice(g2.start, g2.end).trim(), 'mare con');
  assert.equal(C.daGiudicare('', 'quset', { inScrittura: { start: 0, end: 5 } }), null, 'solo la parola in scrittura: niente');
});

test('un testo lunghissimo si giudica a tratti: il resto resta nuovo per il giro dopo', () => {
  const testo = 'parola '.repeat(3000);
  const g = C.daGiudicare('', testo, { max: 1000 });
  assert.ok(g.end - g.start <= 1000);
  assert.ok(/\s$/.test(testo.slice(0, g.end)) || !/\p{L}/u.test(testo[g.end]), 'il taglio non spezza una parola');
  const g2 = C.daGiudicare(g.base, testo, { max: 1000 });
  assert.equal(g2.start, g.end);
});

test('a fine frase il controllo ragionato giudica le frasi chiuse, non quella aperta', () => {
  const testo = 'Ci vediamo martedì. Porto io i biglietti. E poi andiamo';
  const g = C.frasiDaGiudicare('', testo, { finoA: C.ultimaFineFrase(testo, testo.length) });
  assert.equal(testo.slice(g.start, g.end), 'Ci vediamo martedì. Porto io i biglietti.');
  const g2 = C.frasiDaGiudicare(g.base, testo + ' al cinema.', {});
  assert.equal((testo + ' al cinema.').slice(g2.start, g2.end), 'E poi andiamo al cinema.');
});

test('la risposta riga per riga: il pezzo si ritrova una volta sola e il segno sta su ciò che cambia', () => {
  const testo = 'oggi sonno andato al mare con la zaino';
  const raw = '```\n[oggi sonno andato][oggi sono andato][verbo essere][errore]\n[la zaino][lo zaino][zaino è maschile][errore]\n[al][al][niente][errore]\ntesto a caso\n```';
  const { segni } = C.segniDaRisposta(raw, testo);
  assert.deepEqual(segni.map((s) => [s.segment, s.correzioni[0]]), [['sonno', 'sono'], ['la', 'lo']]);
  assert.equal(segni[0].motivo, 'verbo essere');
  assert.ok(segni.every((s) => !s.dubbio && s.segno === 'errore'));
});

test('un pezzo che compare due volte, o che non c\'è più, si scarta', () => {
  const testo = 'sonno e sonno';
  assert.deepEqual(C.segniDaRisposta('[sonno][sono][x][errore]', testo).segni, []);
  assert.deepEqual(C.segniDaRisposta('[quseta][questa][x][errore]', 'ciao').segni, []);
  assert.deepEqual(segnati(testo, C.segniDaRisposta('[e sonno][e sono][x][errore]', testo).segni), ['sonno']);
  assert.equal(C.segniDaRisposta('[e sonno][e sono][x][errore]', testo).segni[0].start, 8);
});

test('una risposta arrivata dopo un cambio si posa sul pezzo giusto nel testo nuovo', () => {
  const adesso = 'Allora, oggi quseta sera esco';
  const { segni } = C.segniDaRisposta('[quseta][questa][refuso][errore]', adesso);
  assert.equal(segni[0].start, adesso.indexOf('quseta'));
});

test('«giusto» scarta un candidato; la parola in scrittura non si segna mai', () => {
  const testo = 'Ho visto Zanzottera e quset';
  const r = C.segniDaRisposta('[Zanzottera][][cognome][giusto]\n[quset][questo][refuso][errore]', testo, { inScrittura: { start: 22, end: 27 } });
  assert.deepEqual(r.giusti, [{ start: 9, end: 19 }]);
  assert.deepEqual(r.segni, []);
});

test('i tipi che un controllo non dà si ignorano; una contraddizione vale solo con la prova nella pagina', () => {
  const testo = 'sì, ci vediamo mercoledì alle 18';
  const raw = '[mercoledì][martedì][si era detto martedì][contraddizione][ci vediamo martedì?]\n[alle 18][][orario][suggerimento]\n[sì][][x][errore]';
  const nessuna = C.segniDaRisposta(raw, testo, { tipi: ['suggerimento', 'contraddizione'], citata: () => false });
  assert.deepEqual(nessuna.segni.map((s) => s.segment), ['alle 18']);
  const con = C.segniDaRisposta(raw, testo, { tipi: ['suggerimento', 'contraddizione'], citata: (c) => c === 'ci vediamo martedì?' });
  assert.deepEqual(con.segni.map((s) => [s.segment, s.segno, s.citazione]), [['mercoledì', 'suggerimento', 'ci vediamo martedì?'], ['alle 18', 'suggerimento', '']]);
});

test('le virgolette tipografiche del modello ritrovano quelle dritte del testo, alla stessa posizione', () => {
  const testo = "Dov'e il libro";
  const { segni } = C.segniDaRisposta("[Dov’e][Dov’è][accento][errore]", testo);
  assert.deepEqual(segni.map((s) => [s.segment, s.correzioni[0]]), [["Dov'e", 'Dov’è']]);
});
