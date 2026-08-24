// tools-pin.mjs — gli strumenti del giro NON vivono sul ramo che il giro lavora.
//
// IL GUASTO CHE TOGLIE (24 agosto)
//   Un giro di routine scarica la versione aggiornata del progetto, ma appena si
//   mette al lavoro sposta la cartella sul ramo di QUEL feedback. Da quel
//   momento ogni file del progetto è quello del ramo: strumenti del giro e
//   ricette dei ruoli compresi. Un ramo aperto due giorni prima si porta dietro
//   gli strumenti di due giorni prima.
//
//   Costo osservato: il battito automatico, aggiunto il 23, non esisteva sul
//   ramo del 22. Il secondo lavoratore del giro ha eseguito lo strumento
//   vecchio, che quel battito non lo avvia. Nessun errore, nessuna traccia: quel
//   codice semplicemente non fa quella cosa. Quaranta minuti di suite in
//   silenzio, il server ha dato il giro per morto e ne ha acceso un altro sopra,
//   e alla consegna il lavoro è stato rifiutato. Un'ora persa, per la seconda
//   volta in tre giorni, con la correzione già in produzione.
//
//   È una categoria, non un caso: lo strumento che SORVEGLIA il lavoro è la
//   stessa cosa che il lavoro MODIFICA. Ogni ritocco agli strumenti non varrà
//   per i rami già aperti, oggi e ogni volta in futuro.
//
// IL RIMEDIO
//   Il preflight — che gira per primo, sulla versione aggiornata, prima che
//   qualunque ramo venga aperto — COPIA gli strumenti e le ricette fuori dal
//   progetto. Da lì in poi il giro esegue quella copia, che nessuna operazione
//   su git può toccare.
//
//   La copia si ricorda da sola dove sta il progetto vero (`.filo-repo-root`),
//   così nessuno deve passarselo di mano in mano: è la stessa scelta del
//   marcatore del biglietto, e per lo stesso motivo — quello che deve succedere
//   sempre non si chiede a chi lavora.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * La radice degli strumenti CHE STANNO GIRANDO — non quella del progetto.
 * Se dispatch è la copia fissata, questa è la copia; se è quello del repo,
 * questa è il repo. Le due cose coincidono in locale e divergono in cloud, ed è
 * esattamente la distinzione che mancava.
 */
export const TOOLS_ROOT = process.env.FILO_TOOLS_ROOT
  ? resolve(process.env.FILO_TOOLS_ROOT)
  : resolve(HERE, '..', '..');

/**
 * Quello che si copia. Non solo gli strumenti e le ricette: anche i moduli che
 * gli strumenti IMPORTANO, o la copia non sa girare.
 *
 * È il rilievo che ha bocciato la prima versione: mancava la configurazione
 * degli accessi, e il preflight lanciato dalla copia usciva con "guasto",
 * accusando la rete invece della copia incompleta — e "guasto" per
 * l'orchestratore vuol dire chiudere il giro senza ritentare.
 *
 * La regola per chi aggiunge roba qui: se uno strumento del giro lo importa,
 * ci va. Il controllo che lo inchioda esegue il preflight DALLA COPIA.
 */
export const PINNED_PATHS = [
  'scripts',
  'routines',
  // I moduli condivisi che gli strumenti caricano (cifratura dei feedback,
  // macchina a stati, thread).
  'src/shared',
  // La configurazione degli accessi, che il canale verso il database legge.
  'src/main/auth',
  // Il campanello che avvisa l'owner quando una fusione resta in attesa.
  'src/main/services/mergeApprovalSignal.js',
];

const REPO_MARK = '.filo-repo-root';
const ORIGIN_MARK = '.filo-origine';

/** Da dove viene questa copia (ramo e commit), se lo ha registrato. */
export function pinnedOrigin(toolsRoot = TOOLS_ROOT) {
  try {
    const f = resolve(toolsRoot, ORIGIN_MARK);
    return existsSync(f) ? String(readFileSync(f, 'utf8') || '').trim() : '';
  } catch (_) {
    return '';
  }
}

/**
 * Dove finisce la copia: fuori dal progetto, per costruzione.
 * `FILO_TOOLS_DIR` esiste per i test, che non devono scrivere nella cartella
 * che un giro vero potrebbe star usando.
 */
