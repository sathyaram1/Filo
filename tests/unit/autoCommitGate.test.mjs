// Chi può pubblicare sul ramo principale — spec: ROUTINE-BRANCH-INTEGRITY.md §Via 1
//
// L'assert che conta: dopo che l'automatismo di salvataggio ha girato, il ramo
// principale remoto NON deve contenere il codice appena scritto. Prima del
// 2026-08-07 lo conteneva — bastava che il ramo avesse un nome fuori
// dall'elenco dei prefissi vietati, e il codice usciva a ogni singola modifica
// saltando verifica e cancello di sicurezza.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { rmSync, writeFileSync, readFileSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

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
  const base = cartellaTemporanea('filo-hook-');
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
  // Chi lancia i test NON deve poter dichiarare la sessione al posto del test.
  // Una routine si dichiara con FILO_ROUTINE=1 nella sua shell, e quella
  // variabile arrivava fin qui: il caso "locale" ereditava la dichiarazione, i
  // due autori diventavano lo stesso, e il controllo sulla provenienza era rosso
  // per tutta la durata di ogni giro di routine — un rosso che parlava di chi
  // lanciava il test, non del codice. La dichiarazione entra solo da `env`.
  const ambiente = { ...process.env };
  delete ambiente.FILO_ROUTINE;
  try {
    execFileSync('bash', [resolve(work, '.claude', 'hooks', hook)], {
      cwd: work, encoding: 'utf8', input: stdin,
      env: { ...ambiente, CLAUDE_PROJECT_DIR: work, ...env },
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

// ─── La spedizione non tace (giro del 14/09/2026) ────────────────────────────
//
// Il push era `>/dev/null 2>&1 || true`: dopo un rebase git lo rifiutava e
// l'hook non diceva niente. Il ramo su origin restava vecchio e il cancello del
// server rileggeva lo stesso conflitto all'infinito.

/** Come runHook, ma restituisce lo stderr: è lì che l'hook deve parlare. */
function runHookStderr(work, env = {}) {
  const ambiente = { ...process.env };
  delete ambiente.FILO_ROUTINE;
  const r = spawnSync('bash', [resolve(work, '.claude', 'hooks', 'auto-commit-merge.sh')], {
    cwd: work, encoding: 'utf8', input: '',
    env: { ...ambiente, CLAUDE_PROJECT_DIR: work, ...env },
  });
  return String(r.stderr || '');
}

/** Commit di un file col nome dato, sul ramo corrente (solo quello: con
 * `add -A` finivano nel commit anche gli hook copiati, e un `reset --hard`
 * dopo li cancellava). */
function commitFile(work, name, content = 'x\n') {
  writeFileSync(resolve(work, name), content, 'utf8');
  git(work, ['add', name]);
  git(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', name]);
}

describe('la spedizione non tace: storia divergente e push fallito', () => {
  test('storia riscritta da un rebase: il ramo arriva comunque su origin (--force-with-lease)', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/rebase']);
    // Il ramo era già su origin con un commit A…
    commitFile(work, 'a.js');
    git(work, ['push', '-q', 'origin', 'claude/rebase']);
    const a = shaOf(work, 'claude/rebase');
    // …poi la storia locale viene riscritta: A sparisce, al suo posto un
    // commit nuovo (è la forma di un rebase). Origin ha A, la copia locale no.
    git(work, ['reset', '-q', '--hard', 'HEAD~1']);
    writeFileSync(resolve(work, 'b.js'), 'dopo il rebase\n', 'utf8');

    const stderr = runHookStderr(work);

    git(work, ['fetch', '-q', 'origin', 'claude/rebase']);
    assert.notEqual(shaOf(work, 'claude/rebase'), a);
    assert.equal(shaOf(work, 'origin/claude/rebase'), shaOf(work, 'claude/rebase'),
      'dopo un rebase il ramo su origin deve essere quello riscritto, non quello vecchio: altrimenti il cancello rilegge lo stesso conflitto per sempre');
    assert.ok(git(work, ['ls-tree', '-r', '--name-only', 'origin/claude/rebase']).includes('b.js'));
    assert.doesNotMatch(stderr, /NON e' arrivato/, 'nessun allarme quando la spedizione riesce');
  });

  test('qualcun altro ha spinto nel frattempo: il lease rifiuta, e l\'hook lo dice', () => {
    const { base, origin, work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/conteso']);
    commitFile(work, 'a.js');
    git(work, ['push', '-q', 'origin', 'claude/conteso']);
    // Un'altra copia spinge B sopra A: la copia locale non lo sa (origin/… è fermo ad A).
    const altro = resolve(base, 'altro');
    git(base, ['clone', '-q', origin, altro]);
    git(altro, ['checkout', '-q', 'claude/conteso']);
    commitFile(altro, 'di-un-altro.js');
    git(altro, ['push', '-q', 'origin', 'claude/conteso']);
    const b = git(altro, ['rev-parse', 'HEAD']);
    // Intanto qui la storia viene riscritta.
    git(work, ['reset', '-q', '--hard', 'HEAD~1']);
    writeFileSync(resolve(work, 'c.js'), 'riscritto\n', 'utf8');

    const stderr = runHookStderr(work);

    assert.equal(git(work, ['ls-remote', origin, 'refs/heads/claude/conteso']).split(/\s/)[0], b,
      'il lavoro di un altro non deve essere sovrascritto: il lease è contro il ref conosciuto, e qui non combacia');
    assert.match(stderr, /claude\/conteso.*NON e' arrivato su origin/, 'un push che non arriva si dice, non si tace');
    assert.match(stderr, /force-with-lease/);
  });

  test('origin irraggiungibile: il commit resta come paracadute e la riga di log c\'è, col motivo di git', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/isolato']);
    git(work, ['remote', 'set-url', 'origin', resolve(work, 'non-esiste.git')]);
    writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');

    const stderr = runHookStderr(work);

    assert.equal(git(work, ['status', '--porcelain']), '', 'il salvataggio locale resta');
    assert.match(stderr, /'claude\/isolato' NON e' arrivato su origin: .+/, 'una riga con il ramo e il motivo di git');
    assert.match(stderr, /non-esiste|does not appear|repository/i, 'il motivo è quello di git, non una frase generica');
  });

  // Claude Code manda stderr di un hook uscito con 0 al solo registro di
  // debug: la riga qui sopra la sessione non la vede (giro del 14/09,
  // verifica). L'unico canale da un hook PostToolUse alla sessione è un JSON
  // su stdout con additionalContext: è lì che il fallimento deve arrivare.
  function runHookRaw(work, stdin) {
    const ambiente = { ...process.env };
    delete ambiente.FILO_ROUTINE;
    return spawnSync('bash', [resolve(work, '.claude', 'hooks', 'auto-commit-merge.sh')], {
      cwd: work, encoding: 'utf8', input: stdin, env: { ...ambiente, CLAUDE_PROJECT_DIR: work },
    });
  }

  test('un push fallito arriva alla SESSIONE: JSON su stdout con additionalContext, uscita 0', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/isolato-2']);
    git(work, ['remote', 'set-url', 'origin', resolve(work, 'non-esiste.git')]);
    writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');

    const r = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Write' }));

    assert.equal(r.status, 0, 'l\'hook non fallisce mai per contratto');
    const righe = String(r.stdout || '').split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
    assert.equal(righe.length, 1, `una riga JSON su stdout, trovato: «${r.stdout}»`);
    const json = JSON.parse(righe[0]);
    assert.equal(json.hookSpecificOutput.hookEventName, 'PostToolUse', 'il nome dell\'evento è quello letto da stdin');
    assert.match(json.hookSpecificOutput.additionalContext, /claude\/isolato-2.*NON e' arrivato su origin/);
    assert.match(json.hookSpecificOutput.additionalContext, /non-esiste|does not appear|repository/i, 'col motivo di git');
    assert.match(json.hookSpecificOutput.additionalContext, /committato in locale ma NON e' su origin/, 'e con quello che c\'è da fare');
    assert.match(String(r.stderr || ''), /NON e' arrivato su origin/, 'la riga su stderr resta, per il registro di debug');
  });

  test('senza stdin (lanciato a mano) l\'evento è PostToolUse; quando la spedizione riesce stdout resta vuoto', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/liscio']);
    writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');
    const ok = runHookRaw(work, '');
    assert.equal(ok.status, 0);
    assert.equal(String(ok.stdout || '').trim(), '', 'niente contesto a ogni salvataggio andato bene');

    git(work, ['remote', 'set-url', 'origin', resolve(work, 'non-esiste.git')]);
    writeFileSync(resolve(work, 'altro.js'), 'y\n', 'utf8');
    const ko = runHookRaw(work, '');
    const json = JSON.parse(String(ko.stdout || '').split(/\r?\n/).find((l) => l.trim().startsWith('{')));
    assert.equal(json.hookSpecificOutput.hookEventName, 'PostToolUse');
  });
});

// ─── Giro 2 della verifica (16/09/2026): il lease dopo un fetch ─────────────
describe('il rinvio dopo un rebase non calpesta il lavoro degli altri nemmeno dopo un fetch', () => {
  test('un altro ha spinto e questa copia lo ha scaricato con un fetch: il rinvio viene rifiutato e origin resta suo', () => {
    const { base, origin, work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/fetch']);
    commitFile(work, 'a.js');
    git(work, ['push', '-q', 'origin', 'claude/fetch']);
    const altro = resolve(base, 'altro');
    git(base, ['clone', '-q', origin, altro]);
    git(altro, ['checkout', '-q', 'claude/fetch']);
    commitFile(altro, 'di-un-altro.js');
    git(altro, ['push', '-q', 'origin', 'claude/fetch']);
    const b = git(altro, ['rev-parse', 'HEAD']);
    // Il fetch porta origin/claude/fetch al commit dell'altro: un lease «nudo» combacerebbe.
    git(work, ['fetch', '-q', 'origin']);
    git(work, ['reset', '-q', '--hard', 'HEAD~1']);
    writeFileSync(resolve(work, 'c.js'), 'riscritto\n', 'utf8');

    const stderr = runHookStderr(work);

    assert.equal(git(work, ['ls-remote', origin, 'refs/heads/claude/fetch']).split(/\s/)[0], b,
      'il commit dell\'altro deve restare su origin anche se questa copia lo aveva già scaricato');
    assert.match(stderr, /claude\/fetch.*NON e' arrivato su origin/);
  });
});

// ─── Nel mezzo di un conflitto l'hook si astiene ─────────────────────────────
//
// Giro del 14/09/2026, terza verifica: un rebase (o una fusione) fermo su un
// conflitto, l'agente risolve UN file con un Edit, l'hook riparte e `git add
// -A` mette in commit anche i file ancora in conflitto, coi segni <<<<<<<
// dentro. Nel rebase spariva il commit che si stava riportando; nella fusione
// il commit rotto arrivava su origin. Ora l'hook non tocca niente finché
// l'operazione è a metà.

const SEGNI = /^<{7}|^={7}$|^>{7}/m;

/** Un ramo di lavoro spedito su origin e main che diverge sugli stessi due file. */
function sceneConflitto() {
  const { work, origin } = scene();
  git(work, ['config', 'core.autocrlf', 'false']);
  git(work, ['checkout', '-q', '-b', 'claude/prova']);
  writeFileSync(resolve(work, 'a.txt'), 'mio\n', 'utf8');
  writeFileSync(resolve(work, 'b.txt'), 'mio\n', 'utf8');
  git(work, ['add', '-A']);
  git(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'mio']);
  git(work, ['push', '-q', '-u', 'origin', 'claude/prova']);
  git(work, ['checkout', '-q', 'main']);
  writeFileSync(resolve(work, 'a.txt'), 'loro\n', 'utf8');
  writeFileSync(resolve(work, 'b.txt'), 'loro\n', 'utf8');
  git(work, ['add', '-A']);
  git(work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'loro']);
  git(work, ['checkout', '-q', 'claude/prova']);
  return { work, origin };
}

describe('nel mezzo di un conflitto l\'hook si astiene', () => {
  test('rebase fermo su un conflitto: niente commit coi segni, il rebase resta a metà e il commit riportato conserva il suo nome', () => {
    const { work } = sceneConflitto();
    const reb = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'rebase', 'main'], { cwd: work, encoding: 'utf8' });
    assert.notEqual(reb.status, 0, 'il rebase deve fermarsi sul conflitto');
    const prima = shaOf(work, 'HEAD');
    writeFileSync(resolve(work, 'a.txt'), 'risolto\n', 'utf8');
    runHook(work);
    assert.equal(shaOf(work, 'HEAD'), prima, 'durante il rebase l\'hook non deve committare');
    assert.ok(git(work, ['ls-files', '-u']).includes('b.txt'), 'b.txt è ancora in conflitto, come deve');
    // Chi ha iniziato il rebase lo finisce, e il commit arriva col suo nome.
    writeFileSync(resolve(work, 'b.txt'), 'risolto\n', 'utf8');
    git(work, ['add', '-A']);
    const cont = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'rebase', '--continue'], { cwd: work, encoding: 'utf8', env: { ...process.env, GIT_EDITOR: 'true' } });
    assert.equal(cont.status, 0, cont.stderr);
    assert.equal(git(work, ['log', '--format=%s', '-1']), 'mio');
    assert.doesNotMatch(git(work, ['show', 'HEAD:b.txt']), SEGNI);
  });

  test('fusione ferma su due conflitti: dopo l\'Edit sul primo file la fusione resta aperta e su origin non arriva niente', () => {
    const { work, origin } = sceneConflitto();
    const m = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', 'main'], { cwd: work, encoding: 'utf8' });
    assert.notEqual(m.status, 0, 'la fusione deve fermarsi sul conflitto');
    const prima = shaOf(work, 'HEAD');
    const suOriginPrima = git(origin, ['rev-parse', 'claude/prova']);
    writeFileSync(resolve(work, 'a.txt'), 'risolto\n', 'utf8');
    runHook(work);
    assert.equal(shaOf(work, 'HEAD'), prima, 'durante la fusione l\'hook non deve committare');
    assert.ok(git(work, ['rev-parse', '--verify', '-q', 'MERGE_HEAD']), 'la fusione deve restare aperta');
    assert.equal(git(origin, ['rev-parse', 'claude/prova']), suOriginPrima, 'su origin non deve arrivare niente');
    assert.doesNotMatch(git(origin, ['show', 'claude/prova:b.txt']), SEGNI);
  });
});

// ─── Giro 4 della verifica (16/09/2026): il no del remoto e l'astensione ────
//
// Due cose che la sessione deve sentire, e un JSON che deve restare leggibile
// qualunque cosa scriva il remoto.
describe('il no del server remoto e l\'astensione arrivano alla sessione, in un JSON che si legge', () => {
  function runHookRaw(work, stdin) {
    const ambiente = { ...process.env };
    delete ambiente.FILO_ROUTINE;
    return spawnSync('bash', [resolve(work, '.claude', 'hooks', 'auto-commit-merge.sh')], {
      cwd: work, encoding: 'utf8', input: stdin, env: { ...ambiente, CLAUDE_PROJECT_DIR: work },
    });
  }
  const rigaJson = (r) => String(r.stdout || '').split(/\r?\n/).find((l) => l.trim().startsWith('{'));

  /** Da qui in poi origin rifiuta ogni push, con un messaggio che finisce in ritorno carrello e porta virgolette e tab. */
  function originRifiuta(origin) {
    const f = resolve(origin, 'hooks', 'pre-receive');
    writeFileSync(f, '#!/bin/sh\nprintf "GH013: push declined due to repository rule violations\\r\\nsecondo \\"motivo\\" con\\ttab\\n" >&2\nexit 1\n', 'utf8');
    chmodSync(f, 0o755);
  }

  test('un ritorno carrello nel messaggio del remoto non rompe il JSON: il contesto arriva, col messaggio', () => {
    const { origin, work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/regola']);
    originRifiuta(origin);
    // Piu' corse: git lascia passare il ritorno carrello a seconda di come
    // spezza i pacchetti del remoto, e la porta si apriva una volta su poche.
    for (let i = 0; i < 3; i += 1) {
      writeFileSync(resolve(work, 'lavoro.js'), `x${i}\n`, 'utf8');
      const r = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse' }));
      assert.equal(r.status, 0);
      const riga = rigaJson(r);
      assert.ok(riga, `una riga JSON su stdout, trovato: «${r.stdout}»`);
      let json;
      assert.doesNotThrow(() => { json = JSON.parse(riga); }, 'il contesto deve restare un JSON valido anche con caratteri di controllo nel messaggio di git');
      const ctx = json.hookSpecificOutput.additionalContext;
      assert.doesNotMatch(ctx, /[\x00-\x08\x0b-\x1f]/, 'nessun carattere di controllo nella stringa');
      assert.match(ctx, /GH013/);
      assert.match(ctx, /secondo "motivo"/);
      assert.match(ctx, /committato in locale ma NON e' su origin/, 'la coda che dice di spedire resta');
    }
  });

  test('un rifiuto del remoto per una regola non e\' «storia divergente»: si dice per quello che e\', senza consigliare un rebase', () => {
    const { origin, work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/regola-2']);
    originRifiuta(origin);
    writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');
    const r = runHookRaw(work, '');
    const ctx = JSON.parse(rigaJson(r)).hookSpecificOutput.additionalContext;
    assert.match(ctx, /server remoto ha RIFIUTATO/, 'la diagnosi giusta');
    assert.doesNotMatch(ctx, /Storia divergente|qualcun altro ha spinto/i, 'non e\' storia divergente e un rebase non lo cura');
    assert.match(ctx, /GH013/, 'col motivo del remoto');
    assert.doesNotMatch(String(r.stderr || ''), /force-with-lease/, 'il lease non si tenta: il remoto direbbe di no lo stesso');
  });

  test('a meta\' di una fusione l\'astensione arriva alla sessione, senza la coda che dice di spedire', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/conflitto']);
    commitFile(work, 'a.txt', 'mio\n');
    git(work, ['checkout', '-q', 'main']);
    commitFile(work, 'a.txt', 'loro\n');
    git(work, ['checkout', '-q', 'claude/conflitto']);
    const m = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', 'main'], { cwd: work, encoding: 'utf8' });
    assert.match(String(m.stdout) + String(m.stderr), /CONFLICT/, 'la fusione deve fermarsi su un conflitto vero');
    assert.notEqual(m.status, 0, 'la fusione si ferma sul conflitto');
    writeFileSync(resolve(work, 'a.txt'), 'risolto\n', 'utf8');
    const prima = git(work, ['rev-parse', 'HEAD']);
    const r = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse' }));
    assert.equal(r.status, 0);
    assert.equal(git(work, ['rev-parse', 'HEAD']), prima, 'niente commit a meta\' fusione');
    const riga = rigaJson(r);
    assert.ok(riga, `l'astensione deve arrivare alla sessione su stdout, trovato: «${r.stdout}»`);
    const ctx = JSON.parse(riga).hookSpecificOutput.additionalContext;
    assert.match(ctx, /a meta'/, 'dice che c\'e\' un rebase o una fusione a meta\'');
    assert.match(ctx, /NON committo/);
    assert.doesNotMatch(ctx, /committato in locale ma NON e' su origin/, 'qui non c\'e\' niente di committato da spedire');
  });
});

// ─── Giro 5 della verifica (16/09/2026): due rilievi messi da parte ──────────
//
// (1) Quando è il COMMIT a non riuscire (index.lock a terra, pre-commit che
// rifiuta) l'hook taceva: /dev/null su add e commit. (2) L'hook gira su tutte
// le cartelle di lavoro e diceva i guai delle ALTRE con le parole di un
// problema tuo: la sessione andava a finire il rebase di qualcun altro.
describe('un commit che non riesce, e i guai delle altre cartelle, arrivano alla sessione', () => {
  function runHookRaw(work, stdin) {
    const ambiente = { ...process.env };
    delete ambiente.FILO_ROUTINE;
    return spawnSync('bash', [resolve(work, '.claude', 'hooks', 'auto-commit-merge.sh')], {
      cwd: work, encoding: 'utf8', input: stdin, env: { ...ambiente, CLAUDE_PROJECT_DIR: work },
    });
  }
  const rigaJson = (r) => String(r.stdout || '').split(/\r?\n/).find((l) => l.trim().startsWith('{'));
  const contesto = (r) => {
    const riga = rigaJson(r);
    assert.ok(riga, `il contesto deve arrivare alla sessione su stdout, trovato: «${r.stdout}» / stderr: «${r.stderr}»`);
    return JSON.parse(riga).hookSpecificOutput.additionalContext;
  };

  test('index.lock a terra: niente commit, e la sessione lo sa col motivo di git', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/lock']);
    writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');
    writeFileSync(resolve(work, '.git', 'index.lock'), '', 'utf8');
    const prima = git(work, ['rev-parse', 'HEAD']);
    const r = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse', cwd: work }));
    assert.equal(r.status, 0, 'l\'hook non fallisce mai per contratto');
    assert.equal(git(work, ['rev-parse', 'HEAD']), prima, 'niente commit');
    const ctx = contesto(r);
    assert.match(ctx, /NON sono state committate/);
    assert.match(ctx, /index\.lock/, 'col motivo di git');
    assert.doesNotMatch(ctx, /committato in locale ma NON e' su origin/, 'non c\'e\' niente di committato da spedire');
    assert.doesNotMatch(ctx, /non la tua/, 'e\' la cartella della sessione');
  });

  test('pre-commit che rifiuta: niente commit, e la sessione legge il perche\' del rifiuto', () => {
    const { work } = scene();
    git(work, ['checkout', '-q', '-b', 'claude/precommit']);
    writeFileSync(resolve(work, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "rifiuto: manca la firma XYZ" >&2\nexit 1\n', 'utf8');
    chmodSync(resolve(work, '.git', 'hooks', 'pre-commit'), 0o755);
    writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');
    const prima = git(work, ['rev-parse', 'HEAD']);
    const r = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse', cwd: work }));
    assert.equal(r.status, 0);
    assert.equal(git(work, ['rev-parse', 'HEAD']), prima, 'niente commit');
    const ctx = contesto(r);
    assert.match(ctx, /NON sono state committate/);
    assert.match(ctx, /manca la firma XYZ/, 'col testo del pre-commit');
    assert.doesNotMatch(ctx, /committato in locale ma NON e' su origin/);
  });

  test('una fusione a meta\' in un\'ALTRA cartella si dice come altrui, in una riga, senza ordini; nella propria come oggi', () => {
    const { work, base } = scene();
    git(work, ['config', 'core.autocrlf', 'false']);
    const altra = resolve(base, 'altra');
    git(work, ['worktree', 'add', '-q', altra, '-b', 'claude/altra']);
    commitFile(altra, 'a.txt', 'mio\n');
    commitFile(work, 'a.txt', 'loro\n');
    const m = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', 'main'], { cwd: altra, encoding: 'utf8' });
    assert.notEqual(m.status, 0, 'la fusione nell\'altra cartella si ferma sul conflitto');
    git(work, ['checkout', '-q', '-b', 'claude/mia']);
    writeFileSync(resolve(work, 'lavoro.js'), 'x\n', 'utf8');

    // La sessione sta in `work`: il guaio di `altra` e' altrui.
    const r = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse', cwd: work }));
    assert.equal(r.status, 0);
    assert.equal(shaOf(work, 'claude/mia'), git(work, ['rev-parse', 'HEAD']));
    assert.equal(git(work, ['ls-remote', 'origin', 'refs/heads/claude/mia']).split(/\s/)[0], git(work, ['rev-parse', 'HEAD']), 'il proprio lavoro si salva e si spedisce');
    const ctx = contesto(r);
    const righe = ctx.split('\n').filter((l) => /altra/.test(l));
    assert.equal(righe.length, 1, `un guaio altrui e' UNA riga, trovato: «${ctx}»`);
    assert.match(righe[0], /un'altra cartella di lavoro, non la tua: '.*altra'/);
    assert.match(righe[0], /a meta'/);
    assert.doesNotMatch(ctx, /Finiscilo|NON committo/, 'mai come ordini, mai come un problema tuo');
    assert.doesNotMatch(ctx, /committato in locale ma NON e' su origin/, 'la coda che dice di spedire riguarda solo la propria cartella');

    // La sessione sta in `altra`: lo stesso guaio e' suo, con le parole di oggi.
    const r2 = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse', cwd: altra }));
    const ctx2 = contesto(r2);
    assert.match(ctx2, /a meta'/);
    assert.match(ctx2, /NON committo/);
    assert.doesNotMatch(ctx2, /non la tua/);
  });

  test('senza il campo cwd nello stdin ogni cartella e\' «tua», com\'era prima', () => {
    const { work, base } = scene();
    git(work, ['config', 'core.autocrlf', 'false']);
    const altra = resolve(base, 'altra');
    git(work, ['worktree', 'add', '-q', altra, '-b', 'claude/altra2']);
    commitFile(altra, 'a.txt', 'mio\n');
    commitFile(work, 'a.txt', 'loro\n');
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'merge', 'main'], { cwd: altra, encoding: 'utf8' });
    const r = runHookRaw(work, JSON.stringify({ hook_event_name: 'PostToolUse' }));
    const ctx = contesto(r);
    assert.match(ctx, /non la tua: '.*altra'/);
    assert.doesNotMatch(ctx, /NON committo/);
  });
});

describe('gli agganci arrivano a chi clona il repo adesso', () => {
  // Un hook che nessun file registrato accende non gira sulle macchine che il
  // repo lo clonano (i contenitori delle routine), e nessuno se ne accorge.
  test('un file tracciato registra il salvataggio automatico e la guardia del ramo', () => {
    const tracciati = git(ROOT, ['ls-files']).split('\n').filter((f) => /\.json$/.test(f));
    const testi = tracciati.map((f) => {
      try { return readFileSync(resolve(ROOT, f), 'utf8'); } catch (_) { return ''; }
    });
    for (const hook of [...HOOKS, 'branch-guard.sh']) {
      assert.ok(testi.some((t) => t.includes(hook)),
        `nessun file registrato in git accende ${hook}: su un clone nuovo non parte, in silenzio`);
    }
  });
});
