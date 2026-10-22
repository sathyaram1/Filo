// #1447 — la correzione automatica a fine parola senza DOM: quando una parola è finita, cosa si corregge (errori fissi,
// correzioni dell'utente, maiuscola di nomi e marchi), dove si scrive tutto minuscolo apposta, e cosa Filo impara dai
// rifiuti (in una fila sola nel main) senza imparare mai gli errori su parole vere.

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

test('dentro il codice, in blocco aperto o in linea non ancora chiuso, niente cambia', () => {
  assert.equal(battuto('```\nsudo apt install firefox '), null);
  assert.equal(battuto('`brew install firefox '), null);
  assert.deepEqual(battuto('```\nx\n```\nuso firefox '), { prima: 'firefox', dopo: 'Firefox', fonte: 'nome' });
  assert.deepEqual(battuto('il `codice` e firefox '), { prima: 'firefox', dopo: 'Firefox', fonte: 'nome' });
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
  assert.equal(A.imparabile('nn', ['non', 'in']), true);
  assert.equal(A.imparabile('teh', ['the', 'ten']), false, 'due lettere scambiate restano un refuso anche corto');
  assert.equal(A.imparabile('metereologia', ['meteorologia']), false, 'una parola lunga sbaglia anche di due');
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

test('alle schede va solo quello che il content script usa: i conti a metà restano nel magazzino', () => {
  const S = require('../../src/main/services/correttoreSpinte.js');
  assert.deepEqual(S.ritaglia({ sn_correttore_imparato: { oldValue: { rifiutate: [] }, newValue: { rifiutate: ['marco'], annullate: { x: 1 } } } }), { rifiutate: ['marco'] });
  assert.equal(S.ritaglia({ sn_correttore_imparato: { oldValue: { rifiutate: ['a'] }, newValue: { rifiutate: ['a'], riscritte: { x: { n: 1 } } } } }), null, 'un conto che cresce non si spinge');
  assert.deepEqual(S.ritaglia({ sn_personal_dict: { newValue: ['ciuruglio'] }, settings: { newValue: {} } }), { sn_personal_dict: ['ciuruglio'] });
  assert.deepEqual(S.ritaglia({ sn_autocorrect: { newValue: undefined } }), { sn_autocorrect: {} }, 'tolte tutte, la mappa vuota');
  assert.equal(S.ritaglia({ settings: { newValue: {} } }), null);
});

test('quello che si impara passa da una fila sola nel main: tre schede insieme non si cancellano i conti', async () => {
  const mem = {};
  const prima = { chrome: globalThis.chrome, SN_STORAGE: globalThis.SN_STORAGE };
  globalThis.chrome = { storage: { local: {
    get: async (k) => { await new Promise((ok) => setTimeout(ok, 2)); return { [k]: mem[k] }; },
    set: async (o) => { await new Promise((ok) => setTimeout(ok, 2)); Object.assign(mem, o); },
  } } };
  globalThis.SN_STORAGE = { getSettings: async () => ({ correttore: { riscrittePerImparare: 3, annulliPerImparare: 2 } }) };
  try {
    const I = require('../../src/main/services/correttoreImpara.js');
    const esiti = await Promise.all([1, 2, 3].map(() => I.passo({ passo: 'riscritta', parola: 'ciuruglio' })));
    assert.deepEqual(esiti.map((e) => e.impara), [null, null, 'ciuruglio']);
    const daFilo = { daFilo: true };
    await I.passo({ passo: 'rifiuta', parola: 'Marco' }, daFilo);
    assert.equal((await I.passo({ passo: 'rifiuta', parola: 'marco' }, daFilo)).gia, true);
    assert.equal((await I.passo({ passo: 'rinominaRifiutata', parola: 'marco', nuova: 'luca' }, daFilo)).ok, true);
    assert.deepEqual((await I.passo({ passo: 'leggi' })).rifiutate, ['luca'], 'alle schede vanno solo le parole da non correggere');
    assert.deepEqual(Object.keys(await I.passo({ passo: 'leggi' })).sort(), ['ok', 'rifiutate']);
    // Da un sito si impara scrivendo, ma non si cambia né si toglie niente a mano.
    for (const passo of ['rifiuta', 'togliRifiutata', 'rinominaRifiutata', 'togliParola', 'rinominaParola']) {
      assert.equal((await I.passo({ passo, parola: 'luca', nuova: 'x' })).code, 'forbidden', passo);
    }
    assert.deepEqual((await I.passo({ passo: 'togliRifiutata', parola: 'luca' }, daFilo)).rifiutate, []);
    // Il dizionario personale passa dalla stessa fila: niente doppioni, e chi cambia una parola la fa ricominciare.
    await Promise.all(['ciuruglio', 'Zanzotera', 'CIURUGLIO'].map((parola) => I.passo({ passo: 'aggiungiParola', parola })));
    assert.deepEqual(mem.sn_personal_dict, ['ciuruglio', 'Zanzotera']);
    await I.passo({ passo: 'riscritta', parola: 'zanzottera' });
    assert.equal((await I.passo({ passo: 'rinominaParola', parola: 'zanzotera', nuova: 'ciuruglio' }, daFilo)).gia, true);
    await I.passo({ passo: 'rinominaParola', parola: 'zanzotera', nuova: 'Zanzottera' }, daFilo);
    assert.deepEqual(mem.sn_personal_dict, ['ciuruglio', 'Zanzottera']);
    assert.equal(mem.sn_correttore_imparato.riscritte.zanzottera, undefined);
    assert.deepEqual((await I.passo({ passo: 'togliParola', parola: 'CIURUGLIO' }, daFilo)).parole, ['Zanzottera']);
    for (const q of [{ passo: 'cancella', parola: 'x' }, { passo: 'annullata', parola: '' }, { passo: 'annullata', parola: 'a'.repeat(5000) },
      { passo: 'accettata', parola: 'propio' }, { passo: '__proto__', parola: 'x' }, null]) {
      assert.equal((await I.passo(q)).ok, false, JSON.stringify(q));
    }
  } finally {
    Object.assign(globalThis, prima);
  }
});

test('come si scrive in un sito si somma, si dimezza oltre il tetto e resta nel main per sito', async () => {
  assert.deepEqual(A.sommaStile({ minuscoli: 2, maiuscoli: 0 }, { minuscoli: 1, maiuscoli: 0 }), { minuscoli: 3, maiuscoli: 0 });
  assert.deepEqual(A.sommaStile(null, { minuscoli: -4, maiuscoli: 'x' }), { minuscoli: 0, maiuscoli: 0 });
  const grande = A.sommaStile({ minuscoli: 30, maiuscoli: 10 }, { minuscoli: 1e9, maiuscoli: 0 });
  assert.ok(grande.minuscoli + grande.maiuscoli <= A.STILE_MAX, JSON.stringify(grande));
  assert.ok(grande.maiuscoli > 0, 'il modo di prima conta ancora');

  const mem = {};
  const prima = { chrome: globalThis.chrome, SN_STORAGE: globalThis.SN_STORAGE };
  globalThis.chrome = { storage: { local: {
    get: async (k) => ({ [k]: mem[k] }),
    set: async (o) => { Object.assign(mem, o); },
  } } };
  try {
    const I = require('../../src/main/services/correttoreImpara.js');
    const chat = { origine: 'https://chat.example/stanza/1' };
    await Promise.all([1, 2].map(() => I.passo({ passo: 'stile', minuscoli: 1, maiuscoli: 0 }, chat)));
    assert.deepEqual((await I.passo({ passo: 'leggiStile' }, { origine: 'https://chat.example/altra' })).stile, { minuscoli: 2, maiuscoli: 0 },
      'riaperta, la stessa chat lo sa già');
    assert.deepEqual((await I.passo({ passo: 'leggiStile' }, { origine: 'https://altro.example/' })).stile, { minuscoli: 0, maiuscoli: 0 });
    // Il sito lo dice chi manda, non la richiesta.
    await I.passo({ passo: 'stile', minuscoli: 5, sito: 'https://altro.example' }, chat);
    assert.deepEqual(Object.keys(mem[I.STILI]), ['https://chat.example']);
    for (const origine of ['', 'about:blank', 'javascript:alert(1)', null]) {
      assert.equal((await I.passo({ passo: 'stile', minuscoli: 1 }, { origine })).ok, false, String(origine));
    }
    for (let i = 0; i < I.STILI_MAX + 3; i++) await I.passo({ passo: 'stile', maiuscoli: 1 }, { origine: `https://s${i}.example/` });
    assert.equal(Object.keys(mem[I.STILI]).length, I.STILI_MAX);
    assert.equal(mem[I.STILI]['https://chat.example'], undefined, 'esce il sito usato meno di recente');
  } finally {
    Object.assign(globalThis, prima);
  }
});

test('il nome dopo un apostrofo d\'elisione prende la maiuscola, e l\'annullo vale per il nome', () => {
  assert.deepEqual(battuto("Mi piace l'italia "), { prima: 'italia', dopo: 'Italia', fonte: 'nome' });
  assert.deepEqual(battuto("Il sud dell'europa,"), { prima: 'europa', dopo: 'Europa', fonte: 'nome' });
  assert.deepEqual(battuto("Ho l'iphone "), { prima: 'iphone', dopo: 'iPhone', fonte: 'nome' });
  assert.equal(battuto("Mi piace l'italia ", { rifiutate: new Set(['italia']) }), null);
  assert.equal(battuto("Ok c'era "), null);
});

test('l\'apostrofo al posto dell\'accento diventa la forma accentata che il dizionario conosce; i troncamenti giusti restano', () => {
  const giuste = new Set(['perché', 'più', 'così', 'sarà', "c'è", 'né', 'dì', 'caffè']);
  const accento = (p) => giuste.has(p);
  assert.deepEqual(battuto("Ok perche' ", { accento }), { prima: "perche'", dopo: 'perché', fonte: 'fisso' });
  assert.deepEqual(battuto("Ci vediamo piu' ", { accento }), { prima: "piu'", dopo: 'più', fonte: 'fisso' });
  assert.deepEqual(battuto("Va bene COSI' ", { accento }), { prima: "COSI'", dopo: 'COSÌ', fonte: 'fisso' });
  assert.deepEqual(battuto("Ok c'e' ", { accento }), { prima: "c'e'", dopo: "c'è", fonte: 'fisso' });
  assert.deepEqual(battuto("Ok ne' ", { accento }), { prima: "ne'", dopo: 'né', fonte: 'fisso' });
  assert.deepEqual(battuto("Ok qual'e' ", { accento: (p) => p === "qual'è" }), { prima: "qual'e'", dopo: 'qual è', fonte: 'fisso' });
  for (const t of ["Aspetta un po' ", "Di' ", "Fa' ", "I de' "]) assert.equal(battuto(t, { accento }), null, t);
  // Senza dizionario carico niente si indovina.
  assert.equal(battuto("Ok perche' ", { accento: () => false }), null);
  assert.equal(battuto("Ok perche' "), null);
});

test('l\'apice che chiude una virgoletta semplice non è un accento', () => {
  const accento = (p) => ['più', 'è'].includes(p);
  assert.equal(battuto("La congiunzione 'e' ", { accento }), null);
  assert.equal(battuto("La congiunzione ‘e’ ", { accento }), null);
  assert.equal(battuto("Disse 'vengo anche io e' ", { accento }), null);
  assert.equal(battuto("Ha scritto 'piu' ", { accento }), null);
  assert.deepEqual(battuto("Chiedi a 'marco' "), { prima: 'marco', dopo: 'Marco', fonte: 'nome' });
  // Chiusa la virgoletta, l'apostrofo dopo torna un accento.
  assert.deepEqual(battuto("Ha detto 'ciao' e' ", { accento }), { prima: "e'", dopo: 'è', fonte: 'fisso' });
  assert.deepEqual(battuto("L'ho visto e' ", { accento }), { prima: "e'", dopo: 'è', fonte: 'fisso' });
  assert.equal(R.erroriFissi("Disse 'vengo perche'").length, 0);
});
