// #2756 — il correttore riconosce la lingua del testo: su un sistema italiano un testo inglese si controlla col dizionario
// inglese, le proposte sono inglesi e il modello sa che deve correggere in inglese, non tradurre («seeng» → «seeing»,
// mai «vedendo»). Senza una lingua riconosciuta valgono le lingue di serie, come prima.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../src/shared/i18n.js');
require('../../src/shared/contenutoEsterno.js');
require('../../src/shared/constants.js');
require('../../src/content/correttoreRegole.js');
const R = globalThis.SN_CORRETTORE;
const PROMPTS = globalThis.SN_CONST.PROMPTS;
const MODULO = require.resolve('../../src/main/services/dizionarioDiFilo.js');

const INGLESE = 'seeng the current rate of improvements i honestly think the best comparison is agriculture.';
const ITALIANO = 'sono andatto al mare con mia sorella e non abbiamo trovato posto';

test('la lingua di un testo dalle sue parole grammaticali; troppo poco o metà e metà non decide', () => {
  assert.equal(R.linguaDi(INGLESE), 'en');
  assert.equal(R.linguaDi(ITALIANO), 'it');
  assert.equal(R.linguaDi("I don't think it's here"), 'en');
  assert.equal(R.linguaDi("l'albero dell'anno c'è"), 'it');
  assert.equal(R.linguaDi('Ciao Marco!'), null);
  assert.equal(R.linguaDi('ok'), null);
  assert.equal(R.linguaDi(''), null);
  assert.equal(R.linguaDi('the cat and il cane e'), null, 'metà e metà');
  // Le parole che le due lingue hanno in comune non contano: «a», «in», «come», «no», «so».
  assert.equal(R.linguaDi('a in come no so a in'), null);
});

test('una lingua per riga: la riga che non decide prende quella del testo intero', () => {
  const testo = `${ITALIANO}\nok\n${INGLESE}`;
  const tratti = R.lingueDelTesto(testo);
  assert.deepEqual(tratti.map((t) => t.lingua), ['it', null, 'en'], 'il testo intero, metà e metà, non decide per «ok»');
  assert.equal(R.linguaIn(tratti, 0), 'it');
  assert.equal(R.linguaIn(tratti, testo.indexOf('seeng')), 'en');
  assert.equal(R.linguaIn(tratti, testo.length), 'en');
  const soloInglese = R.lingueDelTesto(`Hi,\n${INGLESE}`);
  assert.equal(R.linguaIn(soloInglese, 0), 'en', 'la riga corta prende la lingua del testo');
  assert.equal(R.linguaIn([], 3), null);
});

test('i candidati del dizionario chiedono la parola con la sua posizione', () => {
  const chieste = [];
  R.candidatiDizionario('ciao quseta', { sbagliata: (p, start) => { chieste.push([p, start]); return false; } });
  assert.deepEqual(chieste, [['ciao', 0], ['quseta', 5]]);
});

test('su un sistema italiano si carica anche l\'inglese, ma le lingue di serie restano quelle di prima', async () => {
  delete require.cache[MODULO];
  const D = require(MODULO);
  assert.deepEqual(D.daCaricare('it-IT'), ['it-IT', 'en-US']);
  assert.deepEqual(D.daCaricare('en-GB'), ['it-IT', 'en-GB']);
  assert.deepEqual(D.daCaricare('en-AU'), ['it-IT', 'en-GB']);
  assert.deepEqual(D.daCaricare('de-DE'), ['it-IT', 'en-US']);
  assert.equal(await D.prepara({ locale: 'it-IT' }), true, JSON.stringify(D.stato()));
  assert.deepEqual(D.stato().lingue, ['it-IT', 'en-US']);
  assert.deepEqual(D.stato().predefinite, ['it-IT']);

  const parole = ['seeng', 'the', 'honestly', 'improvements', 'andatto', 'andato'];
  assert.deepEqual(await D.sbagliate(parole, 'en'), [true, false, false, false, true, true], 'in inglese');
  assert.deepEqual(await D.sbagliate(parole, 'it'), [true, true, true, true, true, false], 'in italiano');
  assert.deepEqual(await D.sbagliate(parole), [true, true, true, true, true, false], 'senza lingua: l\'italiano di serie, come prima');
  assert.deepEqual(await D.sbagliate(parole, 'xx'), await D.sbagliate(parole), 'una lingua che non c\'è vale quelle di serie');

  // Le proposte sono parole inglesi; le italiane le avrebbe date il dizionario di serie.
  const p = await D.proposte('seeng', 'en');
  assert.ok(p.length, JSON.stringify(p));
  assert.ok((await D.sbagliate(p, 'en')).every((x) => x === false), `solo parole inglesi: ${JSON.stringify(p)}`);
  assert.notDeepEqual(await D.proposte('seeng'), p, 'senza lingua proponeva in italiano');
  assert.ok((await D.proposte('andatto', 'it')).includes('andato'));
  assert.deepEqual(await D.proposte('the', 'en'), [], 'una parola giusta nella sua lingua non ha proposte');
});

test('la pagina passa la lingua al dizionario, e senza lingua chiede come prima', () => {
  const fai = require('../../src/preload/dizionario.js');
  const viaggi = [];
  const ipc = { sendSync: (...a) => { viaggi.push(a); return a[0] === 'filo:dizionario-sbagliate' ? a[1].map(() => false) : ['seeing']; } };
  const D = fai(ipc, null);
  D.sbagliate(['the'], 'en');
  D.sbagliata('the');
  D.proposte('seeng', 'en');
  assert.deepEqual(viaggi, [
    ['filo:dizionario-sbagliate', ['the'], 'en'],
    ['filo:dizionario-sbagliate', ['the']],
    ['filo:dizionario-proposte', 'seeng', 'en'],
  ]);
});

test('il modello riceve la lingua nel messaggio, mai nel system che va in cache; un valore strano non entra', () => {
  const en = PROMPTS.spellcheckErrori({ nuovo: INGLESE, candidati: [{ pezzo: 'seeng', perche: 'x' }], lingua: 'en' });
  assert.match(en, /Il testo è scritto in inglese: le correzioni restano in inglese, mai una parola tradotta/);
  assert.match(PROMPTS.spellcheckErrori({ nuovo: ITALIANO, lingua: 'it' }), /scritto in italiano/);
  for (const strano of [undefined, null, '', 'xx', '<b>', '__proto__', 'toString']) {
    assert.doesNotMatch(PROMPTS.spellcheckErrori({ nuovo: 'ciao', lingua: strano }), /Il testo è scritto in/, String(strano));
  }
  assert.doesNotMatch(PROMPTS.spellcheckErroriSistema(), /scritto in inglese/);
  const oggi = new Date(2026, 10, 28);
  assert.match(PROMPTS.spellcheckSuggerimenti({ nuovo: INGLESE, lingua: 'en', oggi }), /Il testo è scritto in inglese/);
  assert.doesNotMatch(PROMPTS.spellcheckSuggerimenti({ nuovo: INGLESE, oggi }), /Il testo è scritto in/);
});

test('la lingua parte con il controllo rapido, quello ragionato e quello chiesto col tasto destro', async () => {
  const { readFileSync } = await import('node:fs');
  const sorgente = readFileSync(new URL('../../src/content/spellcheck.js', import.meta.url), 'utf8');
  assert.equal((sorgente.match(/lingua: linguaDelPezzo\(/g) || []).length, 3);
});
