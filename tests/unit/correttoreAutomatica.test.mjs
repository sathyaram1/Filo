// #1447 — la correzione automatica a fine parola senza DOM: quando una parola è finita, cosa si corregge (errori fissi,
// correzioni dell'utente, maiuscola di nomi e marchi), dove si scrive tutto minuscolo apposta, e cosa Filo impara dai
// rifiuti senza imparare mai gli errori su parole vere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
for (const m of ['tabColor', 'constants', 'contenutoEsterno', 'preferences', 'themeTokens']) require(`../../src/shared/${m}.js`);
require('../../src/content/correttoreRegole.js');
require('../../src/content/correttoreAutomatica.js');
const A = globalThis.SN_CORRETTORE_AUTO;
const R = globalThis.SN_CORRETTORE;

const nomeDi = (p) => A.formaDelNome(p);
// La correzione che scatta dopo aver battuto l'ultimo carattere di `testo`, come il campo la vede.
function battuto(testo, opz = {}) {
  const fine = A.fineDellaParola(testo, testo.length);
  if (fine < 0) return null;
  const c = A.correzioneAFineParola(testo, fine, { nomeDi, ...opz });
  return c && { prima: c.originale, dopo: c.corretta, fonte: c.fonte };
}

test('gli errori fissi si correggono allo spazio e alla punteggiatura, nella forma in cui sono scritti', () => {
  assert.deepEqual(battuto('ok perchè '), { prima: 'perchè', dopo: 'perché', fonte: 'fisso' });
  assert.deepEqual(battuto('Perchè,'), { prima: 'Perchè', dopo: 'Perché', fonte: 'fisso' });
  assert.deepEqual(battuto('un pò\n'), { prima: 'pò', dopo: "po'", fonte: 'fisso' });
  assert.deepEqual(battuto("qual'è "), { prima: "qual'è", dopo: 'qual è', fonte: 'fisso' });
  assert.deepEqual(battuto('qual’è?'), { prima: 'qual’è', dopo: 'qual è', fonte: 'fisso' });
  assert.deepEqual(battuto("lui e' "), { prima: "e'", dopo: 'è', fonte: 'fisso' });
  assert.deepEqual(battuto('PERCHÈ!'), { prima: 'PERCHÈ', dopo: 'PERCHÉ', fonte: 'fisso' });
});

test('solo la parola appena chiusa: mentre la si scrive, dopo la virgola già passata o dentro un indirizzo no', () => {
  assert.equal(battuto('perchè'), null);
  assert.equal(battuto('perchè, '), null, 'la virgola l\'ha già chiusa');
  assert.equal(battuto('ok '), null);
  for (const t of ['vai su google.com ', 'scrivi a marco@posta.it ', 'ore 10:30 ', 'apri marco.txt ', '@marco ', '#marco ', 'c:\\marco ']) {
    assert.equal(battuto(t), null, t);
  }
});

test('punto e due punti aspettano lo spazio: «marco.» potrebbe essere l\'inizio di «marco.txt»', () => {
  assert.equal(A.fineDellaParola('ciao marco.', 11), -1);
  assert.deepEqual(battuto('ciao marco. '), { prima: 'marco', dopo: 'Marco', fonte: 'nome' });
  assert.deepEqual(battuto('ciao marco: '), { prima: 'marco', dopo: 'Marco', fonte: 'nome' });
});

test('nomi e marchi prendono la loro forma solo scritti tutti minuscoli', () => {
  assert.deepEqual(battuto('esco con marco '), { prima: 'marco', dopo: 'Marco', fonte: 'nome' });
  assert.deepEqual(battuto('chiedo a claude '), { prima: 'claude', dopo: 'Claude', fonte: 'nome' });
  assert.deepEqual(battuto('lavora in anthropic!'), { prima: 'anthropic', dopo: 'Anthropic', fonte: 'nome' });
  assert.deepEqual(battuto('il mio iphone '), { prima: 'iphone', dopo: 'iPhone', fonte: 'nome' });
  assert.equal(battuto('esco con Marco '), null);
  assert.equal(battuto('esco con MARCO '), null);
  // Parole comuni che sono anche nomi: la minuscola può essere giusta.
  for (const p of ['rosa', 'chiara', 'massimo', 'sara', 'apple', 'windows', 'android', 'lei', 'stato']) {
    assert.equal(battuto(`una ${p} `), null, p);
  }
});

