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
  ensureSessionExcludes, SESSION_MARKERS,
  sealCurrentWork, findStateIdByBranch,
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

  // Gli endpoint di fusione del server rifiutano già `main`; qui il controllo
  // mancava, e la directory poteva essere posizionata sulla linea principale
  // per PRODURRE. Il lavoro fatto lì non ha modo di arrivare agli utenti (il
  // cancello fonde un ramo) e intanto sporca la copia locale.
  test('la linea principale NON è un ramo di lavoro: non ci si posiziona sopra', () => {
    const { work } = makeRepo();
    git(work, ['checkout', '-q', '-b', 'worker/dove-siamo-adesso']);
    for (const nome of ['main', 'master', 'refs/heads/main', 'origin/main', 'MAIN']) {
      const r = prepareBranch({ root: work, branch: nome });
      assert.equal(r.ok, false, `"${nome}" non deve essere accettato come ramo di lavoro`);
      assert.equal(r.kind, 'permanent', 'riprovare ogni 6 ore non aggiusta un ramo che non è un ramo di lavoro');
    }
    assert.equal(currentBranch(work), 'worker/dove-siamo-adesso',
      'e la directory non deve essere stata spostata mentre ci provava');
  });

  test('vale anche in creazione, e anche per la linea principale dichiarata dal chiamante', () => {
    const { work } = makeRepo();
    assert.equal(prepareBranch({ root: work, branch: 'main', create: true }).ok, false);
    assert.equal(prepareBranch({ root: work, branch: 'produzione', mainBranch: 'produzione' }).ok, false,
      'la linea principale è protetta comunque si chiami');
  });

  test('isProtectedBranch: i due nomi inchiodati non dipendono da cosa dichiara il chiamante', () => {
    assert.equal(isProtectedBranch('main'), true);
    assert.equal(isProtectedBranch('master'), true);
    assert.equal(isProtectedBranch('main', 'qualcosaltro'), true,
      'se qualcuno raccontasse una linea principale diversa, main resterebbe protetto');
    assert.equal(isProtectedBranch(''), true, 'nel dubbio è protetto');
    assert.equal(isProtectedBranch('worker/12-20260821T120000Z'), false);
    assert.equal(isProtectedBranch('claude/ridisegno-max'), false);
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
describe('D — il sigillo di fine giro (#507): la consegna non è un moncone', () => {
  // Lo scenario dell'incidente, per intero: new-work si posiziona (punto fermo
  // = base), lavora, l'hook pusha, consegna via canale. Se la consegna NON
  // sigilla, il posizionamento successivo nello stesso clone riporta il ramo
  // alla base e parcheggia il lavoro su discarded/ — è quello che è successo a
  // #502 (8 commit, 828 righe) e a #495.
  function scenaConsegna() {
    const { work } = makeRepo();
    const id = 'feed507';
    const branch = 'worker/feed507-x';
    git(work, ['checkout', '-q', '-b', branch]);
    const base = git(work, ['rev-parse', 'HEAD']);
    // Come positionOnBranch: punto fermo alla base, identità attesa scritta.
    writeBranchState(work, withCheckpoint({ id, branch }, base, 'new-work:checkout'));
    writeExpectation(work, { branch, id });
    // Il lavoro: commit + push (l'hook di salvataggio pusha sempre).
    const consegna = commit(work, 'lavoro.txt', 'fatto\n');
    git(work, ['push', '-q', 'origin', branch]);
    return { work, id, branch, base, consegna };
  }

  test('senza sigillo il posizionamento successivo SCARTA la consegna (il guasto)', () => {
    const { work, id, branch, base, consegna } = scenaConsegna();
    const r = prepareBranch({ root: work, branch, checkpoint: lastCheckpoint(readBranchState(work, id)) });
    assert.equal(r.ok, true, r.message);
    assert.equal(r.head, base, 'questo è il guasto documentato dal #507: la consegna sparisce');
    assert.notEqual(r.head, consegna);
    assert.ok(r.discarded, 'la consegna finisce parcheggiata su discarded/');
  });

  test('con il sigillo alla consegna il lavoro RESTA (la cura)', () => {
    const { work, id, branch, consegna } = scenaConsegna();
    const s = sealCurrentWork(work, { by: 'deliver:status' });
    assert.equal(s.sealed, true, s.why);
    assert.equal(s.id, id, 'l’id si ritrova da solo dall’identità attesa');
    assert.equal(s.sha, consegna);
    const r = prepareBranch({ root: work, branch, checkpoint: lastCheckpoint(readBranchState(work, id)) });
    assert.equal(r.ok, true, r.message);
    assert.equal(r.head, consegna, 'il punto fermo sigillato È la consegna: niente da scartare');
    assert.equal(r.discarded, null);
  });

  test('il sigillo ritrova l’id anche senza identità attesa (dallo stato per branch)', () => {
    const { work, id, branch, consegna } = scenaConsegna();
    clearExpectation(work);
    assert.equal(findStateIdByBranch(work, branch), id);
    const s = sealCurrentWork(work, { by: 'release' });
    assert.equal(s.sealed, true, s.why);
    assert.equal(lastCheckpoint(readBranchState(work, id)), consegna);
  });

  test('il sigillo si rifiuta di scrivere dove non deve', () => {
    const { work, id } = scenaConsegna();
    // Stato che nomina un ALTRO branch: sigillare qui sposterebbe il punto
    // fermo di un lavoro diverso da quello che si sta consegnando.
    writeBranchState(work, { id, branch: 'worker/un-altro' });
    clearExpectation(work);
    assert.equal(sealCurrentWork(work, { id }).sealed, false);
    // Sulla linea principale non c'è niente da sigillare.
    git(work, ['checkout', '-q', 'main']);
    assert.equal(sealCurrentWork(work, {}).sealed, false);
  });

  test('la variante del 27/08: i commit fatti DOPO l’ultimo verdetto si salvano col sigillo al rilascio', () => {
    // Il verificatore sigilla il verdetto, poi fa un commit di pulizia: senza
    // il sigillo al rilascio, quel commit veniva scartato al giro dopo (e lo
    // scarto ripristinava pure i file che la pulizia toglieva).
    const { work, id, branch } = scenaConsegna();
    sealCurrentWork(work, { by: 'verifier:pass' });
    const pulizia = commit(work, 'pulizia.txt', 'tolto lo spec temporaneo\n');
    git(work, ['push', '-q', 'origin', branch]);
    const s = sealCurrentWork(work, { by: 'release' });
    assert.equal(s.sealed, true, s.why);
    const r = prepareBranch({ root: work, branch, checkpoint: lastCheckpoint(readBranchState(work, id)) });
    assert.equal(r.ok, true, r.message);
    assert.equal(r.head, pulizia, 'la pulizia del verificatore non è un moncone da scartare');
    assert.equal(r.discarded, null);
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

// ─────────────────────────────────────────────────────────────────────────────
describe('F — i marcatori di sessione sopravvivono ai rami vecchi (incidente #444)', () => {
  // Il 25 agosto il checkout di un ramo del 22 ha spazzato il marcatore del
  // battito, nato il 23: la lista di esclusione che viaggia col ramo è vecchia
  // quanto il ramo. La cura è `info/exclude`, che vale su ogni ramo e non
  // viaggia mai in un commit — così né la pulizia né il salvataggio automatico
  // vedono i marcatori, qualunque sia l'età del ramo checkoutato.

  test('ensureSessionExcludes: scrive le esclusioni una volta sola (idempotente)', () => {
    const { work } = makeRepo();
    assert.equal(ensureSessionExcludes(work), true);
    const f = resolve(work, '.git', 'info', 'exclude');
    const primo = readFileSync(f, 'utf8');
    for (const m of SESSION_MARKERS) {
      assert.ok(primo.includes(m), `info/exclude deve elencare ${m}`);
    }
    assert.equal(ensureSessionExcludes(work), true);
    assert.equal(readFileSync(f, 'utf8'), primo, 'una seconda chiamata non deve duplicare niente');
  });

  test('prepareBranch verso un ramo più vecchio dei marcatori NON li spazza e NON li consegna a git', () => {
    const { work } = makeRepo();
    // Il ramo "vecchio": la sua lista di esclusione conosce il promemoria del
    // biglietto ma NON il marcatore del battito (nato dopo) — è la scena del
    // 25 agosto, ricostruita.
    git(work, ['checkout', '-q', '-b', 'worker/vecchio']);
    writeFileSync(resolve(work, '.gitignore'), '.claude/routine-ticket.json\n', 'utf8');
    git(work, ['add', '-A']);
    git(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'ramo vecchio']);
    git(work, ['push', '-q', 'origin', 'worker/vecchio']);
    git(work, ['checkout', '-q', 'main']);

    // I marcatori del giro in corso, scritti prima del cambio di ramo.
    mkdirSync(resolve(work, '.claude'), { recursive: true });
    writeFileSync(resolve(work, '.claude', 'routine-ticket.json'), '{"ticket":"vivo"}\n', 'utf8');
    writeFileSync(resolve(work, '.claude', 'routine-beat.json'), '{"pid":1,"ticket":"vivo"}\n', 'utf8');

    const r = prepareBranch({ root: work, branch: 'worker/vecchio' });
    assert.equal(r.ok, true, r.message);
    // Senza il fix qui il marcatore del battito è sparito (la pulizia lo vedeva
    // come file estraneo): questo assert era rosso.
    assert.ok(existsSync(resolve(work, '.claude', 'routine-beat.json')),
      'il marcatore del battito deve sopravvivere anche su un ramo che non lo conosce');
    assert.ok(existsSync(resolve(work, '.claude', 'routine-ticket.json')),
      'il promemoria del biglietto deve sopravvivere');
    // E il salvataggio automatico non deve vederli: un marcatore committato è
    // un biglietto pubblicato sul repo.
    const status = git(work, ['status', '--porcelain']);
    assert.ok(!status.includes('routine-beat.json') && !status.includes('routine-ticket.json'),
      `i marcatori non devono comparire a git status (visti: ${status || 'niente'})`);
  });
});
