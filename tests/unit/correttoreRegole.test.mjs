// #1446 e #1580 — le regole del correttore senza DOM: i candidati del codice (pieni i sicuri, in attesa del modello le
// parole maiuscole o in altri alfabeti), il pezzo nuovo da giudicare (mai la parola che si sta scrivendo), il campo
// intero per il ragionato, la risposta [pezzo][correzione][motivo][tipo] letta con tolleranza e ritrovata nel testo.

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
  assert.ok(c.every((x) => x.dubbio && !x.certo && x.segno === 'errore' && x.fonte === 'dizionario'));
  assert.deepEqual(C.candidatiDizionario(testo, { sbagliata: (w) => sbagliate.has(w), nota: (w) => w === 'quseta' }).map((x) => x.segment), ['Zanzottera']);
});

test('sbiadito subito solo sulle parole minuscole in alfabeto latino; maiuscole e altri alfabeti aspettano il modello', () => {
  const testo = 'quseta Roma NASA iPhone perchéé Москва καλημέρα l’amerika èèè';
  const c = C.candidatiDizionario(testo, { sbagliata: () => true });
  const attende = Object.fromEntries(c.map((x) => [x.segment, !!x.attende]));
  assert.deepEqual(attende, {
    quseta: false, Roma: true, NASA: true, iPhone: true, perchéé: false, Москва: true, καλημέρα: true, 'l’amerika': false, èèè: false,
  });
  assert.ok(c.every((x) => x.dubbio), 'tutti partono verso il modello come candidati');
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
  assert.ok(r.every((x) => !x.dubbio && x.certo), 'una ripetizione ha il segno pieno subito (#1580, D5)');
  const corretto = testo.slice(0, r[0].start) + r[0].correzioni[0] + testo.slice(r[0].end);
  assert.ok(corretto.startsWith('Ho visto il cane'));
  assert.deepEqual(C.ripetizioni('il\n\nil cane'), [], 'un a capo non è uno spazio fra due parole di fila');
});