export function pinnedDir() {
  const scelta = String(process.env.FILO_TOOLS_DIR || '').trim();
  return scelta ? resolve(scelta) : resolve(tmpdir(), 'filo-strumenti');
}

/**
 * Copia gli strumenti fuori dal progetto e ricorda dove sta il progetto.
 *
 * Un fallimento qui NON è un intoppo da ignorare, e chi chiama lo tratta come
 * guasto che ferma il giro: proseguire vorrebbe dire eseguire gli strumenti del
 * ramo di lavoro, cioè il guasto che questa copia esiste per togliere — e
 * quello non si vede finché non è costato un'ora di lavoro. Meglio un giro
 * saltato di un giro che lavora con gli attrezzi sbagliati.
 *
 * @returns {{ ok: boolean, dir: string, why: string }}
 */
export function pinTools(repoRoot, { dest = pinnedDir(), origine = '' } = {}) {
  const src = resolve(repoRoot);
  // NON si fissa sopra la copia che sta girando adesso. Non è prudenza: a
  // metà giro il progetto è aperto sul ramo di lavoro, quindi ricopiare da lì
  // sovrascriverebbe gli strumenti buoni con quelli del ramo — il guasto che
  // questa copia esiste per togliere, eseguito dalle nostre mani. (E su Windows
  // fallirebbe comunque, perché è la cartella da cui il processo sta girando.)
  if (resolve(dest) === TOOLS_ROOT) {
    return { ok: true, dir: TOOLS_ROOT, why: 'già fissati' };
  }
  try {
    for (const p of PINNED_PATHS) {
      if (!existsSync(resolve(src, p))) return { ok: false, dir: '', why: `manca ${p}` };
    }
    // Si riparte puliti: una copia vecchia rimasta lì sarebbe di nuovo il
    // difetto che questo file viene a togliere, con un'altra faccia.
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    for (const p of PINNED_PATHS) {
      // Anche i singoli file: la cartella che li conterrà va creata a mano,
      // perché la copia non risale da sola.
      mkdirSync(dirname(resolve(dest, p)), { recursive: true });
      cpSync(resolve(src, p), resolve(dest, p), { recursive: true });
    }
    writeFileSync(resolve(dest, REPO_MARK), `${src}\n`, 'utf8');
    // Da DOVE viene questa copia. Serve a chi legge i log: una copia presa da
    // un checkout non aggiornato riporterebbe indietro gli strumenti con
    // un'altra causa, e senza questa riga non si distinguerebbe.
    if (origine) writeFileSync(resolve(dest, ORIGIN_MARK), `${origine}\n`, 'utf8');
    return { ok: true, dir: dest, why: 'copiati' };
  } catch (e) {
    return { ok: false, dir: '', why: String((e && e.message) || e) };
  }
}

/**
 * Il progetto a cui questi strumenti si riferiscono, se sono una copia fissata.
 * '' quando gli strumenti sono quelli del repo (in locale, o prima del pin).
 */
export function pinnedRepoRoot(toolsRoot = TOOLS_ROOT) {
  try {
    const f = resolve(toolsRoot, REPO_MARK);
    if (!existsSync(f)) return '';
    const v = String(readFileSync(f, 'utf8') || '').trim();
    return v && existsSync(v) ? resolve(v) : '';
  } catch (_) {
    return '';
  }
}

/**
 * Le ricette dicono `node scripts/…` perché è così che si leggono. Quando gli
 * strumenti sono altrove, quel percorso porterebbe di nuovo dentro il ramo: qui
 * viene riscritto in assoluto, una volta sola, nel momento in cui la ricetta
 * viene consegnata.
 *
 * PURA. A strumenti non fissati non tocca niente: il testo resta quello scritto.
 */
export function absolutizeRecipe(text, toolsRoot = TOOLS_ROOT, repoRoot = '') {
  const t = String(text || '');
  if (!t) return t;
  const tools = resolve(toolsRoot);
  if (repoRoot && resolve(repoRoot) === tools) return t;
  // Le virgolette servono: in cloud la cartella temporanea può avere spazi.
  const base = tools.replace(/\\/g, '/');
  return t.replace(/\bnode\s+scripts\/([A-Za-z0-9._/-]+)/g, `node "${base}/scripts/$1"`);
}
