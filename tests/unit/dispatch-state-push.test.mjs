// Il record di un verdetto NON deve pubblicare il branch worker su main.
//
// PERCHÉ ESISTE (incident 2026-08-13)
//   persistStateToGit chiudeva con `git push origin HEAD:main`. Su un branch
//   worker HEAD non è il commit del file di stato: è tutta la lavorazione non
//   ancora esaminata. E i branch worker nascono da main, quindi main ne è
//   antenato e il push fast-forwarda: l'intero lavoro atterra sulla linea che
//   ogni 6 ore viene costruita e distribuita a TUTTI gli utenti, scavalcando
//   verifier, secaudit e cancello di merge. È successo davvero, su #461.
//
//   Qui si monta un repo vero (remoto bare + clone, nessuna rete) nella
//   configurazione esatta dell'incidente — branch worker con un commit non
//   esaminato, main suo antenato — e si asserisce il SUCCESSO della cosa giusta:
//   su main arriva il file di stato, e SOLO quello.
//
// Nota: questo file non può stare in dispatch.test.mjs, che isola STATE_DIR con
// FILO_DISPATCH_STATE_DIR — proprio la variabile che spegne la persistenza git.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const TMP = mkdtempSync(resolve(tmpdir(), 'filo-statepush-'));
const ORIGIN = resolve(TMP, 'origin.git');
const REPO = resolve(TMP, 'repo');

const git = (args, cwd = REPO) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// Il modulo legge ROOT (e da lì STATE_DIR) a import-time: il repo finto va
// montato PRIMA dell'import, e FILO_DISPATCH_STATE_DIR deve restare spenta.
delete process.env.FILO_DISPATCH_STATE_DIR;
process.env.FILO_REPO_ROOT = REPO;

git(['init', '--bare', '-b', 'main', ORIGIN], TMP);
git(['clone', ORIGIN, REPO], TMP);
git(['config', 'user.email', 'routine@filo.test']);
git(['config', 'user.name', 'routine']);
writeFileSync(resolve(REPO, 'README.md'), 'base\n');
git(['add', '-A']);
git(['commit', '-q', '-m', 'base']);
git(['push', '-q', 'origin', 'main']);

// La configurazione dell'incidente: branch worker basato su main (quindi main
// ne è antenato → il push HEAD:main fast-forwarderebbe) con dentro lavoro NON
// esaminato.
git(['checkout', '-q', '-b', 'worker/FBTEST']);
writeFileSync(resolve(REPO, 'lavoro-non-esaminato.js'), 'module.exports = 1;\n');
git(['add', '-A']);
git(['commit', '-q', '-m', 'lavoro di #FBTEST, mai passato dal cancello']);

const { writeState, defaultState, persistStateToGit, clearState, rejectionText, branchIsEmpty } = await import('../../scripts/dispatch.mjs');

// File su main nel remoto (quello che riceverebbero gli utenti).
const filesOnMain = () => git(['ls-tree', '-r', '--name-only', 'main'], ORIGIN).split('\n').filter(Boolean);

test('il verdetto arriva su main, il lavoro non esaminato NO', () => {
  const before = git(['rev-parse', 'HEAD']);
  writeState({ ...defaultState('FBTEST', 'worker/FBTEST'), verifierVerdict: 'pass' });
  persistStateToGit('FBTEST', 'feedback: verifier pass FBTEST');

  const files = filesOnMain();
  // Il successo della cosa giusta: il verdetto è su main…
  assert.ok(
    files.includes('feedback-triage/state/FBTEST.json'),
    `il file di stato non è arrivato su main (files: ${files.join(', ')})`,
  );
  // …e il lavoro non esaminato NON ci è arrivato dietro.
  assert.ok(
    !files.includes('lavoro-non-esaminato.js'),
    'REGRESSIONE: il branch worker è stato pubblicato su main scavalcando il cancello',
  );
  // main non deve essere diventato la punta del branch worker.
  assert.notEqual(git(['rev-parse', 'main'], ORIGIN), git(['rev-parse', 'HEAD']));
  // Il commit locale del verdetto resta sul branch (sopravvive a reset/rebase).
  assert.notEqual(git(['rev-parse', 'HEAD']), before);
  assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD']), 'worker/FBTEST');
});

test('il file di stato su main ha il contenuto giusto', () => {
  const raw = git(['show', 'main:feedback-triage/state/FBTEST.json'], ORIGIN);
  assert.equal(JSON.parse(raw).verifierVerdict, 'pass');
});

test("l'albero di lavoro e l'indice del worker non vengono toccati", () => {
  // L'indice temporaneo del push non deve lasciare tracce nello stage vero.
  assert.equal(git(['status', '--porcelain']), '');
});

test('--clear-state toglie lo stato ANCHE da main', () => {
  // La persistenza deve saper cancellare, non solo aggiungere: se lo stato
  // sopravvive su main, la sessione dopo — che parte da lì — resuscita un
  // feedback già chiuso e lo rimanda in lavorazione.
  assert.ok(filesOnMain().includes('feedback-triage/state/FBTEST.json'));
  clearState('FBTEST');
  persistStateToGit('FBTEST', 'feedback: clear-state FBTEST');
  assert.ok(
    !filesOnMain().includes('feedback-triage/state/FBTEST.json'),
    'lo stato è ancora su main: un giro futuro lo rileggerebbe come lavoro aperto',
  );
});

test('una rimozione già avvenuta non lascia commit vuoti su main', () => {
  const before = git(['rev-parse', 'main'], ORIGIN);
  clearState('FBTEST');
  persistStateToGit('FBTEST', 'feedback: clear-state FBTEST (ripetuto)');
  assert.equal(git(['rev-parse', 'main'], ORIGIN), before);
});

test('rejectionText: la guardia d\'identità spiega il rifiuto invece di morire', () => {
  // Era chiamata ma mai definita: i tre --record-* morivano con
  // "rejectionText is not defined" ed exit 1 invece del 3 previsto, quindi il
  // guasto si travestiva da errore d'uso.
  assert.equal(typeof rejectionText, 'function');
  const t = rejectionText('transizione rifiutata su X: albero sbagliato');
  assert.match(t, /GUASTO/);
  assert.match(t, /albero sbagliato/);
  // Deve dire al worker che il verdetto NON è stato scritto: è l'informazione
  // che decide se ritentare o fermarsi.
  assert.match(t, /NON è stato scritto/);
});

test('un ramo senza differenze da main viene riconosciuto (#462)', () => {
  // Un ramo di lavoro identico alla linea principale mentre il feedback è in
  // attesa di verifica È il segno che il lavoro consegnato è stato messo da
  // parte: chi lo riceve deve saperlo, o boccia per assenza e lo fa riscrivere.
  assert.equal(branchIsEmpty('worker/FBTEST'), false, 'qui il lavoro c’è: nessun allarme');
  git(['branch', 'worker/VUOTO', 'main']);
  assert.equal(branchIsEmpty('worker/VUOTO'), true);
  assert.equal(branchIsEmpty(''), false, 'senza ramo non c’è niente da dire');
});

test('cleanup', () => {
  rmSync(TMP, { recursive: true, force: true });
});
