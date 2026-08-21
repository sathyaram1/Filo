// Integrità del ramo nelle routine — spec: ROUTINE-BRANCH-INTEGRITY.md
//
// Ogni test corrisponde a un punto della spec (A/B/C/D/E) e alla sezione
// "Verifica". Girano su repo git temporanei con un finto `origin` (un bare
// repo): niente rete, niente Electron, millisecondi.
//
// Perché questi assert e non altri (CLAUDE.md § "Test che servono davvero"):
// devono diventare ROSSI se si torna al comportamento del 24 luglio 2026 —
// un'istanza che giudica un albero diverso da quello assegnato, un lavoro
// interrotto che riparte da zero, una coda illeggibile scambiata per vuota.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  attemptStamp, newWorkBranch, identityVerdict,
  withCheckpoint, lastCheckpoint, CHECKPOINT_CAP,
  bumpRejects, clearRejects, IDENTITY_REJECT_LIMIT,
  discardedBranchName, prepareBranch, checkDelivery, guardTransition, isProtectedBranch,
  escalationNote, currentBranch, headSha,
  readBranchState, writeBranchState,
  writeExpectation, readExpectation, clearExpectation, expectationFile,
} from '../../scripts/lib/branch-integrity.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ─── helper: repo temporaneo con finto origin ────────────────────────────────

const made = [];
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function commit(dir, name, body) {
  writeFileSync(resolve(dir, name), body, 'utf8');
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', `add ${name}`]);
  return git(dir, ['rev-parse', 'HEAD']);
}

/** Crea `origin` (bare) + un clone con un commit iniziale su main. */
function makeRepo() {
  const base = mkdtempSync(resolve(tmpdir(), 'filo-bi-'));
  made.push(base);
  const origin = resolve(base, 'origin.git');
  const work = resolve(base, 'work');
  mkdirSync(origin); mkdirSync(work);
  git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  git(work, ['init', '-q', '--initial-branch=main']);
  git(work, ['remote', 'add', 'origin', origin]);
  commit(work, 'README.md', 'base\n');
  git(work, ['push', '-q', 'origin', 'main']);
  return { base, origin, work };
}

test.after(() => {
  for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch (_) {} }
});

