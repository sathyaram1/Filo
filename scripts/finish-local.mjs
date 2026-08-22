// finish-local.mjs — chiude un lavoro LOCALE e lo pubblica, una volta sola.
//
// PERCHÉ ESISTE (spec: ROUTINE-BRANCH-INTEGRITY.md §Sessioni locali)
//   Fino al 2026-08-07 una sessione locale pubblicava sul ramo principale a
//   OGNI modifica di file. Tre conseguenze, tutte reali:
//
//   1. Una versione viene costruita e distribuita agli utenti ogni 6 ore,
//      prendendo il ramo principale così com'è. Se la fotografia cadeva a metà
//      sessione, agli utenti arrivava un lavoro incompleto — un file rinominato
//      e chi lo usa ancora no.
//   2. Ogni pubblicazione sposta il ramo principale sotto i piedi delle routine
//      in corso: le loro spedizioni venivano rifiutate, e soprattutto il
//      cancello di sicurezza giudicava una fotografia diversa da quella che poi
//      veniva fusa.
//   3. Il ramo principale conteneva stati intermedi che non erano mai stati
//      pensati come "finiti".
//
//   La durabilità (salvare e spedire il proprio ramo a ogni modifica) resta:
//   è ciò che ha salvato il lavoro di questa stessa sessione dopo due
//   interruzioni. A cambiare è solo QUANDO si arriva al ramo principale: una
//   volta, quando il lavoro è finito, e dopo i controlli.
//
// USO:
//   node scripts/finish-local.mjs                 # controlli + richiesta di fusione
//   node scripts/finish-local.mjs --check         # solo i controlli
//
//   La scorciatoia --no-verify NON esiste più (SPEC-RIDISEGNO-MAX.md §8): la
//   verifica indipendente non si salta — un controllo che si può saltare
//   finisce saltato proprio nei casi in cui serviva.
//
// LA FUSIONE NON LA FA PIÙ QUESTA MACCHINA (SPEC-RIDISEGNO-MAX.md §10)
//   Fino al 2026-08-20 questo script fondeva e pubblicava da qui, con le
//   credenziali dell'owner. Ma su questa macchina gira un LLM che legge testo
//   scritto da sconosciuti: finché una credenziale capace di scrivere sul ramo
//   principale vive qui, il cancello di sicurezza è aggirabile senza convincere
//   nessuno — basta spingere il ramo principale.
//
//   Adesso il ramo si SPEDISCE e la fusione si CHIEDE al server, che scarica
//   lui il diff, fa girare i controlli deterministici e fonde con un'identità
//   propria (una GitHub App).
//
//   DOV'È IL MURO: su GitHub, non su questa macchina. Le credenziali per fare
//   un push da qui esistono ancora; è la regola di protezione del repo a
//   respingere chiunque non sia l'identità del server (provato: un push diretto
//   su main da questa macchina viene rifiutato). Le guardie qui sotto non sono
//   quindi il muro — sono la seconda difesa: un automatismo che tenta e viene
//   respinto in silenzio è un guasto invisibile, e una protezione appesa a un
//   muro solo cade con quel muro.
//
//   I controlli locali e la verifica indipendente restano identici, e restano
//   obbligatori: sono quelli che dicono se il lavoro è finito. Il server non
//   li rifà e non ci crede — controlla altro.
//
// SE IL SERVER BLOCCA, NON È UN VICOLO CIECO (SPEC-RIDISEGNO-MAX.md §10)
//   I controlli deterministici del server fermano chi tocca le aree protette
//   (guardie, automatismi, regole del database, chiavi, dipendenze nuove) — e
//   il lavoro locale ci cade dentro quasi sempre, perché in locale si lavora
//   proprio su quelle cose. Da qui non si aggirano, e su main da questa
//   macchina non scrive nessuno: senza una via d'uscita quel lavoro non
//   arriverebbe mai agli utenti.
//
//   La via d'uscita non è un permesso in più per questo script: il server APRE
//   UNA RICHIESTA IN ATTESA, e l'owner la approva DENTRO FILO (l'avviso in
//   cima alla prima schermata, o Gestione → Automazioni). Serve una persona
//   davanti allo schermo, su una superficie diversa da questo terminale: è
//   l'unica cosa che una sessione catturata non può procurarsi da sola.
//
//   Qui i compiti sono due. DIRLO bene (messageForOwnerMerge in
//   scripts/lib/owner-merge.mjs): l'esito porta il nome della richiesta aperta,
//   e il messaggio nomina dove approvarla invece di fermarsi al blocco. E
//   SUONARE IL CAMPANELLO: se Filo è già aperto — cioè quasi sempre, è il
//   browser — la sua prima schermata non si accorgerebbe di niente, perché
//   l'elenco lo legge solo quando la si apre. Una riga qui e l'avviso compare
//   sotto gli occhi di chi lo sta aspettando (src/main/services/
//   mergeApprovalSignal.js).

