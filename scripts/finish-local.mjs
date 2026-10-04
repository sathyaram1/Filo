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
// SE IL SERVER BLOCCA (SPEC-RIDISEGNO-MAX.md §10, #908)
//   I controlli deterministici del server fermano chi tocca le aree protette, e
//   il lavoro locale ci cade quasi sempre. Con la pratica (`--feedback`, o il
//   feedbackId che `verify-local.mjs start --feedback` scrive nel ramo) il server
//   rilegge il feedback: un lavoro locale col mittente provato si fonde senza
//   chiedere, i blocchi restano registrati e la pratica si chiude. Senza pratica
//   qui non si parte (senzaPraticaStop); con una non ammessa il server apre una
//   richiesta che aspetta il sì dell'owner in Gestione. Qui si dice bene (messageForOwnerMerge) e si suona il
//   campanello per la pagina già aperta (src/main/services/mergeApprovalSignal.js).

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdictForCurrentBranch, readState } from './verify-local.mjs';
import { askServerMerge, messageForOwnerMerge, exitCodeForOwnerMerge } from './lib/owner-merge.mjs';
import { preparaLancioElectron } from './lib/schermo-virtuale.mjs';
import { lottiPerRigaDiComando } from './lib/riga-di-comando.mjs';
import { readMarker } from './lib/routine-role.mjs';
import { partiServerInSospeso } from './lib/parti-lavoro.mjs';
import { chiediConProva, pulisciResti, gitIn } from './lib/unit-sulla-fusione.mjs';
import { cartellaDelServer } from './server-fondi-pratica.mjs';
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

function run(cmd, args, label, env = undefined) {
  process.stdout.write(`\n▸ ${label}\n`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...(env ? { env } : {}) });
  return r.status === 0;
}

/**
 * Il commit da cui prendere ANCHE i file cambiati, in un giro di riallineamento: quello che
 * aveva passato la verifica, scritto da dispatch nel marcatore del ruolo. '' altrimenti. PURA.
 * Il ramo contro main non vede il lato arrivato da main né il file in conflitto.
 */
export function shaDelRiallineamento(marker) {
  const m = marker && typeof marker === 'object' ? marker : {};
  const sha = String(m.dal || '').trim();
  return m.role === 'verifier' && /^[0-9a-f]{7,40}$/i.test(sha) ? sha : '';
}

/**
 * I file da cui scegliere gli spec: il ramo contro `base` e, in un giro di riallineamento, anche
 * quelli cambiati dal commit verificato alla punta. `{ changed, nota }`; la nota va stampata.
 */