// ─────────────────────────────────────────────────────────────────────────────
describe('A — nomi di branch unici per tentativo', () => {
  test('due tentativi sullo stesso feedback producono nomi DIVERSI', () => {
    const id = 'abc123';
    const a = newWorkBranch(id, Date.parse('2026-08-07T10:00:00Z'));
    const b = newWorkBranch(id, Date.parse('2026-08-07T10:00:01Z'));
    assert.notEqual(a, b, 'due tentativi devono avere nomi diversi: è ciò che elimina "nome giusto, contenuto vecchio"');
    assert.match(a, /^worker\//);
    assert.ok(a.includes(id), 'il nome resta riconducibile al feedback');
  });

  test('lo stampo del tentativo è monotono nel tempo', () => {
    const t1 = attemptStamp(Date.parse('2026-08-07T10:00:00Z'));
    const t2 = attemptStamp(Date.parse('2026-08-07T11:00:00Z'));
    assert.ok(t2 > t1, 'i nomi devono ordinarsi come il tempo, per l’archeologia');
  });

  test('un lavoro nuovo nasce sempre dalla linea principale (niente basi feature/N)', () => {
    // I sotto-feedback e il Modello B sono aboliti (SPEC-RIDISEGNO-MAX.md §1):
    // se preferredBase o le basi feature/* riappaiono, questo diventa rosso.
    const src = readFileSync(resolve(ROOT, 'scripts', 'dispatch.mjs'), 'utf8');
    assert.ok(!src.includes('preferredBase'), 'dispatch non deve più calcolare basi dal numero del feedback');
    assert.match(src, /base: '',/, 'la base del branch di un lavoro nuovo è la linea principale');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('A — posizionarsi sul branch (prepareBranch)', () => {
  test('new-work: crea il branch e ci posiziona la directory', () => {
    const { work } = makeRepo();
    const branch = newWorkBranch('feed1');
    const r = prepareBranch({ root: work, branch, create: true });
    assert.equal(r.ok, true, r.message);
    assert.equal(currentBranch(work), branch, 'la directory DEVE finire sul branch assegnato');
  });

  test('new-work: parte da main anche se la directory era su un altro branch di lavoro', () => {
    const { work } = makeRepo();
    // Sporca la scena: un branch altrui con un commit che NON deve essere ereditato.
    git(work, ['checkout', '-q', '-b', 'worker/altrui']);
    commit(work, 'roba-altrui.txt', 'x\n');
    const branch = newWorkBranch('feed2');
    const r = prepareBranch({ root: work, branch, create: true });
    assert.equal(r.ok, true, r.message);
    assert.equal(existsSync(resolve(work, 'roba-altrui.txt')), false,
      'partire da HEAD erediterebbe il lavoro di un altro feedback');
  });

  test('branch esistente: lo recupera da origin quando in locale non c’è', () => {
    const { work, origin } = makeRepo();
    // Un "altro" clone pubblica un branch di lavoro.
    const other = resolve(dirname(work), 'other');
    mkdirSync(other);
    git(other, ['clone', '-q', origin, '.']);
    git(other, ['checkout', '-q', '-b', 'worker/remoto']);
    const sha = commit(other, 'lavoro.txt', 'fatto\n');
    git(other, ['push', '-q', 'origin', 'worker/remoto']);

    const r = prepareBranch({ root: work, branch: 'worker/remoto' });
    assert.equal(r.ok, true, r.message);
    assert.equal(currentBranch(work), 'worker/remoto');
    assert.equal(r.head, sha, 'deve atterrare sul contenuto pubblicato, non su una copia locale');
  });

  test('branch inesistente = guasto PERMANENTE (non si ritenta ogni 6h)', () => {
    const { work } = makeRepo();
    const r = prepareBranch({ root: work, branch: 'worker/mai-esistito' });
    assert.equal(r.ok, false);
    assert.equal(r.kind, 'permanent',
      'permanente ⇒ il feedback esce dal giro e va all’owner, invece di consumare un avvio ogni 6 ore');
  });

  test('nome già usato in creazione = rifiuto (il nome unico non va riciclato)', () => {
    const { work } = makeRepo();
    git(work, ['branch', 'worker/gia-usato']);
    const r = prepareBranch({ root: work, branch: 'worker/gia-usato', create: true });
    assert.equal(r.ok, false, 'riusare un nome riporterebbe il guasto che il nome unico elimina');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('C — identità e punti fermi', () => {
  test('identityVerdict boccia il branch sbagliato e la HEAD staccata', () => {
    assert.equal(identityVerdict('worker/x', 'worker/x').ok, true);
    assert.equal(identityVerdict('main', 'worker/x').ok, false,
      'è ESATTAMENTE il caso del 24 luglio: giudicare main invece del branch del lavoro');
    assert.equal(identityVerdict('HEAD', 'worker/x').ok, false);
    assert.equal(identityVerdict('', 'worker/x').ok, false);
    assert.equal(identityVerdict('qualsiasi', '').ok, true,
      'senza branch assegnato non c’è niente da confrontare (owner a mano, feedback fuori pipeline)');
  });

  test('checkDelivery guarda la directory VERA, non ciò che le viene detto', () => {
    const { work } = makeRepo();
    git(work, ['checkout', '-q', '-b', 'worker/vero']);
    assert.equal(checkDelivery(work, 'worker/vero').ok, true);
    assert.equal(checkDelivery(work, 'worker/altro').ok, false);
  });

  test('una transizione accettata lascia un punto fermo; identici non si duplicano', () => {
    let s = withCheckpoint({ id: 'x' }, 'aaa', 'new-work');
    assert.equal(lastCheckpoint(s), 'aaa');
    s = withCheckpoint(s, 'aaa', 'verifier');
    assert.equal(s.checkpoints.length, 1, 'verifier e secaudit non committano: nessun punto fermo nuovo');
    s = withCheckpoint(s, 'bbb', 'fixer');
    assert.equal(lastCheckpoint(s), 'bbb');
    assert.equal(s.checkpoints.length, 2);
  });

  test('i punti fermi sono cappati e conservano gli ULTIMI', () => {
    let s = {};
    for (let i = 0; i < CHECKPOINT_CAP + 5; i++) s = withCheckpoint(s, `sha${i}`, 'r');
    assert.equal(s.checkpoints.length, CHECKPOINT_CAP);
    assert.equal(lastCheckpoint(s), `sha${CHECKPOINT_CAP + 4}`);
  });

  test('il contatore dei rifiuti scala alla soglia e una transizione buona lo azzera', () => {
    let s = {};
    for (let i = 1; i < IDENTITY_REJECT_LIMIT; i++) {
      const b = bumpRejects(s); s = b.state;
      assert.equal(b.escalate, false, `sotto soglia (${i}) non si scala`);
    }
    const last = bumpRejects(s);
    assert.equal(last.escalate, true, 'alla soglia si smette di insistere e decide l’owner');
    assert.equal(clearRejects(last.state).identityRejects, undefined);
  });

  test('guardTransition RIFIUTA dal branch sbagliato e ACCETTA da quello giusto', () => {
    const { work } = makeRepo();
    const prev = process.env.FILO_DISPATCH_STATE_DIR;
    process.env.FILO_DISPATCH_STATE_DIR = resolve(work, '.state');
    try {
      writeBranchState(work, { id: 'f1', branch: 'worker/assegnato' });

      // La directory è su main: è il caso che ha prodotto il verdetto falso.
      const bad = guardTransition(work, 'f1');
      assert.equal(bad.ok, false, 'una consegna dall’albero sbagliato NON deve essere registrata');
      assert.equal(readBranchState(work, 'f1').identityRejects, 1, 'il rifiuto viene contato');

      git(work, ['checkout', '-q', '-b', 'worker/assegnato']);
      const good = guardTransition(work, 'f1');
      assert.equal(good.ok, true);
    } finally {
      if (prev === undefined) delete process.env.FILO_DISPATCH_STATE_DIR;
      else process.env.FILO_DISPATCH_STATE_DIR = prev;
    }
  });

  test('guardTransition scala all’owner al terzo rifiuto consecutivo', () => {
    const { work } = makeRepo();
    const prev = process.env.FILO_DISPATCH_STATE_DIR;
    process.env.FILO_DISPATCH_STATE_DIR = resolve(work, '.state');
    try {
      writeBranchState(work, { id: 'f2', branch: 'worker/assegnato' });
      let escalated = 0;
      let last;
      for (let i = 0; i < IDENTITY_REJECT_LIMIT; i++) {
        last = guardTransition(work, 'f2', { escalate: () => { escalated++; } });
      }
      assert.equal(escalated, 1, 'un ambiente disallineato deve smettere di girare a vuoto');
      assert.equal(last.escalated, true);
    } finally {
      if (prev === undefined) delete process.env.FILO_DISPATCH_STATE_DIR;
      else process.env.FILO_DISPATCH_STATE_DIR = prev;
    }
  });

  test('la nota di escalation è per l’owner: niente branch, SHA o nomi di file', () => {
    const n = escalationNote(3);
    assert.match(n, /decisione/i, 'deve dire chiaramente che serve una scelta sua');
    assert.doesNotMatch(n, /branch|checkout|SHA|commit|\.mjs|worker\//i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('D — l’interruzione torna all’ultimo punto fermo', () => {
  test('scarta SOLO il lavoro dell’istanza interrotta, non quello dei predecessori', () => {
    const { work } = makeRepo();
    const branch = 'worker/catena';
    git(work, ['checkout', '-q', '-b', branch]);

    // A consegna: questo è il punto fermo.
    commit(work, 'lavoro-di-A.txt', 'A\n');
    const checkpoint = git(work, ['rev-parse', 'HEAD']);
    git(work, ['push', '-q', 'origin', branch]);

    // C inizia a correggere e viene interrotto a metà.
    const monco = commit(work, 'meta-di-C.txt', 'C a metà\n');

    const r = prepareBranch({ root: work, branch, checkpoint });
    assert.equal(r.ok, true, r.message);
    assert.equal(r.head, checkpoint, 'D riparte dal branch come l’aveva lasciato A');
    assert.equal(existsSync(resolve(work, 'lavoro-di-A.txt')), true, 'il lavoro di A NON si tocca');
    assert.equal(existsSync(resolve(work, 'meta-di-C.txt')), false, 'il frammento di C sparisce dalla scena');

    // Non distruggere: i commit scartati restano raggiungibili.
    assert.ok(r.discarded, 'i commit scartati vanno parcheggiati, non cancellati');
    assert.equal(git(work, ['rev-parse', r.discarded]), monco,
      'la traccia serve: questa spec esiste perché un branch del 24 luglio era ancora lì');
  });

  test('senza punti fermi il ripristino è totale (lavoro nuovo interrotto subito)', () => {
    const { work } = makeRepo();
    const branch = 'worker/nuovo';
    git(work, ['checkout', '-q', '-b', branch]);
    git(work, ['push', '-q', 'origin', branch]);
    const vuoto = git(work, ['rev-parse', 'HEAD']);
    commit(work, 'abbozzo.txt', 'niente di consegnato\n');

    const r = prepareBranch({ root: work, branch, checkpoint: null });
    assert.equal(r.ok, true, r.message);
    assert.equal(r.head, vuoto, 'stessa regola, caso degenere: nessun punto fermo ⇒ da zero');
    assert.equal(existsSync(resolve(work, 'abbozzo.txt')), false);
  });

  test('ripulisce anche i file mai salvati (residui di script/build/test)', () => {
    const { work } = makeRepo();
    const branch = 'worker/residui';
    git(work, ['checkout', '-q', '-b', branch]);
    commit(work, 'consegnato.txt', 'ok\n');
    const checkpoint = git(work, ['rev-parse', 'HEAD']);
    git(work, ['push', '-q', 'origin', branch]);

    // L'auto-commit scatta sugli Edit/Write, non sui comandi: questo file resta
    // fuori da git e al checkout successivo verrebbe TRASPORTATO sul branch del
    // compito dopo, finendo nel diff che va al cancello di sicurezza.
    writeFileSync(resolve(work, 'residuo-di-uno-script.txt'), 'avanzo\n', 'utf8');

    const r = prepareBranch({ root: work, branch, checkpoint });
    assert.equal(r.ok, true, r.message);
    assert.equal(existsSync(resolve(work, 'residuo-di-uno-script.txt')), false,
      'gli avanzi di un feedback non devono diventare il diff di un altro');
    assert.equal(git(work, ['status', '--porcelain']), '', 'la directory resta pulita');
  });

  test('il nome del parcheggio è unico e riconducibile al branch', () => {
    const a = discardedBranchName('worker/x', Date.parse('2026-08-07T10:00:00Z'));
    const b = discardedBranchName('worker/x', Date.parse('2026-08-07T10:00:01Z'));
    assert.notEqual(a, b);
    assert.match(a, /^discarded\/worker\/x-/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('B — l’identità attesa esposta alla guardia', () => {
  test('scritta alla consegna del lavoro, cancellata dopo', () => {
    const { work } = makeRepo();
    assert.equal(readExpectation(work), null, 'senza attesa la guardia è inerte (sessioni locali dell’owner)');
    writeExpectation(work, { branch: 'worker/atteso', id: 'f9' });
    assert.equal(readExpectation(work).branch, 'worker/atteso');
    clearExpectation(work);
    assert.equal(readExpectation(work), null,
      'dopo la consegna il merge-gate DEVE poter cambiare branch: l’attesa va tolta');
  });

  test('la guardia ferma l’istanza sul branch sbagliato e la lascia passare su quello giusto', () => {
    const { work } = makeRepo();
    const hook = resolve(ROOT, '.claude', 'hooks', 'branch-guard.sh');
    const run = () => {
      try {
        execFileSync('bash', [hook], {
          cwd: work, encoding: 'utf8',
          env: { ...process.env, CLAUDE_PROJECT_DIR: work },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { code: 0, err: '' };
      } catch (e) { return { code: e.status, err: `${e.stderr || ''}` }; }
    };

    assert.equal(run().code, 0, 'senza file di attesa non deve bloccare NULLA');

    git(work, ['checkout', '-q', '-b', 'worker/atteso']);
    writeExpectation(work, { branch: 'worker/atteso', id: 'f9' });
    assert.equal(run().code, 0, 'sul branch giusto passa');

    git(work, ['checkout', '-q', 'main']);
    const bad = run();
    assert.equal(bad.code, 2, 'exit 2 = blocca e riporta il messaggio all’istanza');
    assert.match(bad.err, /worker\/atteso/, 'il messaggio deve dire dove tornare');
  });

  test('l’attesa scritta per un’altra directory non blocca questa', () => {
    const { work } = makeRepo();
    const hook = resolve(ROOT, '.claude', 'hooks', 'branch-guard.sh');
    mkdirSync(resolve(work, '.claude'), { recursive: true });
    writeFileSync(expectationFile(work),
      JSON.stringify({ branch: 'worker/altrove', id: 'f', root: resolve(work, 'nope') }), 'utf8');
    try {
      execFileSync('bash', [hook], {
        cwd: work, encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: work },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      assert.fail(`non deve bloccare un’altra directory (exit ${e.status})`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E — un guasto non si traveste da giornata tranquilla', () => {
  // La distinzione "coda vuota ≠ coda illeggibile" (incidente #310+) vive nel
  // SERVER dal ridisegno (SPEC-RIDISEGNO-MAX.md §1): la coda si legge solo là,
  // functions/src/routine/queue.js + select.js. Qui resta il presidio locale.
  test('dispatch senza biglietto dichiara il guasto invece di scegliere da sé', () => {
    const src = readFileSync(resolve(ROOT, 'scripts', 'dispatch.mjs'), 'utf8');
    assert.match(src, /routineFault/, 'i guasti si dichiarano con la loro specie, non si inghiottono');
    assert.match(src, /nessun biglietto/, 'senza biglietto non si lavora: nessun cammino alternativo');
    assert.ok(!src.includes('next-feedback'),
      'la scelta locale del lavoro è smontata: se riappare, la chiave della coda torna su questa macchina');
  });
});
