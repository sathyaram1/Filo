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
//   cima ai Ricevuti della dashboard di gestione). Serve una persona davanti
//   allo schermo, su una superficie diversa da questo terminale: è l'unica
//   cosa che una sessione catturata non può procurarsi da sola.
//
//   Qui i compiti sono due. DIRLO bene (messageForOwnerMerge in
//   scripts/lib/owner-merge.mjs): l'esito porta il nome della richiesta aperta,
//   e il messaggio nomina dove approvarla invece di fermarsi al blocco. E
//   SUONARE IL CAMPANELLO: se quella pagina è già aperta non si accorgerebbe
//   di niente, perché l'elenco lo legge solo quando la si apre. Una riga qui e
//   l'avviso compare sotto gli occhi di chi lo sta aspettando
//   (src/main/services/mergeApprovalSignal.js).

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

/**
 * La BASE del confronto per scegliere gli spec mirati. PURA.
 *
 * Il confronto DEVE partire dallo stato REMOTO della linea principale: su una
 * macchina col ref locale rimasto indietro (feedback #508: 455 commit), il
 * diff col ref locale contiene il lavoro degli ALTRI già pubblicato, e la
 * selezione lancia decine di spec estranei — coi loro rossi (158 spec invece
 * di 1). Stessa logica, stesso motivo, del diff per il secaudit in
 * scripts/dispatch.mjs.
 *
 * Se il fetch fallisce (rete assente) si ripiega su quel che c'è, ma la
 * `note` va stampata: un ripiego silenzioso è indistinguibile dal difetto.
 */
export function resolveDiffBase({ fetchOk, remoteRefOk }) {
  if (remoteRefOk) {
    return {
      base: `origin/${MAIN}`,
      note: fetchOk ? '' : 'Non raggiungo origin: confronto il lavoro con l\'ultima copia scaricata della linea principale, che potrebbe essere indietro.',
    };
  }
  return {
    base: MAIN,
    note: 'Non ho una copia remota della linea principale: confronto con quella locale, che su questa macchina può essere molto indietro. Se partono più spec del previsto, è per questo.',
  };
}

/**
 * Il messaggio che ferma la chiusura quando il ramo è rimasto indietro
 * rispetto alla linea principale. '' = via libera. PURA.
 *
 * Fermarsi QUI, prima dei controlli, è il punto (caso #500): un conflitto di
 * fusione scoperto dopo 15 minuti di spec, o dopo l'approvazione dell'owner,
 * costa un giro intero; scoperto adesso costa cinque secondi. Un conteggio
 * illeggibile non blocca: la guardia non inventa conflitti.
 *
 * Con `--check` non si ferma: nessuna fusione segue, quindi non c'è un
 * conflitto da scoprire in anticipo — e chi verifica in locale ha proprio
 * quel comando al posto della suite intera; fermarlo mentre la linea
 * principale si muove (succede ogni giorno, con le fusioni del server) lo
 * mandava a far ripartire la verifica che era già in corso (giro 3 di
 * suite-locale). Il ramo indietro si dice comunque, come nota:
 * `behindMainNota`.
 */
export function behindMainStop(behind, { checkOnly = false } = {}) {
  const n = Number(behind);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (checkOnly) return '';
  return [
    `Il ramo è indietro di ${n} commit rispetto alla linea principale: chiedere la fusione così`,
    'finisce in conflitto alla fine, a controlli già pagati.',
    'Riallinealo rifacendo la verifica, che se ne occupa da sola in partenza:',
    '  node scripts/verify-local.mjs start "<cosa aveva chiesto l\'owner>"',
  ].join('\n');
}

/** La stessa informazione, quando non ferma (`--check`). '' = ramo pari. PURA. */
export function behindMainNota(behind) {
  const n = Number(behind);
  if (!Number.isFinite(n) || n <= 0) return '';
  return [
    `▸ Il ramo è indietro di ${n} commit rispetto alla linea principale. Coi soli controlli non importa`,
    '  (nessuna fusione segue); `npm run finish` invece si fermerebbe qui. Lo riallinea la prossima',
    '  verifica in partenza (node scripts/verify-local.mjs start).',
  ].join('\n');
}

