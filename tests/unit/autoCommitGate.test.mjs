// Chi può pubblicare sul ramo principale — spec: ROUTINE-BRANCH-INTEGRITY.md §Via 1
//
// L'assert che conta: dopo che l'automatismo di salvataggio ha girato, il ramo
// principale remoto NON deve contenere il codice appena scritto. Prima del
// 2026-08-07 lo conteneva — bastava che il ramo avesse un nome fuori
// dall'elenco dei prefissi vietati, e il codice usciva a ogni singola modifica
// saltando verifica e cancello di sicurezza.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOKS_DIR = resolve(ROOT, '.claude', 'hooks');
// Gli automatismi che girano da soli a ogni modifica: il salvataggio e il
// diagnostico dei limiti di sessione. Sono due file diversi, ma rispondono
// entrambi alla stessa domanda — "questo ramo lo posso toccare?" — e devono
// rispondere allo stesso modo.
const HOOKS = ['auto-commit-merge.sh', 'cap-observe.sh'];

const made = [];
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Repo isolato con finto origin, e una copia degli hook veri da eseguire.
 * `poison` avvelena la configurazione locale di git come nello scenario reale:
 * `push.default=upstream` + `branch.<ramo>.merge=refs/heads/main` è ciò che git
 * imposta DA SÉ su ogni ramo nato da origin/main.
 */