test('i nomi dell\'utente e quelli che il dizionario conosce solo con la maiuscola', () => {
  const personali = new Map([['zanzottera', 'Zanzottera'], ['ciuruglio', 'ciuruglio'], ['nasa', 'NASA']]);
  const sbagliata = (p) => ['netflux', 'ciuruglio', 'quseta', 'Quseta'].includes(p);
  const di = (p) => A.formaDelNome(p, { personali, sbagliata });
  assert.equal(di('zanzottera'), 'Zanzottera');
  assert.equal(di('ciuruglio'), '', 'scritta minuscola dall\'utente: non è un nome');
  assert.equal(di('nasa'), '', 'una sigla tutta maiuscola non corregge «nasa»');
  assert.equal(di('netflux'), 'Netflux', 'il dizionario conosce solo la forma con la maiuscola');
  assert.equal(di('quseta'), '', 'sbagliata anche con la maiuscola: è un refuso, non un nome');
});

test('le correzioni dell\'utente, anche su più parole, vincono sul resto; le parole rifiutate non si toccano più', () => {
  const personali = { 'x es': 'per esempio', perchè: 'perché mai', ke: 'che' };
  assert.deepEqual(battuto('tipo x es ', { personali }), { prima: 'x es', dopo: 'per esempio', fonte: 'personale' });
  assert.equal(battuto('il mese ', { personali: { es: 'esempio' } }), null, 'non dentro un\'altra parola');
  assert.deepEqual(battuto('Ke ', { personali }), { prima: 'Ke', dopo: 'Che', fonte: 'personale' });
  assert.deepEqual(battuto('perchè ', { personali }), { prima: 'perchè', dopo: 'perché mai', fonte: 'personale' });
  const rifiutate = new Set(['perchè', 'marco', 'ke']);
  assert.equal(battuto('perchè ', { rifiutate }), null);
  assert.equal(battuto('ciao marco ', { rifiutate }), null);
  assert.equal(battuto('Ke ', { personali, rifiutate }), null);
});

test('chi scrive tutto minuscolo apposta non riceve maiuscole, ma gli errori fissi sì', () => {
  const minuscolo = A.scriveMinuscolo(A.stileDi('ciao come stai. tutto bene, '));
  assert.equal(minuscolo, true);
  assert.equal(battuto('tutto bene. marco ', { minuscolo }), null);
  assert.deepEqual(battuto('tutto bene. perchè ', { minuscolo }), { prima: 'perchè', dopo: 'perché', fonte: 'fisso' });
  assert.equal(battuto('ok marco ', { minuscolo, personali: { marco: 'Marco' } }), null, 'anche una correzione dell\'utente che cambia solo maiuscole');
  assert.equal(A.scriveMinuscolo(A.stileDi('Ciao come stai. tutto bene. ')), false, 'una maiuscola sua basta');
  assert.equal(A.scriveMinuscolo(A.stileDi('ciao, ')), false, 'un inizio di frase solo non basta');
  // Le maiuscole messe da Filo non sono dell'utente.
  const t = 'ciao Marco. tutto bene. ';
  assert.equal(A.scriveMinuscolo(A.stileDi(t, null, [{ start: 5, end: 10 }])), true);
  assert.equal(A.scriveMinuscolo(A.stileDi(t)), false);
  assert.deepEqual(A.stileDi('ok OK. va bene'), { minuscoli: 2, maiuscoli: 0 }, 'le sigle non dicono niente');
  // Il testo che si scrive decide; i testi già mandati dalla pagina contano solo se lui dice poco.
  assert.equal(A.scriveMinuscoloQui({ minuscoli: 3, maiuscoli: 0 }, { minuscoli: 0, maiuscoli: 5 }), true);
  assert.equal(A.scriveMinuscoloQui({ minuscoli: 0, maiuscoli: 1 }, { minuscoli: 9, maiuscoli: 0 }), false);
  assert.equal(A.scriveMinuscoloQui({ minuscoli: 1, maiuscoli: 0 }, { minuscoli: 2, maiuscoli: 0 }), true, 'un messaggio corto in una chat tutta minuscola');
  assert.equal(A.scriveMinuscoloQui({ minuscoli: 0, maiuscoli: 0 }, { minuscoli: 0, maiuscoli: 0 }), false, 'senza niente da leggere si corregge');
});

