// Il tetto al testo della critica del verificatore (#531).
//
// PERCHÉ QUESTO TEST
//   La critica passava per tre punti che si tenevano ciascuno il proprio
//   `slice(0, 4000)`. Su #509 si è fermata a metà parola («…chiusa da set») e il
//   feedback dei rilievi residui è nato col terzo rilievo monco. Qui si inchioda
//   quello che deve restare vero: (a) una critica di lunghezza reale arriva
//   INTERA, (b) se il tetto viene superato davvero il taglio si VEDE, (c) il
//   valore è UNO — dichiarato in src/shared/feedbackTransitions.js, che il
//   server incorpora al deploy — e non tre letterali che divergono.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Le stesse isolazioni di dispatch.test.mjs: dispatch legge queste radici
// all'import e non deve toccare il checkout vero.
const TMP = mkdtempSync(resolve(tmpdir(), 'filo-critique-'));
process.env.FILO_DISPATCH_STATE_DIR = TMP;
process.env.FILO_REPO_ROOT = TMP;

const require = createRequire(import.meta.url);
require(join(__dirname, '..', '..', 'src', 'shared', 'feedbackTransitions.js'));
const DATA = globalThis.SN_FB_TRANSITIONS;

const { capCritique, critiqueLimits } = await import('../../scripts/lib/critique.mjs');
const { applyVerifierVerdict, verifierNoteText } = await import('../../scripts/dispatch.mjs');
const { withVerdict } = await import('../../scripts/verify-local.mjs');

const LIMITS = { max: DATA.CRITIQUE_MAX, mark: DATA.CRITIQUE_CUT_MARK };

test('la fonte unica dichiara tetto e segno del taglio', () => {
  assert.ok(Number.isFinite(DATA.CRITIQUE_MAX) && DATA.CRITIQUE_MAX > 4000,
    'il tetto è dichiarato coi dati e sta sopra i 4000 che tagliavano #509');
  assert.ok(typeof DATA.CRITIQUE_CUT_MARK === 'string' && DATA.CRITIQUE_CUT_MARK.includes('tagliato'),
    'il segno del taglio è testo leggibile, non un carattere muto');
});

test('il paracadute degli strumenti vale quanto la fonte unica', () => {
  // critiqueLimits() ricade sui letterali quando il checkout non ha il file dei
  // dati. Se i due valori divergessero, il tetto cambierebbe di nascosto a
  // seconda di dove gira lo strumento — cioè il difetto, con un'altra faccia.
  const l = critiqueLimits();
  assert.equal(l.max, DATA.CRITIQUE_MAX);
  assert.equal(l.mark, DATA.CRITIQUE_CUT_MARK);
});

test('una critica di lunghezza reale passa INTERA', () => {
  // 6000 caratteri: sopra il vecchio tetto, sotto il nuovo. È il caso di #509.
  const critica = 'Il primo rilievo riguarda la scheda che resta aperta. '.repeat(120);
  assert.ok(critica.length > 4000 && critica.length < DATA.CRITIQUE_MAX);
  assert.equal(capCritique(critica, LIMITS), critica, 'niente da tagliare, niente tagliato');

  // E arriva intera anche dai due punti che la maneggiano.
  const nota = verifierNoteText('migliorabile', `MIGLIORABILE — ${critica}`);
  assert.ok(nota.endsWith(critica.trimEnd()), 'la nota della conversazione porta la critica fino in fondo');
  const st = applyVerifierVerdict({ id: 'x', branch: 'b' }, 'fail', critica);
  assert.equal(st.verifierCritique, critica.trim(), 'e così il carico di lavoro del giro dopo');
  const vl = withVerdict({}, 'claude/x', { verdict: 'fail', critique: critica, sha: 'abc', at: 't' });
  assert.equal(vl['claude/x'].critique, critica, 'e la verifica in sessione locale');
});

test('oltre il tetto il taglio si vede, e sta dentro il tetto', () => {
  const enorme = 'parola '.repeat(DATA.CRITIQUE_MAX);
  const out = capCritique(enorme, LIMITS);
  assert.ok(out.length <= DATA.CRITIQUE_MAX, 'il segno sta DENTRO il limite dichiarato');
  assert.ok(out.endsWith(DATA.CRITIQUE_CUT_MARK), 'chi legge sa di stare leggendo un pezzo');
  assert.ok(out.length > DATA.CRITIQUE_MAX - 300, 'si taglia il minimo indispensabile');
});

test('il taglio non spezza una parola a metà', () => {
  const limiti = { max: 30, mark: '…(tagliato)' };
  const out = capCritique('chiusa da settembre e poi tutto il resto', limiti);
  assert.equal(out, 'chiusa da…(tagliato)',
    'torna all’ultimo spazio invece di lasciare «set» appeso');
});

test('un testo senza spazi si taglia comunque, non si azzera', () => {
  const limiti = { max: 20, mark: '…(tagliato)' };
  const out = capCritique('x'.repeat(500), limiti);
  assert.equal(out.length, 20);
  assert.ok(out.startsWith('xxx') && out.endsWith('…(tagliato)'),
    'niente ricerca all’indietro all’infinito: resta il testo e resta il segno');
});

test('i tre punti che la maneggiano tagliano allo STESSO modo', () => {
  const enorme = 'rilievo numero uno con i passi per riprodurlo. '.repeat(1000);
  const nota = verifierNoteText('fail', enorme);
  const stato = applyVerifierVerdict({ id: 'x', branch: 'b' }, 'fail', enorme).verifierCritique;
  const locale = withVerdict({}, 'claude/x', { verdict: 'fail', critique: enorme, sha: 'a', at: 't' })['claude/x'].critique;
  for (const [nome, testo] of [['nota', nota], ['stato', stato], ['verifica locale', locale]]) {
    assert.ok(testo.endsWith(DATA.CRITIQUE_CUT_MARK), `${nome}: il taglio si vede`);
    assert.ok(testo.length >= DATA.CRITIQUE_MAX - 300, `${nome}: stesso tetto, non uno più stretto`);
  }
  assert.equal(stato, locale, 'stesso testo in ingresso, stesso taglio in uscita');
});