/**
 * Gli spec Playwright che toccano le aree modificate dal branch. Puro.
 *
 * Gli spec della suite portano il nome di una FUNZIONALITÀ, non di un modulo:
 * `tab-archive`, `options-default-models`, `feedback-attach-files`. Uno spec
 * col nome intero dell'area (`tests/tabs`, `tests/options`) quasi mai esiste:
 * col solo nome intero, 12 file sorgente su 254 trovavano uno spec (giro 3 di
 * suite-locale), e toccare la pagina delle opzioni non lanciava nessuno dei
 * nove `options-*`. Quindi, se si passa l'elenco degli spec tracciati, si
 * prendono anche quelli il cui nome comincia con l'area seguita da un
 * trattino (e col singolare: `tabs` → `tab-*`). Restano pochi: la mediana è
 * quattro spec per area, il massimo una trentina — minuti, non le quasi
 * sette ore della suite intera sulla macchina di chi sviluppa Filo.
 */
export function specsForChangedFiles(changed, tracked) {
  const files = Array.isArray(changed) ? changed : [];
  const specs = new Set();
  // Le aree toccate, nella forma in cui uno spec le nomina: minuscolo
  // (`translatepage`), a trattini (`translate-page`) e la prima parola di un
  // nome composto (`editorNotes` → `editor`: le note dell'Editor le provano
  // gli spec `editor-*`). L'esatto per nome (`tests/<area>`) vale sempre;
  // i prefissi solo con l'elenco degli spec tracciati.
  const esatte = new Set();
  const aree = new Set();
  const aggiungi = (nome) => {
    const grezzo = String(nome || '');
    if (!grezzo) return;
    esatte.add(grezzo.toLowerCase());
    aree.add(grezzo.toLowerCase());
    const kebab = grezzo.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    aree.add(kebab);
    const prima = kebab.split('-')[0];
    if (prima !== kebab && prima.length >= 4) aree.add(prima);
  };
  for (const f of files) {
    const m = f.match(/^src\/pages\/([^/]+)\//);
    if (m) aggiungi(m[1]);
    const p = f.match(/^src\/(?:shared|content|renderer|main)\/([^/.]+)/);
    if (p) aggiungi(p[1]);
    // Un handler, un provider o un servizio in una cartella sua ha un nome
    // suo (chat, downloads, safebrowse…): vale come area.
    const h = f.match(/^src\/main\/services\/(?:handlers|providers)\/([^/.]+)/);
    if (h) aggiungi(h[1]);
    const d = f.match(/^src\/main\/services\/([^/.]+)\//);
    if (d && !['handlers', 'providers'].includes(d[1])) aggiungi(d[1]);
    if (f.startsWith('tests/') && f.endsWith('.spec.mjs')) specs.add(f.replace(/\.spec\.mjs$/, ''));
  }
  const elenco = Array.isArray(tracked) ? tracked : [];
  const tracciati = new Set(elenco.map((t) => String(t).replace(/\\/g, '/').replace(/\.spec\.mjs$/, '')));
  // Senza elenco si risponde per nome (chi chiama filtra); con l'elenco si
  // rispondono solo spec che esistono davvero.
  for (const area of esatte) if (!elenco.length || tracciati.has(`tests/${area}`)) specs.add(`tests/${area}`);
  if (elenco.length && aree.size) {
    const prefissi = new Set();
    for (const area of aree) {
      if (tracciati.has(`tests/${area}`)) specs.add(`tests/${area}`);
      prefissi.add(`${area}-`);
      prefissi.add(`${area}s-`);
      const singolare = area.replace(/s$/, '');
      if (singolare.length >= 3 && singolare !== area) prefissi.add(`${singolare}-`);
    }
    for (const t of elenco) {
      const b = String(t).replace(/\\/g, '/').replace(/\.spec\.mjs$/, '');
      const nome = b.replace(/^tests\//, '');
      if (nome.includes('/')) continue; // le prove dei giri (tests/verifica/…) si lanciano per numero
      if ([...prefissi].some((p) => nome.startsWith(p))) specs.add(b);
    }
  }