function scene({ poison = false } = {}) {
  const base = mkdtempSync(resolve(tmpdir(), 'filo-hook-'));
  made.push(base);
  const origin = resolve(base, 'origin.git');
  const work = resolve(base, 'work');
  mkdirSync(origin); mkdirSync(work);
  git(origin, ['init', '--bare', '-q', '--initial-branch=main']);
  git(work, ['init', '-q', '--initial-branch=main']);
  git(work, ['remote', 'add', 'origin', origin]);
  if (poison) {
    git(work, ['config', 'push.default', 'upstream']);
    git(work, ['config', 'branch.main.merge', 'refs/heads/main']);
    git(work, ['config', 'branch.main.remote', 'origin']);
  }
  writeFileSync(resolve(work, 'README.md'), 'base\n', 'utf8');
  git(work, ['add', '-A']);
  git(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base']);
  git(work, ['push', '-q', 'origin', 'main']);

  mkdirSync(resolve(work, '.claude', 'hooks'), { recursive: true });
  for (const h of HOOKS) copyFileSync(resolve(HOOKS_DIR, h), resolve(work, '.claude', 'hooks', h));
  return { base, origin, work };
}

function runHook(work, env = {}, hook = 'auto-commit-merge.sh', stdin = '') {
  try {
    execFileSync('bash', [resolve(work, '.claude', 'hooks', hook)], {
      cwd: work, encoding: 'utf8', input: stdin,
      env: { ...process.env, CLAUDE_PROJECT_DIR: work, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (_) { /* l'hook non fallisce mai per contratto */ }
}

/** Il messaggio che una sessione limitata consegna a cap-observe.sh. */
const LIMITE = JSON.stringify({
  hook_event_name: 'StopFailure',
  error_type: 'usage_limit',
  error_message: 'session limit reached',
});

/** SHA locale di un ramo ('' se non esiste). */
function shaOf(work, ref) {
  try { return git(work, ['rev-parse', ref]); } catch (_) { return ''; }
}

function filesOnMain(work) {
  git(work, ['fetch', '-q', 'origin', 'main']);
  return git(work, ['ls-tree', '-r', '--name-only', 'origin/main']).split('\n').filter(Boolean);
}

test.after(() => {
  for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch (_) {} }
});

describe('Via 1 — la sessione si dichiara, non si indovina dal nome del ramo', () => {
  test('una ROUTINE non pubblica sul ramo principale, nemmeno da un ramo dal nome qualsiasi', () => {
    const { work } = scene();
    // Nome fuori da entrambi i prefissi "vietati": è il caso del 24 luglio.
    git(work, ['checkout', '-q', '-b', 'claude/nome-qualsiasi']);
    writeFileSync(resolve(work, 'codice-di-routine.js', ), 'non ancora esaminato\n', 'utf8');

    runHook(work, { FILO_ROUTINE: '1' });

    assert.equal(filesOnMain(work).includes('codice-di-routine.js'), false,
      'il codice di una routine non deve raggiungere il ramo principale senza passare dal cancello');
    // …ma deve essere al sicuro sul suo ramo (durabilità).
    assert.ok(git(work, ['ls-tree', '-r', '--name-only', 'origin/claude/nome-qualsiasi']).includes('codice-di-routine.js'),
      'il lavoro va comunque spedito sul suo ramo: è ciò che lo salva se la sessione viene interrotta');
  });

  test('anche una sessione LOCALE non pubblica a ogni modifica', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/lavoro-locale']);
    writeFileSync(resolve(work, 'lavoro-a-meta.js'), 'meta\n', 'utf8');

    runHook(work); // nessuna marcatura: sessione locale

    assert.equal(filesOnMain(work).includes('lavoro-a-meta.js'), false,
      'una versione viene distribuita agli utenti ogni 6 ore dal ramo principale: non può contenere lavori a metà');
  });

  test('una routine che DIMENTICA di dichiararsi resta comunque contenuta', () => {
    // La marcatura serve a distinguere le provenienze nella storia, ma la
    // sicurezza non deve dipenderne: appenderla a un'istruzione che qualcuno
    // può dimenticare rimetterebbe la protezione in prosa — il guasto del
    // 24 luglio in persona. Qui è il caso peggiore: sul ramo principale, senza
    // marcatura, con una sola cartella di lavoro (la forma delle sessioni cloud).
    const { work } = scene();
    writeFileSync(resolve(work, 'codice-non-esaminato.js'), 'x\n', 'utf8');

    runHook(work); // niente FILO_ROUTINE

    assert.equal(filesOnMain(work).includes('codice-non-esaminato.js'), false,
      'senza cartelle separate non si pubblica mai: al ramo principale ci si arriva solo dal cancello');
  });

  test('il lavoro viene comunque salvato: nessuna modifica resta fuori da git', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/durabilita']);
    writeFileSync(resolve(work, 'importante.js'), 'da non perdere\n', 'utf8');

    runHook(work);

    assert.equal(git(work, ['status', '--porcelain']), '',
      'salvataggio continuo: una sessione interrotta di colpo non deve perdere niente');
  });

  test('la provenienza resta nella storia: routine e locale hanno autori diversi', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/a']);
    writeFileSync(resolve(work, 'a.js'), 'a\n', 'utf8');
    runHook(work, { FILO_ROUTINE: '1' });
    const autoreRoutine = git(work, ['log', '-1', '--format=%an']);

    writeFileSync(resolve(work, 'b.js'), 'b\n', 'utf8');
    runHook(work);
    const autoreLocale = git(work, ['log', '-1', '--format=%an']);

    assert.notEqual(autoreRoutine, autoreLocale,
      'senza distinzione, fra sei mesi "questo codice da dove è arrivato?" non ha risposta');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Il ramo principale non si tocca: né si committa, né si spedisce
//
// La protezione vera sta su GitHub (sul ramo principale scrive solo l'identità
// del server, e un push da questa macchina viene RESPINTO). Ma un automatismo
// che tenta e viene respinto in silenzio è un guasto invisibile — è già
// successo: un ramo che non si salvava più da giorni senza che nessuno lo
// sapesse. E una difesa che dipende da un solo muro cade con quel muro.
// ─────────────────────────────────────────────────────────────────────────────

describe('gli automatismi si astengono sul ramo principale', () => {
  test('il salvataggio NON committa sul ramo principale, e le modifiche restano dove sono', () => {
    const { work } = scene();
    const prima = shaOf(work, 'main');
    writeFileSync(resolve(work, 'non-esaminato.js'), 'codice mai esaminato\n', 'utf8');

    runHook(work);

    assert.equal(shaOf(work, 'main'), prima,
      'un lavoro fatto sul ramo principale non ha modo di arrivare agli utenti: non deve nemmeno essere committato lì');
    assert.match(git(work, ['status', '--porcelain']), /non-esaminato\.js/,
      'astenersi non vuol dire buttare via: la modifica deve restare nella cartella, pronta da spostare su un ramo di lavoro');
  });

  test("il salvataggio NON spedisce il ramo principale, nemmeno con FILO_MAIN_BRANCH avvelenata", () => {
    // La guardia stava appesa a una variabile d'ambiente
    // (`TARGET_BRANCH="${FILO_MAIN_BRANCH:-main}"`): bastava esportarne una
    // perché "sei sul ramo principale" diventasse falso, e il passo che
    // spedisce spedisse il ramo principale. A ogni singola modifica.
    const { work, origin } = scene({ poison: true });
    const prima = git(origin, ['rev-parse', 'main']);
    writeFileSync(resolve(work, 'dirottato.js'), 'x\n', 'utf8');

    runHook(work, { FILO_MAIN_BRANCH: 'un-ramo-che-non-esiste' });

    assert.equal(git(origin, ['rev-parse', 'main']), prima,
      'il nome del ramo principale non si prende dall\'ambiente quando serve a decidere una guardia');
  });

  test('il diagnostico dei limiti NON spedisce il ramo principale, e non ci committa sopra', () => {
    const { work, origin } = scene({ poison: true });
    const primaLocale = shaOf(work, 'main');
    const primaOrigin = git(origin, ['rev-parse', 'main']);

    runHook(work, {}, 'cap-observe.sh', LIMITE);

    assert.equal(git(origin, ['rev-parse', 'main']), primaOrigin,
      'spediva il ramo corrente senza chiedersi quale fosse: sul ramo principale non si spedisce');
    assert.equal(shaOf(work, 'main'), primaLocale,
      'e nemmeno ci si committa sopra');
  });

  test('il diagnostico si astiene ma la nota NON si perde: resta scritta nella cartella', () => {
    const { work } = scene();

    runHook(work, {}, 'cap-observe.sh', LIMITE);

    const nota = readFileSync(resolve(work, '.claude', 'cap-observations.jsonl'), 'utf8');
    assert.match(nota, /usage_limit/,
      'il motivo per cui questo hook esiste è registrare che una sessione è stata tagliata: astenersi dal git non deve cancellare l\'osservazione');
  });
});

describe('…ma su un ramo di lavoro continuano a fare il loro mestiere', () => {
  test('il salvataggio committa E spedisce: la punta locale e quella su origin coincidono', () => {
    // È l'assert che protegge dal rimedio peggiore del male: una guardia
    // scritta larga che smette di salvare anche il lavoro vero.
    const { work } = scene({ poison: true });
    git(work, ['checkout', '-q', '-b', 'claude/lavoro']);
    writeFileSync(resolve(work, 'importante.js'), 'da non perdere\n', 'utf8');

    runHook(work);

    assert.equal(git(work, ['status', '--porcelain']), '', 'il lavoro deve essere salvato');
    git(work, ['fetch', '-q', 'origin', 'claude/lavoro']);
    assert.equal(shaOf(work, 'origin/claude/lavoro'), shaOf(work, 'claude/lavoro'),
      'il trasporto del lavoro: se il ramo non arriva su origin, verifica e server guardano una versione vecchia');
  });

  test('HEAD staccata: il paracadute locale resta (si committa, non si spedisce)', () => {
    // La guardia riguarda LA LINEA PRINCIPALE, non "tutto ciò che non è un ramo
    // di lavoro". Le cartelle a HEAD staccata sono la forma che usano le
    // sessioni isolate: lì il commit locale è l'unica rete che hanno, e
    // toglierla sarebbe un rimedio peggiore del male. Spedire invece non si
    // può: non c'è nessun ramo dove far atterrare il lavoro.
    const { work } = scene();
    const staccato = git(work, ['rev-parse', 'HEAD']);
    git(work, ['checkout', '-q', '--detach', staccato]);
    writeFileSync(resolve(work, 'sessione-isolata.js'), 'x\n', 'utf8');

    runHook(work);

    assert.equal(git(work, ['status', '--porcelain']), '',
      'una sessione interrotta di colpo non deve perdere il lavoro nemmeno a HEAD staccata');
    assert.notEqual(git(work, ['rev-parse', 'HEAD']), staccato, 'il commit deve esserci');
    assert.equal(shaOf(work, 'origin/main'), staccato,
      'e non deve essere finito sul ramo principale di origin');
  });

  test('il diagnostico registra E spedisce il suo ramo', () => {
    const { work } = scene({ poison: true });
    git(work, ['checkout', '-q', '-b', 'claude/diagnostica']);

    runHook(work, {}, 'cap-observe.sh', LIMITE);

    git(work, ['fetch', '-q', 'origin', 'claude/diagnostica']);
    assert.equal(shaOf(work, 'origin/claude/diagnostica'), shaOf(work, 'claude/diagnostica'),
      'in cloud il container è effimero: se l\'osservazione non arriva su origin, al giro dopo non esiste più');
    assert.match(git(work, ['show', '--name-only', '--format=', 'HEAD']), /cap-observations\.jsonl/,
      'l\'osservazione deve essere finita nel commit, non solo nella cartella');
  });
});