export function cambiatiPerLaScelta({ base, marker, root = ROOT }) {
  const g = (args) => git(args, { cwd: root });
  const changed = g(['diff', '--name-only', `${base}...HEAD`]).out.split('\n').filter(Boolean);
  const dal = shaDelRiallineamento(marker);
  if (!dal) return { changed, nota: '' };
  const c = g(['cat-file', '-e', `${dal}^{commit}`]).ok || g(['fetch', 'origin', dal]).ok;
  const r = c ? g(['diff', '--name-only', dal, 'HEAD']) : { ok: false };
  if (!r.ok) {
    return { changed, nota: `Giro di riallineamento, ma il commit verificato ${dal.slice(0, 8)} qui non c'è: scelgo gli spec solo dal ramo contro main, e il lato arrivato da main resta scoperto.` };
  }
  const lato = r.out.split('\n').filter(Boolean);
  return {
    changed: [...new Set([...changed, ...lato])],
    nota: `Giro di riallineamento: scelgo gli spec anche dai ${lato.length} file cambiati da ${dal.slice(0, 8)} (il commit verificato) alla punta, cioè il lato arrivato da main e i file in conflitto.`,
  };
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
 * Il messaggio che ferma la chiusura quando il ramo è indietro rispetto alla
 * linea principale E la fusione andrebbe in conflitto. '' = via libera. PURA.
 *
 * Un conflitto scoperto dopo 15 minuti di spec o dopo l'approvazione costa un
 * giro (caso #500); ma fermarsi per un ramo solo indietro non chiudeva mai: con
 * le routine accese main riceve decine di commit l'ora, e il server fonde lo
 * stesso se non c'è conflitto. `prova` è l'esito di provaFusione: senza (git
 * vecchio, prova fallita) ci si ferma come prima, e lo si dice. Un conteggio
 * illeggibile non blocca: la guardia non inventa conflitti. Con `--check` non
 * segue nessuna fusione, quindi non si ferma mai (nota: `behindMainNota`).
 */
export function behindMainStop(behind, { checkOnly = false, prova = null } = {}) {
  const n = Number(behind);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (checkOnly) return '';
  const conflitti = prova && Array.isArray(prova.conflitti) ? prova.conflitti : null;
  if (conflitti && !conflitti.length) return '';
  return [
    conflitti
      ? `Il ramo è indietro di ${n} commit rispetto alla linea principale, e la fusione andrebbe in conflitto su:`
      : `Il ramo è indietro di ${n} commit rispetto alla linea principale: chiedere la fusione così`,
    ...(conflitti ? conflitti.map((f) => `  · ${f}`) : ['può finire in conflitto alla fine, a controlli già pagati.']),
    ...(!conflitti && prova && prova.motivo ? [`(Non ho potuto provare la fusione senza toccare l'albero: ${prova.motivo}. Mi fermo come se ci fosse un conflitto.)`] : []),
    'Riallinealo rifacendo la verifica, che se ne occupa da sola in partenza:',
    '  node scripts/verify-local.mjs start "<cosa aveva chiesto l\'owner>"',
  ].join('\n');
}

/** Il ramo indietro quando non ferma: coi soli controlli, o senza conflitti. '' = ramo pari. PURA. */
export function behindMainNota(behind, { checkOnly = true } = {}) {
  const n = Number(behind);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (!checkOnly) {
    return `▸ Il ramo è indietro di ${n} commit rispetto alla linea principale, ma la fusione non va in conflitto: proseguo.`;
  }
  return [
    `▸ Il ramo è indietro di ${n} commit rispetto alla linea principale. Coi soli controlli non importa`,
    '  (nessuna fusione segue); `npm run finish` si fermerebbe qui solo se la fusione andasse in conflitto.',
  ].join('\n');
}

/** Da `git version` a sì/no su `merge-tree --write-tree` (git 2.38). PURA. */
export function gitSaProvareFusione(versione) {
  const m = /(\d+)\.(\d+)/.exec(String(versione || ''));
  if (!m) return false;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj > 2 || (maj === 2 && min >= 38);
}

/**
 * L'uscita di `git merge-tree --write-tree --name-only --no-messages`: exit 0 = pulita, 1 = conflitti,
 * elencati dopo la riga dell'albero. Altro = la prova non è riuscita. PURA.
 */
export function leggiMergeTree(status, stdout) {
  if (status === 0) return { conflitti: [] };
  if (status !== 1) return { motivo: `git merge-tree è uscito con ${status}` };
  const righe = String(stdout || '').split(/\r?\n/);
  const file = [];
  for (const r of righe.slice(1)) {
    if (!r.trim()) break;
    if (!file.includes(r.trim())) file.push(r.trim());
  }
  return file.length ? { conflitti: file } : { motivo: 'git merge-tree segnala un conflitto ma non dice su quali file' };
}

/** Prova la fusione di HEAD con `base` senza toccare albero né indice. */
export function provaFusione(base, root = ROOT) {
  const v = spawnSync('git', ['version'], { cwd: root, encoding: 'utf8' });
  if (!gitSaProvareFusione(v.stdout)) {
    return { motivo: `${String(v.stdout || 'git').trim() || 'git'} non sa provarla (serve git 2.38 o più)` };
  }
  const r = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', '--no-messages', base, 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (r.error) return { motivo: r.error.message };
  return leggiMergeTree(r.status, r.stdout);
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
 * trattino (e col singolare: `tabs` → `tab-*`). L'area la dà sia la cartella
 * (una pagina, un handler, un servizio con la cartella sua) sia il NOME del
 * file, in qualunque cartella di src stia: senza il nome, i servizi che stanno
 * direttamente in src/main/services, gli stili, i preload e lo shim non
 * lanciavano niente (giro 4 di suite-locale: 36 file con spec e zero scelti).
 * Restano pochi: la mediana è quattro spec per area, il massimo una trentina —
 * minuti, non le quasi sette ore della suite intera sulla macchina di chi
 * sviluppa Filo.
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
    // Il NOME del file, in qualunque cartella di src stia: i servizi che
    // stanno direttamente in src/main/services (adblock, cookies, downloads,
    // terminal, geoBlock…), i fogli di stile, i preload, lo shim di chrome, la
    // config. Le regole per cartella qui sopra li saltavano tutti, e 19 dei 39
    // servizi non lanciavano niente pur avendo uno spec col loro stesso nome
    // (giro 4 di suite-locale). Il nome di un file è l'area che prova.
    const n = f.match(/^src\/(?:[^/]+\/)*([^/.]+)\.[^/]+$/);
    if (n) aggiungi(n[1]);
    // Uno spec toccato si lancia; una prova di un giro no, si lancia per numero
    // (un ramo che ne sposta o ne ritocca qualcuna ne trascinerebbe centinaia).
    if (f.startsWith('tests/') && !f.startsWith('tests/verifica/') && f.endsWith('.spec.mjs')) {
      specs.add(f.replace(/\.spec\.mjs$/, ''));
    }
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
  return [...specs];
}

/**
 * Divide gli spec da lanciare fra quelli che DEVONO essere verdi e quelli
 * rossi anche su main su questa macchina (tests/rossi-noti.json, feedback
 * #563): questi ultimi si lanciano e si mostrano, ma non fermano la
 * pubblicazione. Un rosso d'ambiente spacciato per regressione costa un giro
 * intero; l'elenco è tracciato nel repo, così ogni eccezione ha un nome e una
 * ragione, e svuotarlo è un lavoro con un numero. PURA.
 */
export function splitKnownRed(specs, known) {
  const set = new Set((Array.isArray(known) ? known : []).map((s) => String(s).replace(/\.spec\.mjs$/, '')));
  const blocking = [];
  const informative = [];
  for (const s of specs || []) (set.has(s) ? informative : blocking).push(s);
  return { blocking, informative };
}

/**
 * Cosa fa `--check` della verifica indipendente. PURA.
 *
 * `--check` promette «i controlli e basta»: unit test e spec mirati. Chi lo
 * lancia è spesso proprio l'istanza che sta verificando (la ricetta del
 * verificatore glielo indica al posto della suite intera), e per lei la
 * verifica non può che risultare «avviata senza esito»: è la sua. Farla finire
 * in rosso con «Non pubblico» — dopo controlli tutti verdi — diceva il falso a
 * chi leggeva. Con `--check` l'esito della verifica si STAMPA come nota e non
 * ferma; senza `--check` resta il cancello di sempre: senza verifica superata
 * non si chiede la fusione.
 */
export function esitoVerificaPerCheck({ checkOnly, ok, reason }) {
  if (ok) return { ferma: false, nota: '' };
  if (!checkOnly) return { ferma: true, nota: '' };
  return {
    ferma: false,
    nota: `▸ Verifica indipendente: ${reason || 'non ancora superata'}\n  (--check controlla solo unit test e spec: la verifica serve a \`npm run finish\`, non qui)`,
  };
}

/**
 * Gli spec delle aree toccate si rilanciano, o li ha già corsi chi ha
 * verificato sullo stesso contenuto? PURA.
 *
 * Sono la parte lunga della chiusura (da quindici a quarantacinque minuti), e
 * chi verifica li lancia in partenza per obbligo del suo ruolo: rifarli qui,
 * sullo stesso commit, è la stessa ora pagata due volte. Si saltano solo con un
 * verdetto valido in mano, che è già legato a quel contenuto — senza verifica
 * superata non cambia niente. `--check` non salta mai: promette «i controlli e
 * basta», e chi lo lancia è spesso proprio chi sta verificando.
 *
 * La logica pura NON si salta: le prove del giro che chi verifica committa
 * dopo aver lanciato i controlli passano solo di qui (le sentinelle su quella
 * cartella stanno negli unit test), e costa millisecondi.
 */
export function specDaRilanciare({ checkOnly, ok, sha, tollerato }) {
  if (checkOnly || !ok) return { rilancia: true, nota: '' };
  const dove = String(sha || '').slice(0, 8) || '—';
  return {
    rilancia: false,
    nota: `▸ Spec delle aree toccate: li ha già corsi la verifica indipendente su ${dove}${tollerato ? ' (da lì il ramo si è mosso solo dentro le prove del giro)' : ''}, non li rifaccio.\n  La logica pura gira lo stesso: le prove del giro committate dopo quel controllo passano solo di qui.`,
  };
}

// Con tutto `src` toccato gli spec mirati sono stati 245: in una riga sola `npx` (cmd.exe) moriva prima di partire.
export { lottiPerRigaDiComando };

/** Lancia gli spec a lotti (vedi lottiPerRigaDiComando); tutti i lotti girano, l'esito è l'AND. */
function runSpecsALotti(specs, label) {
  const lotti = lottiPerRigaDiComando(specs.map((s) => `${s}.spec.mjs`));
  let ok = true;
  lotti.forEach((lotto, i) => {
    const suffisso = lotti.length > 1 ? ` — lotto ${i + 1}/${lotti.length}, ${lotto.length} spec` : '';
    const l = preparaLancioElectron('npx', ['playwright', 'test', ...lotto]);
    if (!l.ok || !run(l.cmd, l.args, label + suffisso, l.env)) ok = false;
  });
  return ok;
}

function readKnownRed(root) {
  try {
    const j = JSON.parse(readFileSync(resolve(root, 'tests', 'rossi-noti.json'), 'utf8'));
    return Array.isArray(j.specs) ? j.specs : [];
  } catch (_) { return []; }
}

/**
 * La pratica del lavoro: dall'opzione, o dal ramo in .claude/verify-local.json.
 * Un riferimento che non si risolve ferma tutto: fondere legati alla pratica sbagliata è peggio.
 */
/**
 * Ogni lavoro locale arriva su main con la sua pratica (#908): è il registro dell'owner di cosa fa ogni sessione.
 * Tutte le strade verso main passano di qui, quindi la regola sta qui. PURA. '' = si prosegue.
 */
export function senzaPraticaStop({ checkOnly, pratica }) {
  if (checkOnly || (pratica && pratica.id)) return '';
  return [
    'Questo lavoro non ha la sua pratica, e ogni lavoro locale ne ha una: in Gestione è il registro di cosa fa ogni sessione.',
    'Aprila e legala, poi rilancia:',
    '  npm run feedback:apri -- "<titolo>" "<cosa fa il lavoro>" --locale',
    '  npm run finish -- --feedback <N>',
    'Non ho toccato niente.',
  ].join('\n');
}

/** Perché il finish si ferma dopo la prova degli unit sulla fusione (#929). PURA. */
export function fermoDopoLaProva(prova) {
  const p = prova || {};
  if (p.errore) {
    return `✗ Non ho potuto provare gli unit sul risultato della fusione con main: ${p.errore}.\n`
      + '  Non ho chiesto la fusione. Il ramo è spedito e intatto: rilancia npm run finish.';
  }
  return '✗ Gli unit sono rossi sul risultato della fusione con main, e su main da solo no: non ho chiesto la fusione.\n'
    + '  Riallinea il ramo (git merge origin/main, o rebase), fai tornare verdi i test elencati sopra e rilancia npm run finish.';
}

async function praticaDelLavoro(valore) {
  const branchCorrente = git(['rev-parse', '--abbrev-ref', 'HEAD']).out;
  const scritta = (readState()[branchCorrente] || {});
  if (valore === null || valore === undefined) {
    return scritta.feedbackId ? { id: String(scritta.feedbackId), seq: scritta.feedbackNum || null } : null;
  }
  const { risolviFeedback } = await import('./lib/pratica-locale.mjs');
  const { acquireBearer, FIRESTORE_BASE } = await import('./lib/firestore-auth.mjs');
  let r;
  let lavorabile = { ok: true };
  try {
    const bearer = await acquireBearer();
    r = await risolviFeedback(valore, { bearer, base: FIRESTORE_BASE });
    if (r.ok) {
      const { praticaPerLaSessione } = await import('./owner-feedback.mjs');
      lavorabile = await praticaPerLaSessione(r.id, { bearer, allaChiusura: true });
    }
  } catch (e) {
    r = { ok: false, motivo: String((e && e.message) || e).slice(0, 200) };
  }
  if (!r.ok) {
    console.error(`Pratica non trovata: ${r.motivo} — non ho toccato niente.`);
    process.exit(1);
  }
  if (!lavorabile.ok) {
    const { rifiutoPratica } = await import('./owner-feedback.mjs');
    console.error(`${rifiutoPratica(r.id, lavorabile)}\nNon ho legato il lavoro a questa pratica e non ho toccato niente.`);
    process.exit(1);
  }
  if (scritta.feedbackId && scritta.feedbackId !== r.id) {
    console.error(`  (il ramo era legato a un'altra pratica, ${scritta.feedbackNum ? '#' + scritta.feedbackNum : scritta.feedbackId}: vale quella indicata adesso)`);
  }
  return r;
}

async function main() {
  const argv = process.argv.slice(2);
  // Un aiuto vero: senza, QUALUNQUE argomento (`--help` compreso) faceva
  // partire l'intera chiusura, e chi voleva solo sapere cosa fa lo strumento
  // si ritrovava dentro la procedura (feedback #565).
  const AIUTO = [
    'Uso: npm run finish [-- --check] [-- --feedback <N>]',
    '',
    '  (nessun argomento)   chiude il lavoro: controlli, verifica, richiesta di fusione',
    '  --check              esegue i controlli e si ferma prima di chiedere la fusione',
    '                       (con npm: `npm run finish -- --check`, oppure `npm run finish:check`)',
    '  --feedback <N>       la pratica di questo lavoro (numero o id): senza, quella scritta da',
    '                       verify-local start --feedback. Senza nessuna delle due non si chiude.',
    '                       Un lavoro locale provato, o approvato da te, non aspetta il sì.',
    '                       Su un feedback di un utente la frase per lui la scrive la sessione:',
    '                       npm run feedback -- <N> --frase "…" (vale anche a pratica chiusa)',
    '  --help               questa schermata',
  ].join('\n');
  if (argv.includes('--help') || argv.includes('-h')) { console.log(AIUTO); return; }
  // Un argomento che non conosciamo NON fa partire la chiusura: prima faceva
  // girare tutto — controlli, verifica e, con la verifica già a posto, il
  // ramo spedito e la fusione chiesta — per un errore di battitura
  // (feedback #565).
  // `npm run finish --check` non arriva qui: npm si prende `--check` come roba
  // sua e lo strumento parte SENZA, cioè spedisce il ramo e chiede la fusione
  // a chi voleva solo i controlli. L'opzione resta scritta nell'ambiente: da
  // lì ce ne accorgiamo e ci fermiamo (feedback #565).
  const { argomentiDaNpm, opzioneStorpiata } = await import('./lib/argomenti.mjs');
  const storpiata = opzioneStorpiata(process.env, ['--check', '--feedback']);
  if (storpiata) {
    console.error(`${storpiata}
`);
    console.error(AIUTO);
    process.exit(1);
  }
  const daNpm = argomentiDaNpm(process.env, { opzioni: ['--check', '--feedback'], conValore: ['--feedback'] });
  if (daNpm.errore) { console.error(daNpm.errore); process.exit(1); }
  if (daNpm.nota) { console.error(daNpm.nota); argv.push(...daNpm.args); }
  // Prima dell'elenco degli sconosciuti: a chi prova la vecchia scorciatoia
  // serve il PERCHÉ, non «argomento sconosciuto» (feedback #565).
  if (argv.includes('--no-verify')) {
    console.error('La scorciatoia --no-verify non esiste più: i controlli e la verifica');
    console.error('indipendente girano sempre (SPEC-RIDISEGNO-MAX.md §8).');
    process.exit(1);
  }
  const { estraiOpzioneFeedback, parseRiferimento } = await import('./lib/pratica-locale.mjs');
  const opzFeedback = estraiOpzioneFeedback(argv);
  if (opzFeedback.errore) { console.error(`${opzFeedback.errore} — non ho toccato niente.`); process.exit(1); }
  if (opzFeedback.valore !== null) {
    const rif = parseRiferimento(opzFeedback.valore);
    if (!rif.ok) { console.error(`${rif.motivo} — non ho toccato niente.`); process.exit(1); }
  }
  const ignoti = opzFeedback.resto.filter((a) => !['--check', '--help', '-h'].includes(a));
  if (ignoti.length) {
    console.error(`Argomento sconosciuto: ${ignoti.join(' ')} — non ho toccato niente.\n`);
    console.error(AIUTO);
    process.exit(1);
  }
  const checkOnly = argv.includes('--check');
  // Un numero sbagliato si scopre adesso, non dopo i controlli.
  const pratica = checkOnly ? null : await praticaDelLavoro(opzFeedback.valore);
  const senza = senzaPraticaStop({ checkOnly, pratica });
  if (senza) { console.error(senza); process.exit(1); }

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
  // Anche con --check, che la prova sulla fusione non la fa: i resti di una prova interrotta non aspettano la prossima.
  pulisciResti({ git: gitIn(ROOT) });

  // La linea principale VERA è su origin: il ref locale può essere indietro di
  // centinaia di commit (vedi resolveDiffBase). Un fetch qui serve a due cose:
  // la base del diff per gli spec mirati e la guardia sul ramo rimasto indietro.
  const fetchOk = git(['fetch', 'origin', MAIN]).ok;
  const remoteRefOk = git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${MAIN}`]).ok;
  const { base, note } = resolveDiffBase({ fetchOk, remoteRefOk });
  if (note) console.log(`\n${note}`);

  {
    const behind = Number(git(['rev-list', '--count', `HEAD..${base}`]).out);
    const prova = !checkOnly && behind > 0 ? provaFusione(base) : null;
    const stop = behindMainStop(behind, { checkOnly, prova });
    if (stop) { console.error(`\n${stop}`); process.exit(1); }
    const nota = behindMainNota(behind, { checkOnly });
    if (nota) console.log(`\n${nota}`);
  }

  // L'esito della verifica si legge PRIMA dei controlli: è lui a dire se gli
  // spec delle aree sono già stati corsi su questo contenuto (il cancello vero
  // resta più sotto, dopo i controlli, dov'è sempre stato).
  const v = verdictForCurrentBranch(ROOT);
  const spec = specDaRilanciare({ checkOnly, ok: v.ok, sha: v.entry && v.entry.sha, tollerato: v.tollerato });

  {
    // Gli spec si scelgono PRIMA dei controlli di logica: se non potranno partire, ci si ferma
    // adesso e non dopo gli unit test.
    if (!spec.rilancia) console.log(`\n${spec.nota}`);
    const scelta = spec.rilancia ? cambiatiPerLaScelta({ base, marker: readMarker(ROOT) }) : { changed: [], nota: '' };
    if (scelta.nota) console.log(`\n${scelta.nota}`);
    const changed = scelta.changed;
    // `--error-unmatch` stampa un errore su stderr per ogni spec inesistente:
    // il filtro funzionava, ma a schermo sembrava un guasto. Chiediamo invece
    // l'elenco degli spec tracciati e filtriamo in memoria.
    const tracked = new Set(git(['ls-files', 'tests/*.spec.mjs']).out.split('\n').filter(Boolean));
    const specs = specsForChangedFiles(changed, [...tracked]).filter((s) => tracked.has(`${s}.spec.mjs`));
    const { blocking, informative } = splitKnownRed(specs, readKnownRed(ROOT));
    if (specs.length) {
      const schermo = preparaLancioElectron('npx', []);
      if (!schermo.ok) { console.error(`\n✗ ${schermo.motivo}`); process.exit(1); }
      if (schermo.nota) console.log(`\n${schermo.nota}`);
    }
    // 1. Logica pura — veloce, nessuna finestra che si apre.
    if (!run('npm', ['run', 'test:unit'], 'Controlli di logica')) {
      console.error('\n✗ Controlli di logica rossi: non pubblico. Sistema e rilancia.');
      process.exit(1);
    }
    // 2. Spec mirati alle aree toccate. La suite completa gira SOLO in GitHub
    //    Actions, a ogni fusione su main: qui serve il segnale rapido.
    if (blocking.length) {
      if (!runSpecsALotti(blocking, `Spec delle aree toccate (${blocking.length})`)) {
        console.error('\n✗ Spec rossi: non pubblico. Sistema e rilancia.');
        process.exit(1);
      }
    }
    if (informative.length) {
      // Rossi noti su questa macchina (tests/rossi-noti.json): si vedono, non
      // fermano. Se uno diventa verde, è ora di toglierlo dall'elenco.
      const ok = runSpecsALotti(informative, `Spec fra i rossi noti (${informative.length}, non bloccano; feedback #563)`);
      console.log(ok
        ? '\n(i rossi noti toccati sono verdi qui: valuta se toglierli da tests/rossi-noti.json)'
        : '\n(rossi noti anche su main su questa macchina: non fermano la pubblicazione)');
    }
    if (spec.rilancia && !specs.length) {
      console.log('\n(nessuno spec mirato per le aree toccate: il lavoro verrà comunque ricontrollato prima della pubblicazione agli utenti)');
    }
  }

  // 3. La VERIFICA avversariale: un'istanza diversa da chi ha scritto il codice
  //    ha provato a romperlo, senza vedere il diff. È l'unico controllo che
  //    trova i lavori "verdi ma sbagliati": i test qui sopra li ha scritti chi
  //    ha fatto il lavoro, quindi hanno i suoi stessi punti ciechi. In cloud
  //    questo passaggio c'è da sempre; qui mancava, e si pubblicava senza.
  {
    const esito = esitoVerificaPerCheck({ checkOnly, ok: v.ok, reason: v.reason });
    if (esito.nota) console.log(`\n${esito.nota}`);
    if (esito.ferma) {
      console.error(`\n✗ Verifica mancante o non superata: ${v.reason}`);
      console.error('  Non pubblico. Per farla partire:');
      console.error('    node scripts/verify-local.mjs start "<cosa aveva chiesto l\'owner>"');
      console.error('  poi consegna il testo stampato a un\'ISTANZA NUOVA (non a te stesso:');
      console.error('  chi ha scritto il codice non può verificarlo), e lascia che registri');
      console.error('  la critica. Un esito vale per il commit su cui è stato dato: se il');
      console.error('  ramo cambia, serve un\'altra verifica (rilancia `start`, senza');
      console.error('  argomenti).');
      process.exit(1);
    }
    if (v.ok) {
      console.log(`\n▸ Verifica indipendente: superata su ${v.entry?.sha?.slice(0, 8) || '—'}`);
      // Il verdetto vale per un commit. Se dopo di lui dalle prove del giro si
      // è solo tolto, regge lo stesso (#661): quando succede si DICE quali file
      // sono passati, perché un cancello che si apre in silenzio è
      // indistinguibile da uno che non c'è.
      if (v.tollerato) {
        console.log(`  Il ramo si è mosso dopo la verifica, ma solo togliendo prove o casi dalle prove del giro: ${(v.files || []).join(', ')}`);
        console.log('  Quello che gira non è cresciuto rispetto al contenuto verificato, quindi il verdetto regge.');
      }
    }
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
  //    codice appena controllato; la prova degli unit sulla fusione (#929) la
  //    lega al main su cui sono girati.
  // La parte del server dello stesso lavoro (ramo con lo stesso nome) non ancora su main tiene aperta la pratica (#915).
  const pendingParts = pratica && pratica.id ? partiServerInSospeso(branch, { cartellaServer: cartellaDelServer(ROOT) }) : [];
  const giro = await chiediConProva({
    root: ROOT, punta: cur,
    fermaSe: (p) => !!(p.errore || p.esito === 'rosso_sulla_fusione'),
    chiedi: (provaUnit) => {
      process.stdout.write('\n▸ Chiedo al server di fondere\n');
      if (pratica && pratica.id) console.log(`  pratica ${pratica.seq ? `#${pratica.seq}` : pratica.id}`);
      else console.log('  nessuna pratica collegata: se i controlli fermano, la fusione aspetta il tuo sì');
      for (const p of pendingParts) console.log(`  parte del server non ancora su main: ${p.branch} (la pratica resta aperta per lei)`);
      return askServerMerge({ branch, sha: cur, feedbackId: pratica ? pratica.id : '', pendingParts, provaUnit });
    },
    mainMosso: (r) => !!(r && r.outcome === 'main_moved'),
    scrivi: (s) => console.log(`\n${s}`),
  });
  if (giro.fermo) {
    console.error(`\n${fermoDopoLaProva(giro.prova)}`);
    process.exit(1);
  }
  const reply = giro.reply;
  // Il server ha aperto una richiesta: suona il campanello, così una finestra
  // di Filo GIÀ APERTA se ne accorge da sola. Non è un permesso in più — non
  // crea niente e non approva niente, fa solo rileggere l'elenco vero — ed è
  // l'unica cosa che impedisce all'avviso di cui parla il messaggio qui sotto
  // di comparire soltanto a chi apre una scheda nuova.
  if (reply?.outcome === 'blocked' && reply.requestId) mergeApprovalSignal.note(reply.requestId);
  const code = exitCodeForOwnerMerge(reply);
  const message = messageForOwnerMerge(reply, branch, { feedbackId: pratica ? pratica.id : '', feedbackNum: pratica ? pratica.seq : '' });
  if (code === 0) console.log(`\n${message}`);
  else console.error(`\n${message}`);
  if (pratica && pratica.id) {
    const { fraseDaScrivere } = await import('./owner-feedback.mjs');
    const frase = await fraseDaScrivere(pratica.id, pratica.seq ? `#${pratica.seq}` : pratica.id);
    if (frase) console.log(`\n${frase}`);
  }
  process.exit(code);
}

const isMainModule = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
// Un guasto imprevisto deve FERMARE, non finire in un errore che nessuno legge:
// senza questo, una promessa rifiutata uscirebbe con un codice che sembra un ok.
if (isMainModule) main().catch((e) => { console.error(`\n✗ ${(e && e.message) || e}`); process.exit(1); });