test('gli errori fissi hanno la loro correzione nella forma scritta', () => {
  const testo = "Qual'è il motivo? Un pò di pazienza, PERCHÈ e' tardi. Non sò. Vieni quì";
  const f = C.erroriFissi(testo);
  assert.deepEqual(f.map((x) => [x.segment, x.correzioni[0]]), [["Qual'è", 'Qual è'], ['pò', "po'"], ['PERCHÈ', 'PERCHÉ'], ["e'", 'è'], ['quì', 'qui']]);
  assert.ok(f.every((x) => !x.dubbio && x.certo && x.fonte === 'fisso'), 'un errore fisso ha il segno pieno subito (#1580, D5)');
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

test('il ragionato rilegge il campo intero; a fine frase le sole frasi chiuse, e la frase aperta resta al giro dopo', () => {
  const testo = 'Ci vediamo martedì. Porto io i biglietti. E poi andiamo';
  const g = C.testoDaRileggere('', testo, { finoA: C.ultimaFineFrase(testo, testo.length) });
  assert.equal(testo.slice(g.start, g.end), 'Ci vediamo martedì. Porto io i biglietti.');
  const dopo = `${testo} al cinema.`;
  const g2 = C.testoDaRileggere(g.base, dopo, {});
  assert.equal(dopo.slice(g2.start, g2.end), dopo, 'il giro dopo rilegge tutto, non solo la frase nuova');
  assert.equal(dopo.slice(g2.nuovo.start, g2.nuovo.end).trim(), 'E poi andiamo al cinema.', 'il testo nuovo resta noto');
  assert.equal(C.testoDaRileggere(g2.base, dopo, {}), null, 'niente di cambiato, niente da rileggere');
  assert.equal(C.testoDaRileggere('', 'Ancora niente di chiuso', { finoA: 0 }), null);
});

test('oltre 12.000 caratteri il ragionato rilegge l\'ultima parte, o quella che comincia col cambio se sta tutto prima', () => {
  const frase = 'Questa è una frase di prova. ';
  const testo = frase.repeat(1000);
  const g = C.testoDaRileggere('', testo, {});
  assert.ok(g.end - g.start <= C.TESTO_INTERO_MAX && g.end - g.start > C.TESTO_INTERO_MAX - 100);
  assert.equal(g.end, testo.length, 'un testo incollato intero: l\'ultima parte');
  assert.ok(!(/\p{L}/u.test(testo[g.start - 1]) && /\p{L}/u.test(testo[g.start])), 'il taglio non spezza una parola');
  const cambiato = `Questa è una frasse di prova. ${testo.slice(frase.length)}`;
  const g2 = C.testoDaRileggere(testo, cambiato, {});
  assert.equal(g2.start, 0, 'il cambio all\'inizio di un testo lungo si rilegge');
  assert.ok(g2.end - g2.start <= C.TESTO_INTERO_MAX);
});

test('la risposta riga per riga: il pezzo si ritrova una volta sola e il segno sta su ciò che cambia', () => {
  const testo = 'oggi sonno andato al mare con la zaino';
  const raw = '```\n[oggi sonno andato][oggi sono andato][verbo essere][errore]\n[la zaino][lo zaino][zaino è maschile][errore]\n[al][al][niente][errore]\ntesto a caso\n```';
  const { segni } = C.segniDaRisposta(raw, testo);
  assert.deepEqual(segni.map((s) => [s.segment, s.correzioni[0]]), [['sonno', 'sono'], ['la', 'lo']]);
  assert.equal(segni[0].motivo, 'verbo essere');
  assert.ok(segni.every((s) => !s.dubbio && s.segno === 'errore'));
});

test('una riga a tre campi vale errore; se il terzo è un tipo, è il motivo che manca', () => {
  const testo = 'oggi sonno andato con Zanzottera';
  const r = C.segniDaRisposta('[oggi sonno andato][oggi sono andato][verbo essere]\n[Zanzottera][][giusto]', testo);
  assert.deepEqual(r.segni.map((s) => [s.segment, s.correzioni[0], s.segno, s.motivo]), [['sonno', 'sono', 'errore', 'verbo essere']]);
  assert.deepEqual(r.giusti, [{ start: 22, end: 32 }]);
  const ragionato = C.segniDaRisposta('[sonno andato][][frase rotta]', testo, { tipi: ['errore', 'suggerimento'], senzaTipo: 'suggerimento' });
  assert.deepEqual(ragionato.segni.map((s) => [s.segment, s.segno]), [['sonno andato', 'suggerimento']]);
  assert.deepEqual(C.leggiRighe('[][][nessuno]').map((x) => x.tipo), ['nessuno']);
});

test('il pezzo si ritrova a meno di spazi multipli e di apostrofi dritti o curvi, e il segno sta sulla parola giusta', () => {
  const testo = 'Ieri  sonno   andato da un’amika';
  const { segni } = C.segniDaRisposta("[Ieri sonno andato][Ieri sono andato][verbo][errore]\n[un'amika][un'amica][refuso][errore]", testo);
  assert.deepEqual(segni.map((s) => [s.segment, s.correzioni[0]]), [['sonno', 'sono'], ['un’amika', "un'amica"]]);
  assert.equal(segni[0].start, testo.indexOf('sonno'));
});

// Quello che fa «Correggi» su ogni errore della risposta: il pezzo segnato prende la prima correzione.
const corretto = (testo, raw) => C.segniDaRisposta(raw, testo).segni.filter((s) => s.segno === 'errore' && s.correzioni.length)
  .reduceRight((t, s) => t.slice(0, s.start) + s.correzioni[0] + t.slice(s.end), testo);

test('una correzione che cambia solo spazi o apostrofi non è un errore, e nessuna correzione ristretta cancella parole', () => {
  const spazi = "[l'altro  giorno][l'altro giorno][spazio doppio][errore]";
  for (const testo of ["ieri l'altro  giorno ho visto Marco", "ieri l'altro giorno ho visto Marco"]) {
    assert.deepEqual(C.segniDaRisposta(spazi, testo).segni, [], testo);
  }
  assert.deepEqual(C.segniDaRisposta("[l’altro giorno][l'altro giorno][apostrofo][errore]", "ieri l'altro giorno").segni, []);
  // Ristretta ai soli spazi, la correzione vale per il pezzo intero: «a  b» diventa «a x b», non «x».
  assert.equal(corretto('a  b c', '[a  b][a x b][manca x][errore]'), 'a x b c');
  assert.equal(corretto('io penso dire di sì', '[penso dire][penso di dire][manca «di»][errore]'), 'io penso di dire di sì');
});

test('un pezzo ripetuto vale nell\'occorrenza che tocca il testo nuovo di quella chiamata', () => {
  const testo = 'ho sonno, ma oggi sonno andato al mare';
  const nuovo = { start: testo.indexOf('oggi'), end: testo.length };
  const { segni } = C.segniDaRisposta('[sonno][sono][verbo essere][errore]', testo, { nuovo });
  assert.deepEqual(segni.map((s) => s.start), [testo.lastIndexOf('sonno')]);
  assert.deepEqual(C.segniDaRisposta('[sonno][sono][x][errore]', 'sonno e sonno', { nuovo: { start: 0, end: 13 } }).segni, [],
    'due occorrenze nel testo nuovo: non si sa quale');
  assert.deepEqual(C.segniDaRisposta('[sono][x][y][errore]', 'persono sono', {}).segni.map((s) => s.start), [8], 'a parole intere');
});

test('si ripete solo una risposta senza righe leggibili che non dice «nessuno»', () => {
  assert.equal(C.senzaRighe(''), true);
  assert.equal(C.senzaRighe('Ecco gli errori che ho trovato:'), true);
  assert.equal(C.senzaRighe('[][][][nessuno]'), false);
  assert.equal(C.senzaRighe('Nessun errore.'), false);
  assert.equal(C.senzaRighe('NIENTE'), false, 'la risposta vuota del prompt del banco');
  assert.equal(C.senzaRighe('[sonno][sono][verbo]'), false);
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