import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdictForCurrentBranch } from './verify-local.mjs';
import { askServerMerge, messageForOwnerMerge, exitCodeForOwnerMerge } from './lib/owner-merge.mjs';
import mergeApprovalSignal from '../src/main/services/mergeApprovalSignal.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// IL NOME DEL RAMO PRINCIPALE NON SI PRENDE DALL'AMBIENTE.
//   Qui è una GUARDIA, e una guardia che si sposta con una variabile non è una
//   guardia: bastava esportarne una perché "sei sul ramo principale" diventasse
//   falso, e il passo che spedisce il ramo spedisse il ramo principale con le
//   credenziali di questa macchina — prima ancora di parlare col server, cioè
//   scavalcando l'intero cancello. Il valore è inchiodato qui.
const MAIN = 'main';
// I nomi che questa macchina non spedisce MAI, qualunque cosa dica chiunque.
// `master` c'è perché il repo potrebbe cambiare convenzione senza che questo
// file lo sappia: la guardia sbaglia in direzione sicura.
const RAMI_PROTETTI = Object.freeze(['main', 'master']);

/**
 * Questo ramo è il ramo principale (di qualunque nome)? PURA.
 *
 * `defaultBranch` è quello che il repo dice essere il default di origin: si
 * aggiunge ai nomi inchiodati, non li sostituisce — se qualcuno riuscisse a
 * raccontare un default diverso, la guardia proteggerebbe comunque main e
 * master. Un nome vuoto o illeggibile conta come protetto: nel dubbio non si
 * spedisce.
 */