test('si impara solo una parola che non è il refuso di una parola vera', () => {
  assert.equal(A.distanza('propio', 'proprio'), 1);
  assert.equal(A.distanza('perhcè', 'perchè'), 1, 'due lettere scambiate');
  assert.equal(A.imparabile('ciuruglio', ['corrugation', 'ruglio', 'gigliuccio']), true);
  assert.equal(A.imparabile('propio', ['prop', 'proprio']), false);
  assert.equal(A.imparabile("qual'è", []), false);
  assert.equal(A.imparabile('perchè', []), false);
  assert.equal(A.imparabile('cmq', ['cm', 'mq']), true, 'le parole cortissime hanno sempre una parola vera vicina');
  assert.equal(A.imparabile('Claude', ['Claude', 'Claudette']), true, 'la stessa parola con la maiuscola non è un refuso');
});

test('una correzione accettata tre volte diventa automatica, nella forma base, e non per gli errori fissi', () => {
  let m = A.memoria(null);
  for (let i = 0; i < 2; i++) {
    const r = A.accettata(m, i ? 'Propio' : 'propio', i ? 'Proprio' : 'proprio', 3);
    assert.equal(r.impara, null);
    m = r.memoria;
  }
  const terza = A.accettata(m, 'propio', 'proprio', 3);
  assert.deepEqual(terza.impara, { parola: 'propio', correzione: 'proprio' });
  assert.deepEqual(terza.memoria.accettate, {});
  m = A.memoria(null);
  for (let i = 0; i < 5; i++) m = A.accettata(m, 'perchè', 'perché', 3).memoria;
  assert.deepEqual(m.accettate, {}, 'un errore fisso si corregge già da sé');
  assert.equal(A.accettata(A.memoria(null), 'iphone', 'iPhone', 1).impara.correzione, 'iPhone');
  assert.equal(A.accettata(A.memoria(null), 'il il', 'il', 1).impara, null, 'solo parole singole');
});

test('una correzione annullata due volte non torna; una accettata dopo ancora tre volte sì', () => {
  let r = A.annullata(A.memoria(null), 'Marco', 2);
  assert.equal(r.rifiuta, false);
  r = A.annullata(r.memoria, 'marco', 2);
  assert.equal(r.rifiuta, true);
  assert.deepEqual(r.memoria.rifiutate, ['marco']);
  let m = r.memoria;
  for (let i = 0; i < 3; i++) m = A.accettata(m, 'marco', 'Marco', 3).memoria;
  assert.deepEqual(m.rifiutate, []);
});

test('una parola fuori dizionario scritta tre volte si impara nella forma in cui la scrive l\'utente', () => {
  let m = A.memoria(null);
  let r;
  for (let i = 0; i < 3; i++) { r = A.riscritta(m, 'ciuruglio', {}, 3); m = r.memoria; }
  assert.equal(r.impara, 'ciuruglio');
  assert.deepEqual(m.riscritte, {});
  m = A.memoria(null);
  for (const [p, inizioFrase] of [['Zanzottera', true], ['Zanzottera', false], ['Zanzottera', false]]) { r = A.riscritta(m, p, { inizioFrase }, 3); m = r.memoria; }
  assert.equal(r.impara, 'Zanzottera');
  m = A.memoria(null);
  for (const p of ['Ciuruglio', 'ciuruglio', 'Ciuruglio']) { r = A.riscritta(m, p, {}, 3); m = r.memoria; }
  assert.equal(r.impara, 'ciuruglio', 'scritta anche minuscola: non è un nome');
  m = A.memoria(null);
  for (const [p, inizioFrase] of [['Ciuruglio', true], ['Ciuruglio', true], ['Ciuruglio', true]]) { r = A.riscritta(m, p, { inizioFrase }, 3); m = r.memoria; }
  assert.equal(r.impara, 'ciuruglio', 'la maiuscola a inizio frase non dice che è un nome');
});

test('una parola contata e poi corretta torna indietro; tolta dalla pagina si ricomincia da zero', () => {
  let m = A.memoria(null);
  m = A.riscritta(m, 'ciuruglio', {}, 3).memoria;
  m = A.riscritta(m, 'ciuruglio', {}, 3).memoria;
  m = A.corretta(m, 'ciuruglio');
  assert.equal(m.riscritte.ciuruglio.n, 1);
  m = A.annullata(m, 'ciuruglio', 5).memoria;
  m = A.accettata(m, 'ciuruglio', 'cicaleccio', 5).memoria;
  m = A.dimentica(m, 'Ciuruglio');
  assert.deepEqual([m.riscritte, m.annullate, m.accettate], [{}, {}, {}]);
});

test('i conti hanno un tetto largo: oltre, se ne va il più vecchio', () => {
  let m = A.memoria(null);
  for (let i = 0; i <= A.LIMITE_CONTI; i++) m.annullate[`p${i}`] = 1;
  m = A.annullata(m, 'nuova', 9).memoria;
  assert.equal(Object.keys(m.annullate).length, A.LIMITE_CONTI);
  assert.equal(m.annullate.nuova, 1);
  assert.equal(m.annullate.p0, undefined);
});

test('una memoria rovinata si legge vuota invece di rompere il correttore', () => {
  for (const v of [null, 'x', [], { accettate: 'no', rifiutate: 'no' }]) {
    assert.deepEqual(A.memoria(v), { accettate: {}, annullate: {}, riscritte: {}, rifiutate: [] });
  }
});

test('il modello non segna come errore una minuscola che vuole la maiuscola', () => {
  assert.deepEqual(R.segniDaRisposta('[marco][Marco][Nome proprio.][errore]', 'ciao marco').segni, []);
  assert.deepEqual(R.segniDaRisposta('[oggi è][Oggi è][Maiuscola.][errore]', 'oggi è bello').segni, []);
  const [s] = R.segniDaRisposta('[Lunedi][lunedì][Accento.][errore]', 'ci vediamo Lunedi').segni;
  assert.equal(s.correzioni[0], 'lunedì', 'una correzione che cambia altro resta');
});

test('si accende, si spegne e si regola anche a parole, dentro i limiti; accesa di serie', () => {
  const P = globalThis.SN_PREF;
  const C = globalThis.SN_CONST;
  assert.equal(C.DEFAULT_SETTINGS.correttore.automatica, true);
  assert.deepEqual(P.buildPreferencePartial('correzione automatica', 'no').partial, { correttore: { automatica: false } });
  assert.deepEqual(P.buildPreferencePartial('autocorrezione', 'sì').partial, { correttore: { automatica: true } });
  assert.deepEqual(P.buildPreferencePartial('quante volte annullare', '4').partial, { correttore: { annulliPerImparare: 4 } });
  assert.match(P.buildPreferencePartial('correzioni accettate', '500').rifiuto, /fuori dai limiti/);
  assert.deepEqual(C.soglieCorrettore({ correttore: { riscrittePerImparare: '' } }), { accettiPerImparare: 3, annulliPerImparare: 2, riscrittePerImparare: 3 });
});

test('i colori di riserva del lampo sono i predefiniti dei suoi token', () => {
  const TT = globalThis.SN_THEME_TOKENS;
  const css = readFileSync(new URL('../../src/styles/spellcheck.css', import.meta.url), 'utf8');
  assert.ok(css.includes(`var(--sn-spell-lampo, ${TT.defaultValue('correttore.lampo.color', 'light')})`));
  assert.ok(css.includes(`var(--sn-spell-lampo, ${TT.defaultValue('correttore.lampo.color', 'dark')})`));
  assert.ok(css.includes(`var(--sn-spell-lampo-durata, ${TT.defaultValue('correttore.lampo.durata', 'light')})`));
  assert.ok(TT.validate('correttore.lampo.durata', '600ms') && !TT.validate('correttore.lampo.durata', '1s; color:red'));
});