export function isProtectedBranch(name, defaultBranch = '') {
  const norm = (s) => String(s || '').trim()
    .replace(/^refs\/heads\//, '').replace(/^origin\//, '').toLowerCase();
  const b = norm(name);
  if (!b || b === 'head') return true;
  const d = norm(defaultBranch);
  return RAMI_PROTETTI.includes(b) || (!!d && b === d);
}

/**
 * GLI ARGOMENTI PER SPEDIRE UN RAMO SU ORIGIN. PURA.
 *
 * `git push origin <ramo>` dice a git COSA spedire ma non DOVE: la
 * destinazione la sceglie la configurazione locale. Con
 * `push.default=upstream` (o `tracking`) e `branch.<ramo>.merge=refs/heads/main`
 * — che git imposta DA SÉ quando un ramo nasce da origin/main, quindi è già
 * così su ogni ramo di lavoro di questo repo — quella riga scrive su
 * refs/heads/main mentre il nome del ramo resta innocuo e OGNI guardia qui
 * sopra passa: le guardie validano il nome della partenza, non l'arrivo.
 * Riprodotto: `d5fb818..160af59  claude/innocuo -> main`. Stessa cosa con un
 * `remote.origin.push` avvelenato. Sono `git config`: un file non versionato,
 * nessuna credenziale, invisibile a chi guarda il diff.
 *
 * Il refspec sorgente:destinazione PIENAMENTE QUALIFICATO toglie la scelta alla
 * configurazione — è la forma già usata da scripts/lib/branch-integrity.mjs.
 * La guardia sul nome resta (è giusta, era solo insufficiente) e vale anche
 * qui: da questa macchina il ramo principale non si spedisce mai, comunque lo
 * si chiami e da qualunque punto si chiami questa funzione.
 */
export function pushArgs(branch) {
  if (!branch || isProtectedBranch(branch)) {
    throw new Error(`spedizione rifiutata: '${branch}' non è un ramo di lavoro`);
  }
  return ['push', 'origin', `refs/heads/${branch}:refs/heads/${branch}`];
}

function git(args, opts = {}) {
  try {
    // stderr CATTURATO, non a schermo: quando una lettura fallisce l'esito lo
    // gestiamo qui sotto, e il `fatal:` di git a video sembrava un guasto senza
    // esserlo (il caso tipico: origin/HEAD non impostato).
    return { ok: true, out: execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim() };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`.trim() || e.message };
  }
}

/** Il ramo di default di origin secondo il repo ('' se non lo sa). */
function defaultBranch() {
  const r = git(['rev-parse', '--abbrev-ref', 'origin/HEAD']);
  return r.ok ? r.out : '';
}

function run(cmd, args, label) {
  process.stdout.write(`\n▸ ${label}\n`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  return r.status === 0;
}

/** Gli spec Playwright che toccano le aree modificate dal branch. Puro. */
export function specsForChangedFiles(changed) {
  const files = Array.isArray(changed) ? changed : [];
  const specs = new Set();
  for (const f of files) {
    // Uno spec che porta il nome della cosa toccata è il candidato ovvio;
    // meglio pochi mirati che l'intera suite (~25 minuti).
    const m = f.match(/^src\/pages\/([^/]+)\//);
    if (m) specs.add(`tests/${m[1]}`);
    const p = f.match(/^src\/(?:shared|content|renderer|main)\/([^/.]+)/);
    if (p) specs.add(`tests/${p[1].toLowerCase()}`);
    if (f.startsWith('tests/') && f.endsWith('.spec.mjs')) specs.add(f.replace(/\.spec\.mjs$/, ''));
  }
  return [...specs];
}

async function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  if (argv.includes('--no-verify')) {
    console.error('La scorciatoia --no-verify non esiste più: i controlli e la verifica');
    console.error('indipendente girano sempre (SPEC-RIDISEGNO-MAX.md §8).');
    process.exit(1);
  }

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out;
  if (!branch || branch === 'HEAD') { console.error('Stato del repo non chiaro: nessun ramo corrente.'); process.exit(1); }
  // Lavorare direttamente sul ramo principale non ha più senso: da questa
  // macchina su main non scrive più nessuno, quindi un lavoro fatto lì non ha
  // nessun modo di arrivare agli utenti. Meglio dirlo adesso che dopo mezz'ora
  // di controlli verdi seguiti da un rifiuto.
  const principale = defaultBranch();
  if (isProtectedBranch(branch, principale)) {
    console.error(`Sei su '${branch}', e da qui sul ramo principale non scrive più nessuno: la fusione`);
    console.error('la fa il server, e fonde un RAMO. Sposta il lavoro in una cartella dedicata:');
    console.error('  git worktree add .claude/worktrees/<nome> -b claude/<nome>');
    process.exit(1);
  }

  if (!git(['diff', '--quiet']).ok || !git(['diff', '--cached', '--quiet']).ok) {
    console.error('Ci sono modifiche non salvate: falle salvare (un Edit qualsiasi) prima di chiudere.');
    process.exit(1);
  }

  {
    // 1. Logica pura — veloce, nessuna finestra che si apre.
    if (!run('npm', ['run', 'test:unit'], 'Controlli di logica')) {
      console.error('\n✗ Controlli di logica rossi: non pubblico. Sistema e rilancia.');
      process.exit(1);
    }
    // 2. Spec mirati alle aree toccate. La suite completa gira nel cancello di
    //    pubblicazione e nelle routine: qui serve il segnale rapido.
    const changed = git(['diff', '--name-only', `${MAIN}...HEAD`]).out.split('\n').filter(Boolean);
    // `--error-unmatch` stampa un errore su stderr per ogni spec inesistente:
    // il filtro funzionava, ma a schermo sembrava un guasto. Chiediamo invece
    // l'elenco degli spec tracciati e filtriamo in memoria.
    const tracked = new Set(git(['ls-files', 'tests/*.spec.mjs']).out.split('\n').filter(Boolean));
    const specs = specsForChangedFiles(changed).filter((s) => tracked.has(`${s}.spec.mjs`));
    if (specs.length) {
      const args = ['playwright', 'test', ...specs.map((s) => `${s}.spec.mjs`)];
      if (!run('npx', args, `Spec delle aree toccate (${specs.length})`)) {
        console.error('\n✗ Spec rossi: non pubblico. Sistema e rilancia.');
        process.exit(1);
      }
    } else {
      console.log('\n(nessuno spec mirato per le aree toccate: il lavoro verrà comunque ricontrollato prima della pubblicazione agli utenti)');
    }
  }

  // 3. La VERIFICA avversariale: un'istanza diversa da chi ha scritto il codice
  //    ha provato a romperlo, senza vedere il diff. È l'unico controllo che
  //    trova i lavori "verdi ma sbagliati": i test qui sopra li ha scritti chi
  //    ha fatto il lavoro, quindi hanno i suoi stessi punti ciechi. In cloud
  //    questo passaggio c'è da sempre; qui mancava, e si pubblicava senza.
  {
    const v = verdictForCurrentBranch(ROOT);
    if (!v.ok) {
      console.error(`\n✗ Verifica mancante o non superata: ${v.reason}`);
      console.error('  Non pubblico. Per farla partire:');
      console.error('    node scripts/verify-local.mjs start "<cosa aveva chiesto l\'owner>"');
      console.error('  poi consegna il testo stampato a un\'ISTANZA NUOVA (non a te stesso:');
      console.error('  chi ha scritto il codice non può verificarlo), e lascia che registri');
      console.error('  l\'esito.');
      process.exit(1);
    }
    console.log(`\n▸ Verifica indipendente: superata su ${v.entry?.sha?.slice(0, 8) || '—'}`);
  }

  if (checkOnly) { console.log('\n✓ Controlli passati (--check: non chiedo la fusione).'); return; }

  // 4. Il ramo dev'essere SU ORIGIN: il server fonde ciò che vede lui, non ciò
  //    che c'è su questo disco. L'hook di salvataggio di solito l'ha già
  //    spedito, ma se per qualsiasi motivo non è andato, il server guarderebbe
  //    una versione vecchia — o un ramo che per lui non esiste.
  const cur = git(['rev-parse', 'HEAD']).out;
  {
    // Ultimo controllo prima dell'unica riga di questo script che scrive su
    // origin: qualunque cosa sia successa sopra, quello che si spedisce non
    // può essere il ramo principale. È una guardia doppia, e va bene così: è
    // l'unico punto in cui questa macchina potrebbe scrivere sul ramo da cui
    // si costruiscono le versioni degli utenti.
    if (isProtectedBranch(branch, principale)) {
      console.error(`\n✗ '${branch}' è il ramo principale: da qui non si spedisce.`);
      process.exit(1);
    }
    // La DESTINAZIONE è dichiarata dentro pushArgs: non la sceglie la
    // configurazione locale di git (vedi il commento lì sopra).
    const pushed = git(pushArgs(branch));
    if (!pushed.ok) {
      console.error(`\n✗ Non riesco a spedire '${branch}':\n${pushed.out.slice(0, 300)}`);
      console.error('  Senza il ramo su origin il server non ha niente da fondere.');
      process.exit(1);
    }
    // L'esito di questa lettura VA GUARDATO: se `origin/<ramo>` non si risolve,
    // `out` è il testo dell'errore di git, e finiva stampato all'utente come se
    // fosse uno sha ("è a origin/c"). Un ramo appena spedito che origin non
    // mostra è un guasto vero, non un dettaglio: si ferma.
    const rem = git(['rev-parse', `origin/${branch}`]);
    if (!rem.ok) {
      console.error(`\n✗ Ho spedito '${branch}' ma su origin non lo trovo:\n${rem.out.slice(0, 300)}`);
      console.error('  Il server non avrebbe la versione appena controllata.');
      process.exit(1);
    }
    if (rem.out !== cur) {
      console.error(`\n✗ Su origin '${branch}' è a ${rem.out.slice(0, 8)}, qui siamo a ${cur.slice(0, 8)}.`);
      console.error('  Il server fonderebbe una versione diversa da quella controllata.');
      process.exit(1);
    }
  }

  // 5. La fusione la CHIEDE, non la fa: su main scrive solo il server, con
  //    un'identità che qui non esiste. Lo sha lega la richiesta esattamente al
  //    codice appena controllato.
  process.stdout.write('\n▸ Chiedo al server di fondere\n');
  const reply = await askServerMerge({ branch, sha: cur });
  // Il server ha aperto una richiesta: suona il campanello, così una finestra
  // di Filo GIÀ APERTA se ne accorge da sola. Non è un permesso in più — non
  // crea niente e non approva niente, fa solo rileggere l'elenco vero — ed è
  // l'unica cosa che impedisce all'avviso di cui parla il messaggio qui sotto
  // di comparire soltanto a chi apre una scheda nuova.
  if (reply?.outcome === 'blocked' && reply.requestId) mergeApprovalSignal.note(reply.requestId);
  const code = exitCodeForOwnerMerge(reply);
  const message = messageForOwnerMerge(reply, branch);
  if (code === 0) console.log(`\n${message}`);
  else console.error(`\n${message}`);
  process.exit(code);
}

const isMainModule = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
// Un guasto imprevisto deve FERMARE, non finire in un errore che nessuno legge:
// senza questo, una promessa rifiutata uscirebbe con un codice che sembra un ok.
if (isMainModule) main().catch((e) => { console.error(`\n✗ ${(e && e.message) || e}`); process.exit(1); });
