// Il canale autenticato verso il server — lato routine.
//
// PERCHÉ ESISTE (spec ROUTINE-AUTH-SPEC.md, nella root del repo)
//   Oggi l'orchestratore riceve nel prompt la chiave che apre TUTTI i feedback,
//   la esporta nell'ambiente, e ogni lavoratore la eredita. Quei lavoratori
//   leggono tutto il giorno testo scritto da sconosciuti: chi legge testo non
//   fidato non deve tenere segreti che valgono.
//
//   Il canale ribalta il verso. L'orchestratore ha solo una parola d'ordine, e
//   con quella chiede un BIGLIETTO per il lavoratore che sta per far partire.
//   Chi sceglie il lavoro è il server; il biglietto è opaco e vale per un
//   semaforo solo. Il lavoratore, col biglietto, ottiene il proprio lavoro già
//   in chiaro — e nient'altro.
//
// STATO: le decisioni passano DA QUI, e da nessun'altra parte. La coda su git
//   è stata smontata: non esiste più una seconda strada su cui posare una
//   decisione che il server non ha accettato.
//
//   Resta la distinzione fra RIFIUTO e GUASTO, perché cambia cosa deve fare chi
//   lavora: un rifiuto è una risposta (il server ha guardato ruolo, ramo e stato
//   e ha detto no) e va letto e corretto; un guasto è il server che non c'è, e lì
//   ci si ferma. In nessuno dei due casi la decisione risulta registrata.
//
// I SEGRETI NON PASSANO DALL'AMBIENTE
//   Parola d'ordine e biglietto si passano come ARGOMENTO, mai come variabile
//   d'ambiente: l'ambiente lo eredita ogni processo figlio, ed è esattamente il
//   difetto che questa spec viene a togliere. Se ti viene comodo esportarli,
//   fermati: stai ricreando il problema.
//
// USO
//   Nei comandi che usano un biglietto lo si passa davanti oppure con `--ticket <codice>` (o
//   `--biglietto`); in tutti e due i posti dev'essere lo stesso. Senza biglietto l'uscita è 1, non 3:
//   il server non è stato chiamato.
//
//   node scripts/routine-channel.mjs probe <parola-d-ordine>
//       → c'è lavoro? Non lega niente. Exit 0 = sì, 2 = niente da fare,
//         3 = guasto. Da chiedere PRIMA di pagare il setup dell'ambiente.
//
//   node scripts/routine-channel.mjs ticket <parola-d-ordine> [--feedback <N>] [--json]
//       → stampa il biglietto su stdout (una riga), oppure "niente da fare". Con `--feedback` quello del feedback
//         per cui la sessione è stata accesa (SPEC-RIDISEGNO-LAVORO.md § 2), mai un altro.
//         Con `--json` stampa biglietto E ruolo insieme (più `model` ed `effort` se il server li ha decisi):
//         il ruolo serve a chi guida per scegliere il tipo di worker PRIMA di lanciarlo. In tutte e due le forme
//         registra la decisione per il gancio dell'orchestratore cieco, che mette modello e sforzo al lancio.
//         Exit 0 = biglietto, 2 = niente da fare, 3 = guasto (il giro si ferma).
//
//   node scripts/routine-channel.mjs work <biglietto>
//       → stampa il JSON del proprio lavoro { role, ... }.
//
//   node scripts/routine-channel.mjs immagine <id> [--ticket <codice>]
//       → un'immagine del feedback rinviata dalla consegna (`rinviata: true` in `immagini`), chiesta da
//         sola col suo id (`s2`, `r1.3`). La scrive accanto alle altre e stampa la voce col percorso in
//         `file`. Il biglietto lo ritrova da solo, come heartbeat. Exit 0 = voce (aperta o col motivo
//         in `errore`), 4 = rifiutato (`no_image`: id che il tuo ruolo non vede), 3 = guasto.
//
//   node scripts/routine-channel.mjs heartbeat [<biglietto>] [--loop]
//       → tiene vivo il semaforo. Con --loop batte finché il biglietto vive.
//         NON serve lanciarlo a mano: il ciclo lo avvia dispatch nel momento in
//         cui riceve il biglietto (lib/routine-beat.mjs), perché una cosa che
//         deve succedere sempre non si chiede a chi lavora. Senza biglietto fra
//         gli argomenti lo ritrova da solo, come le consegne.
//
//   node scripts/routine-channel.mjs veglia <biglietto>
//       → chi guida il giro, su un worker spostato in sottofondo (#1797): aspetta al massimo una fetta (lib/veglia-worker.mjs).
//         Exit 0 = ha rilasciato il biglietto, 5 = lavora ancora (si rilancia), 3 = fermo da 20 minuti senza segni di
//         vita: biglietto già rilasciato con un guasto dichiarato, il giro si chiude.
//
//   node scripts/routine-channel.mjs release <biglietto> --role <ruolo> [--guasto "motivo"] [--forza]
//       → exit 5, e niente rilasciato, se nella cartella lavora ancora qualcuno (#1480): per l'orchestratore un
//         battito, un salvataggio recente o un processo (`--forza` solo per il worker morto davvero), per un worker
//         i suoi processi.
//       → fine lavoro: il biglietto muore e il semaforo si libera. Con
//         `--guasto` DICHIARI un guasto al server (SPEC-RIDISEGNO-MAX.md §12):
//         è così che il server smette di dare lavoro per il giro — le
//         richieste di biglietto successive escono con 3 — e il pacemaker
//         rispetta una pausa prima di riaccendere. Non "riportarlo" a parole:
//         il tuo testo di ritorno non lo legge nessuna macchina.
//         Prima di parlare col server committa quello che è rimasto fuori
//         dai commit (un file nato da una shell non passa dall'hook) e
//         spedisce il ramo corrente su origin (--force-with-lease se la
//         storia è stata riscritta): se il push fallisce NON rilascia ed
//         esce diverso da zero. `--senza-push` dove non c'è un repo. Allega da solo il rapporto di fine sessione
//         (session-report.mjs; `--role <ruolo>` per firmarlo; `--senza-rapporto`
//         per saltarlo).
//
//   node scripts/routine-channel.mjs deliver <biglietto> <intento> [--campo valore …]
//       → consegna una decisione. Intenti: verdict, fixed, secaudit, status,
//         note, feedback, domanda, piano; su fixed il correttore aggiunge `--motivo "…"`
//         (la forma di --record-fixed). Exit 0 = accettata, 4 = RIFIUTATA dal server (non
//         ripiegare: il server ha guardato e ha detto no), 3 = guasto.
//         `--notes "…"` è il report per l'owner (il server lo cifra: nessuno
//         tranne lui lo rilegge). `--frase "…"` è la riga in chiaro per chi ha
//         mandato il feedback, che la vede nella sua bacheca. `--domanda
//         <file.json>` (su status e fixed, #1358) è la domanda per l'owner nel
//         formato di SPEC-DOMANDE §3.1: una che blocca ferma il lavoro, e il
//         feedback aspetta lei; una fermata (`--status design`) senza domanda
//         non parte, tranne `--reason locale` (#1790). `--status attack|spam` col
//         perché nelle note: il giudizio di chi l'ha letto (Ricevuti L3).
//         Revisione, correzione, critica e verdetto partono solo dal ramo assegnato (uscita 1 altrimenti): il ramo
//         lo legge lo strumento dalla cartella, e `--branch` può solo confermarlo. La correzione di un riallineamento
//         parte solo col ramo spedito su origin, alla punta della cartella e sopra origin/main (#1964).
//         `deliver piano --piano <file.md>`: il piano di un lavoro grosso, che riceve chi riprende.
//         `deliver status --status done --reason gia_risolto --fusione <sha> --notes "…" --frase "…"`: già risolto
//         su main, si chiude senza ramo (regola 5 della spec; il server ricontrolla la fusione).
//
//   node scripts/routine-channel.mjs sporca "<motivo>" [--ticket <biglietto>]
//       → ti dichiari sporco (#1148): hai letto qualcosa che il server non vede (una pagina web, un file fuori dal
//         repo). Da lì ciò che scrivi nasce non fidato. Exit 0 = registrato, 4 = rifiutato, 3 = guasto.
//
//   node scripts/routine-channel.mjs operazione <operazione> ['<dati JSON>'] [--ticket <biglietto>]
//   node scripts/routine-channel.mjs segnala|rapporto [--ticket <biglietto>] <<'FINE' … FINE
//       → un'operazione del biglietto (#1153, SPEC-DOMANDE.md §5): `segnala` per tutti, `rapporto` per i compiti,
//         le altre se l'ambito del biglietto le ha. I dati JSON anche da stdin. Stampa la risposta del server.
//         Exit 0 = fatto, 1 = uso, 4 = rifiutato (fuori ambito, fuori ambiente, dati sbagliati), 3 = guasto.
//
//   node scripts/routine-channel.mjs git-server <clone|ls-remote|fetch|push> <cartella-del-clone> [<ramo>]
//       → l'unica strada di git verso filo-security in un lavoro server (#1159, #1233, #1761): chiede il token del
//         biglietto e, in locale, lo dà a quella sola chiamata di git; in cloud lascia autenticare il proxy della sessione
//         (lib/git-server.mjs). Exit 0 = fatto, 1 = uso o git fallito, 4 = token rifiutato, 3 = guasto.
//
//   node scripts/routine-channel.mjs ramo-server <ramo> [<sha>]
//       → dopo il push su filo-security: il server legge la punta e la registra (registro dei rami). Exit come sporca.
//
//   node scripts/routine-channel.mjs compare <biglietto> <ruolo> <numero>
//       → registra cosa aveva scelto il cammino su git accanto a cosa aveva
//         scelto il server, e consuma il biglietto. Serve solo nella fase in
//         cui i due canali convivono.
//
//   node scripts/routine-channel.mjs domanda <parola-d-ordine> | domanda --biglietto <biglietto>
//       → la domanda di fine sessione e il comando per rispondere. Exit 0 = domanda, 2 = nessuna (chiudi e basta), 4 = rifiutato.
//   node scripts/routine-channel.mjs risposta <parola-d-ordine> <id> | risposta --biglietto <biglietto>   (testo da stdin)
//       → registra la risposta. Exit come sopra; `answer_too_big` stampa i byte e il massimo.
//
//   La FUSIONE su main non ha un sottocomando qui: la porta il SERVER da sé
//   dopo il pass del controllo di sicurezza (#1207): unit sulla fusione in
//   un'azione di GitHub, L5 sul diff che scarica lui, fusione con la sua identità.

import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pinnedRepoRoot, absolutizeOutput } from './lib/tools-pin.mjs';
import {
  isProtectedBranch, headSha, guardiaConsegna, azzeraRifiuti, escalationNote, IDENTITY_REJECT_LIMIT, lavoroVivo, testoLavoroVivo,
  USCITA_LAVORO_VIVO,
} from './lib/branch-integrity.mjs';
import { dirtyTreeText, statoDirectory, statoIllegibileText } from './lib/dirty-tree.mjs';
import { bigliettoFinito, haFormaDiBigliettoVero, leggiBigliettoAMano, leggiMarcatoreBiglietto, looksLikeTicket, segnaBigliettoFinito } from './lib/routine-ticket.mjs';
import { apreUnElenco } from './lib/argomenti.mjs';
import { SEGNALA_TOLTA } from './lib/livelli.mjs';
import { scriviImmagine } from './lib/consegna-file.mjs';
import { consumoSessione } from './lib/consumo-progressivo.mjs';
import { quotaFile } from './statusline.mjs';
import {
  URL_SERVER, ambienteGitServer, ambienteViaProxy, chiHaRespinto, originDelServer, pianoGitServer, senzaToken, stradaGitServer, urlSenzaSegreti,
} from './lib/git-server.mjs';
import { copieInScena, spedibileSenzaCopie, escludiInLocale, installaControlloSpedizione } from './lib/copie-di-dati.mjs';
import { registraDecisione } from './lib/orchestratore-cieco.mjs';
import { cloneDelBiglietto, rilancia } from './lib/worker-nel-clone.mjs';
import { isRoutineInstance } from './lib/routine-role.mjs';

// La radice del checkout, con lo stesso ripiego di dispatch: i marcatori del
// giro (biglietto, battito) stanno lì dentro, e chi lavora in una cartella di
// lavoro separata ha una radice diversa da quella dello script.
// Se questi strumenti sono la copia fissata fuori dal progetto
// (lib/tools-pin.mjs), il progetto vero lo dicono loro: senza, i marcatori del
// giro finirebbero accanto alla copia invece che dove li cerca chi consegna.
const ROOT = process.env.FILO_REPO_ROOT
  ? resolve(process.env.FILO_REPO_ROOT)
  : (pinnedRepoRoot() || resolve(fileURLToPath(new URL('..', import.meta.url))));

// L'indirizzo del canale. `FILO_ROUTINE_API` esiste per i test e per un
// eventuale ambiente di prova: NON è un segreto, è solo dove sta il server.
const BASE = process.env.FILO_ROUTINE_API
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

// Il battito va più fitto della scadenza del semaforo (60 minuti lato server):
// dieci minuti lasciano il margine per cinque battiti persi di fila.
const BEAT_EVERY_MS = 10 * 60 * 1000;
// Quanto dura il semaforo lato server senza battito (policy.js di
// filo-security: LEASE_TTL_MS, portato a 60 minuti dopo i biglietti morti a
// metà lavorazione del 24-28/08). Serve come tetto all'insistenza: oltre, il
// biglietto è morto comunque.
const LEASE_TTL_MS = 60 * 60 * 1000;
// Su un intoppo si ribatte più fitto: dentro mezz'ora ci stanno quindici
// tentativi, abbastanza per attraversare un buco di rete senza perdere il lavoro.
const RETRY_EVERY_MS = 2 * 60 * 1000;

/**
 * Una chiamata al canale. Ritenta solo sui guasti che possono passare da soli
 * (rete, 5xx): un rifiuto è una risposta, non un guasto, e ritentarlo
 * significherebbe solo consumare il tetto.
 *
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function call(path, payload, { attempts = 3, baseDelayMs = 1500, fetchImpl = fetch, sleep = defaultSleep } = {}) {
  let last = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetchImpl(`${BASE}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
      });
      const text = await res.text();
      let body = {};
      try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { ok: false, reason: 'malformed_response' }; }
      // Un guasto DICHIARATO da un worker viaggia come 5xx (il giro si deve
      // fermare), ma è una RISPOSTA deterministica, non un'interruzione che
      // può passare da sola: ritentarla darebbe tre volte lo stesso no.
      if (res.status >= 500 && i < attempts && (body && body.reason) !== 'fault_declared') {
        last = { status: res.status, body }; await sleep(baseDelayMs * i); continue;
      }
      return { status: res.status, body };
    } catch (e) {
      last = { status: 0, body: { ok: false, reason: 'network', detail: String((e && e.message) || e) } };
      if (i < attempts) { await sleep(baseDelayMs * i); continue; }
    }
  }
  return last || { status: 0, body: { ok: false, reason: 'network' } };
}

function defaultSleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Traduce la risposta del canale nel vocabolario delle routine. PURA.
 *
 * Esiste perché la distinzione fra "non c'è lavoro" e "non riesco a sapere se
 * c'è lavoro" è la stessa che nel cammino su git è costata un'ondata di lavoro
 * fantasma: una coda illeggibile che sembrava una giornata tranquilla. Qui il
 * server la fa già, e questa funzione non deve appiattirla.
 *
 * @returns {{ outcome: 'work'|'nothing'|'fault', ticket?: string, reason?: string }}
 */
export function readTicketReply(status, body) {
  const b = body || {};
  if (status === 200 && b.ok && b.work && b.ticket) {
    // Il ruolo, quando il server lo manda, serve a chi guida per scegliere il
    // tipo di worker PRIMA di lanciarlo (sforzo per ruolo). Assente = server
    // vecchio: chi guida ripiega sul worker generico.
    const out = { outcome: 'work', ticket: String(b.ticket) };
    if (typeof b.role === 'string' && b.role) out.role = b.role;
    // Modello e sforzo decisi dal server per questo lavoro (#1189): assenti vale la definizione dell'agente. Il gancio
    // dell'orchestratore li controlla e li mette (lib/orchestratore-cieco.mjs).
    for (const k of ['model', 'effort']) if (typeof b[k] === 'string' && b[k].trim()) out[k] = b[k].trim();
    // Il feedback del biglietto, quando il server lo dice: chi l'ha chiesto per numero controlla di aver avuto quello.
    if (typeof b.feedback === 'string' && b.feedback.trim()) out.feedback = b.feedback.trim();
    return out;
  }
  if (status === 200 && b.ok && b.work === false) return { outcome: 'nothing', reason: String(b.reason || '') };
  return { outcome: 'fault', reason: String(b.reason || `http_${status}`) };
}

/**
 * `opts.feedback`: il numero del feedback per cui la sessione è stata accesa (SPEC-RIDISEGNO-LAVORO.md § 2). Il server
 * dà il biglietto di quel feedback, o risponde «niente» col motivo (non in coda, posti pieni, inesistente).
 * `sessione`: l'id della sessione cloud. Quella che il pacemaker ha acceso per un feedback scelto dal manutentore riceve
 * il biglietto di quello, una volta sola, anche senza chiederlo (functions/src/routine/accensioni.js).
 */
export function sessioneCloud(env = process.env) {
  const s = String(env.CLAUDE_CODE_REMOTE_SESSION_ID || '').trim();
  return /^[A-Za-z0-9_-]{8,120}$/.test(s) ? s : '';
}

export async function ticket(passphrase, opts) {
  const feedback = opts && opts.feedback ? { feedback: String(opts.feedback) } : {};
  const sessione = sessioneCloud(opts && opts.env ? opts.env : process.env);
  const { status, body } = await call('routineTicket', { passphrase, ...feedback, ...(sessione ? { sessione } : {}), ...creditiDi(opts) }, opts);
  return readTicketReply(status, body);
}

/**
 * Prontezza: c'è lavoro? Non lega niente e non prende semafori.
 *
 * Va chiesto PRIMA del setup dell'ambiente, che costa parecchio (installazione,
 * binario da un centinaio di mega): se il giro non è in grado di lavorare va
 * scoperto prima di averlo pagato. Un biglietto vero, chiesto in quel momento,
 * terrebbe un feedback fermo per tutta l'installazione e scadrebbe prima che
 * qualcuno inizi a lavorarci.
 *
 * @returns {{ outcome:'work'|'nothing'|'fault', reason?: string }}
 */
export async function probe(passphrase, opts) {
  const { status, body } = await call('routineTicket', { passphrase, probe: true, ...creditiDi(opts) }, opts);
  const b = body || {};
  if (status === 200 && b.ok && b.work === true) return { outcome: 'work' };
  if (status === 200 && b.ok && b.work === false) return { outcome: 'nothing', reason: String(b.reason || '') };
  return { outcome: 'fault', reason: String(b.reason || `http_${status}`) };
}

/**
 * Ritira il proprio lavoro. Torna la BUSTA INTERA, non solo il payload.
 *
 * La busta è ruolo, indirizzo del feedback, numero e ramo: serve a chi guida il
 * giro per prendere in carico, posizionarsi sul ramo giusto e consegnare. Il
 * payload è il contenuto, già ritagliato a ciò che quel ruolo può vedere.
 *
 * Tenerne solo metà è già costato un giro intero: senza il ruolo, chi guida
 * consegnava al lavoratore una busta vuota e usciva dicendo che era andato
 * tutto bene — un guasto totale travestito da giro riuscito. Se aggiungi campi
 * lato server, aggiungili anche qui.
 */
export async function work(t, opts) {
  const { status, body } = await call('routineWork', { ticket: t }, opts);
  if (status === 200 && body && body.ok && body.role) {
    return {
      ok: true,
      role: String(body.role),
      id: String(body.id || ''),
      num: String(body.num || ''),
      branch: String(body.branch || ''),
      payload: body.payload || {},
    };
  }
  // Una risposta "riuscita" ma senza ruolo non è un lavoro: è una busta vuota,
  // e va trattata come guasto invece di essere consegnata a qualcuno.
  return { ok: false, reason: String((body && body.reason) || (status === 200 ? 'busta_incompleta' : `http_${status}`)) };
}

// Gli id delle immagini del contratto #900: `sN` della segnalazione, `rK.j` della risposta K.
export const ID_IMMAGINE_RE = /^(s\d{1,4}|r\d{1,4}\.\d{1,4})$/;

/**
 * Chi chiede un'immagine: l'id, e il biglietto se passato (davanti all'id o con `--ticket`, uguali se
 * tutti e due). Senza biglietto lo ritrova chi chiama, come heartbeat. PURA.
 * @returns {{ id: string, ticket: string } | { errore: string }}
 */
export function argomentiImmagine(args, aMano = '') {
  const lista = Array.isArray(args) ? args.map(String) : [];
  const mano = String(aMano || '').trim();
  let davanti = '';
  if (lista.length === 2 && haFormaDiBigliettoVero(lista[0])) davanti = lista.shift();
  if (lista.length !== 1) return { errore: 'Uso: immagine <id> [--ticket <codice>], un id solo (s2, r1.3).' };
  const id = lista[0].trim();
  if (!ID_IMMAGINE_RE.test(id)) return { errore: `Id d'immagine non valido: «${id.slice(0, 20)}». La forma è sN (segnalazione) o rK.j (risposta K), come in «immagini».` };
  if (davanti && mano && davanti !== mano) return { errore: 'Due biglietti diversi: passane uno solo.' };
  return { id, ticket: davanti || mano };
}

/** Un'immagine rinviata, chiesta da sola allo stesso endpoint del lavoro (contratto #900 §3). */
export async function immagine(t, id, opts) {
  const { status, body } = await call('routineWork', { ticket: t, immagine: id }, opts);
  if (status === 200 && body && body.ok && body.immagine && typeof body.immagine === 'object') {
    return { outcome: 'ok', voce: body.immagine };
  }
  // Un 200 senza voce è un server che non conosce la domanda (prima del deploy): non è un no.
  const outcome = classifyReply(status, body);
  return { outcome: outcome === 'ok' ? 'fault' : outcome, reason: String((body && body.reason) || (outcome === 'ok' ? 'risposta_senza_immagine' : `http_${status}`)) };
}

// I motivi per cui il battito NON va ritentato: il server ha guardato il
// biglietto e ha detto che non vale più. Qualunque altro motivo (rete giù, 5xx,
// risposta illeggibile) è un intoppo che può passare da solo, e mollare lì
// vorrebbe dire far cadere il semaforo di un lavoro ancora vivo.
const BATTITO_FINITO = new Set(['bad_ticket', 'dead_ticket']);

/** Un file di sistema, o null se non c'è (Windows, un contenitore senza cgroup). */
function leggiFileDiSistema(p) {
  try { return readFileSync(p, 'utf8'); } catch (_) { return null; }
}
function elencaCartella(p) {
  try { return readdirSync(p); } catch (_) { return []; }
}

/**
 * La memoria del CONTENITORE, dal suo cgroup (prima v2, poi v1):
 * { usedMb, limitMb }, con limitMb 0 se non c'è un tetto; null fuori da un
 * cgroup. In un contenitore la memoria «libera» del kernel è quella della
 * macchina che lo ospita, non la sua: un worker ucciso per aver superato il
 * tetto del cgroup lasciava un battito con venti giga liberi. PURA (legge con
 * `leggi`).
 */
export function memoriaContenitore(leggi = leggiFileDiSistema) {
  const mb = (s) => { const n = Number(String(s == null ? '' : s).trim()); return Number.isFinite(n) ? n / 1048576 : NaN; };
  const v2 = leggi('/sys/fs/cgroup/memory.current');
  if (v2 !== null) {
    const used = mb(v2);
    if (!Number.isFinite(used)) return null;
    const max = String(leggi('/sys/fs/cgroup/memory.max') || '').trim();
    const limit = max && max !== 'max' ? mb(max) : 0;
    return { usedMb: used, limitMb: Number.isFinite(limit) ? limit : 0 };
  }
  const v1 = leggi('/sys/fs/cgroup/memory/memory.usage_in_bytes');
  if (v1 !== null) {
    const used = mb(v1);
    if (!Number.isFinite(used)) return null;
    const limit = mb(leggi('/sys/fs/cgroup/memory/memory.limit_in_bytes'));
    // In v1 «senza tetto» è un numero enorme (circa 2^63): non è un limite.
    return { usedMb: used, limitMb: Number.isFinite(limit) && limit < 1024 * 1024 * 1024 ? limit : 0 };
  }
  return null;
}

/**
 * Da quanto vive il CONTENITORE: l'età del suo processo 1, da /proc/1/stat
 * (campo 22: l'avvio in tick dall'avvio del kernel, 100 tick al secondo su
 * Linux). L'uptime del kernel, in un contenitore, è quello della macchina che
 * lo ospita. null dove /proc non c'è. PURA (legge con `leggi`).
 */
export function uptimeContenitore(uptimeKernelS, leggi = leggiFileDiSistema) {
  const stat = leggi('/proc/1/stat');
  if (!stat) return null;
  const dopoNome = String(stat).slice(String(stat).lastIndexOf(')') + 2).trim().split(/\s+/);
  const avvioTick = Number(dopoNome[19]);
  if (!Number.isFinite(avvioTick) || !Number.isFinite(uptimeKernelS)) return null;
  const s = uptimeKernelS - avvioTick / 100;
  return s >= 0 ? s : null;
}

/**
 * La memoria residente di TUTTI i processi visibili (somma di
 * /proc/<pid>/statm, pagine da 4 KB): la memoria del lavoro, non del solo
 * processo che batte. null senza /proc. PURA (legge con `leggi`/`elenca`).
 */
export function rssProcessi(leggi = leggiFileDiSistema, elenca = elencaCartella) {
  const pid = elenca('/proc').filter((n) => /^\d+$/.test(n));
  if (!pid.length) return null;
  let pagine = 0;
  for (const p of pid) {
    const statm = leggi(`/proc/${p}/statm`);
    if (!statm) continue;
    const n = Number(String(statm).trim().split(/\s+/)[1]);
    if (Number.isFinite(n)) pagine += n;
  }
  return (pagine * 4096) / 1048576;
}

/**
 * Lo stato del contenitore, da allegare a ogni battito (giro del 14/09: un
 * worker morto di memoria non lasciava nessuna traccia, il semaforo cadeva e
 * basta). Quattro numeri, gli stessi che il server salva:
 *   uptimeS  da quanto vive il contenitore (l'età del suo processo 1; fuori
 *            da un contenitore, l'uptime del sistema);
 *   freeMb   quanto manca al tetto di memoria del cgroup; senza tetto, la
 *            memoria libera del sistema;
 *   rssMb    la memoria usata dal contenitore (cgroup), o la somma di tutti i
 *            processi (Linux senza cgroup), o quella di questo processo (dove
 *            /proc non c'è);
 *   loadAvg  il carico dell'ultimo minuto.
 * Solo numeri: il server salva quelli e ignora il resto. Fino al 16/09/2026
 * rssMb era la memoria del processo che batte (piccola e costante) e uptime
 * e memoria libera erano quelli del kernel, cioè della macchina ospite.
 */
export function statoContenitore({ osImpl = os, proc = process, leggi = leggiFileDiSistema, elenca = elencaCartella } = {}) {
  const num = (v) => (Number.isFinite(v) ? v : undefined);
  const carico = osImpl.loadavg();
  const cg = memoriaContenitore(leggi);
  const upC = uptimeContenitore(Number(osImpl.uptime()), leggi);
  const usata = cg ? cg.usedMb : rssProcessi(leggi, elenca);
  const libera = cg && cg.limitMb > 0 ? Math.max(0, cg.limitMb - cg.usedMb) : osImpl.freemem() / 1048576;
  return {
    uptimeS: num(Math.round(upC !== null ? upC : osImpl.uptime())),
    freeMb: num(Math.round(libera)),
    rssMb: num(Math.round(usata !== null ? usata : proc.memoryUsage().rss / 1048576)),
    loadAvg: num(Math.round(((Array.isArray(carico) && carico[0]) || 0) * 100) / 100),
  };
}

/** Quanto aspettare il battito dopo: ogni dieci minuti, ma sempre ben dentro la scadenza che il server ha detto. PURA. */
export function attesaBattito(expiresAt, now = Date.now()) {
  const resta = Date.parse(String(expiresAt || '')) - now;
  if (!Number.isFinite(resta) || resta <= 0) return BEAT_EVERY_MS;
  return Math.min(BEAT_EVERY_MS, Math.max(1000, Math.floor(resta / 3)));
}

/**
 * I campi dei crediti nel battito (SPEC-DOMANDE.md §8.1): `consumo` cumulativo della sessione, `quota` (lettura
 * della barra di stato, se è di questa sessione) e `barra`. Best-effort: un campo che non si legge non parte.
 * La sessione la dicono FILO_TRANSCRIPT / FILO_SESSION_ID (dall'hook); il ripiego del transcript più recente vale
 * solo per una routine dichiarata o con un biglietto in cartella, dove non c'è la sessione di un altro da sbagliare.
 */
export function misureCrediti({ root = ROOT, env = process.env, cwd = process.cwd(), configDir = '', home = os.homedir(), nowMs = Date.now() } = {}) {
  const out = {};
  const routine = (Boolean(env.FILO_ROUTINE) && env.FILO_ROUTINE !== '0') || existsSync(join(root, '.claude', 'routine-ticket.json'));
  const { consumo } = consumoSessione({ root, env, cwd, configDir, ripiego: routine, nowMs });
  if (consumo) out.consumo = consumo;
  let letture = null;
  try { letture = JSON.parse(readFileSync(quotaFile(home), 'utf8')); } catch (_) { /* barra mai girata qui */ }
  const mia = consumo && letture && letture.sessioni && typeof letture.sessioni === 'object' ? letture.sessioni[consumo.sessionId] : null;
  if (consumo) out.barra = mia ? 'presente' : 'assente';
  if (mia && mia.lettura && typeof mia.lettura === 'object') out.quota = mia.lettura;
  return out;
}

/**
 * Le misure dei crediti da allegare a ogni chiamata della sessione (battito, biglietto, rilascio, chiusura): il
 * consumo dopo l'ultimo battito arriva così. Mai un motivo per non fare la chiamata.
 */
export function creditiDi(opts = {}) {
  const o = opts || {};
  try { return (o.misureCrediti || misureCrediti)(o); } catch (_) { return {}; }
}

/**
 * La misura del lavoro per il server (#1797): senza, un worker fermo su un permesso batte per ore e il server lo conta
 * vivo. Best-effort come le altre misure: un errore la lascia fuori, mai il battito.
 */
export async function attivitaDi(t, opts = {}) {
  const o = opts || {};
  try {
    if (o.attivitaDi) return o.attivitaDi(t);
    const { segniDiVita, attivitaPerBattito } = await import('./lib/veglia-worker.mjs');
    return attivitaPerBattito(segniDiVita({ root: o.root || ROOT, ticket: t }));
  } catch (_) {
    return {};
  }
}

export async function heartbeat(t, opts = {}) {
  const { status, body } = await call('routineHeartbeat', { ticket: t, ...statoContenitore(opts), ...creditiDi(opts), ...(await attivitaDi(t, opts)) }, opts);
  if (status === 200 && body && body.ok) return { ok: true, expiresAt: body.expiresAt, avvisi: Array.isArray(body.avvisi) ? body.avvisi : [] };
  const reason = String((body && body.reason) || `http_${status}`);
  return { ok: false, reason, final: BATTITO_FINITO.has(reason) };
}

/**
 * Fine lavoro. `fault`, se presente, è il GUASTO DICHIARATO: il motivo per cui
 * questo giro non può lavorare, registrato AL CANALE invece che raccontato a
 * parole (il testo di ritorno di un worker non lo legge nessuna macchina). Il
 * server lo tronca e non lo interpreta; da lì in poi l'emissione dei biglietti
 * risponde `fault_declared` per il periodo di rispetto.
 *
 * `report`, se presente, è il rapporto di fine sessione (session-report.mjs):
 * viaggia nel corpo col nome `report`. Per la ritentata quando il server lo
 * rifiuta c'è releaseConRapporto, qui sotto.
 */
export async function release(t, fault = '', opts, report = null) {
  const payload = { ticket: t };
  const motivo = String(fault || '').trim();
  if (motivo) payload.fault = motivo;
  if (report && typeof report === 'object') payload.report = report;
  Object.assign(payload, creditiDi(opts));
  const { status, body } = await call('routineRelease', payload, opts);
  return { ok: status === 200 && !!(body && body.ok), reason: String((body && body.reason) || ''), status, body };
}

/**
 * Rilascio col rapporto allegato, e le due ritentate che il server prevede:
 *   - 413 `report_too_big` → una volta senza `tools.byName` e `notes`; se è
 *     ancora troppo, senza rapporto, e lo si dice;
 *   - 400 `report_malformed` → senza `listino`, se c'era (la versione passa
 *     nelle note); poi senza rapporto, e lo si dice.
 * Il rilascio è idempotente: riprovare è sicuro. `esito.rapporto` dice cosa è
 * arrivato al server: 'allegato', 'ridotto', 'scartato' o 'assente';
 * `esito.avviso` è la riga da stampare quando qualcosa è andato perso.
 */
export async function releaseConRapporto(t, fault, report, opts) {
  const tenta = (rep) => release(t, fault, opts, rep);
  if (!report || typeof report !== 'object') return { ...(await tenta(null)), rapporto: 'assente' };
  const malformato = (r) => r.status === 400 && r.reason === 'report_malformed';
  // Il dettaglio è nella PRIMA risposta (quella che ha rifiutato il
  // rapporto), non nella seconda: letto dopo la ritentata si perdeva.
  const dettaglioDi = (r) => (r.body && r.body.detail ? `: ${r.body.detail}` : '');
  const avvisi = [];
  // Un server che non conosce ancora `listino` (#882) non deve costare il rapporto intero a ogni rilascio.
  const tentaRapporto = async (rep) => {
    const r = await tenta(rep);
    if (!malformato(r) || !Object.prototype.hasOwnProperty.call(rep, 'listino')) return r;
    const { listino, ...senza } = rep;
    if (Array.isArray(rep.notes)) senza.notes = [...rep.notes, `listino ${listino}`];
    const r2 = await tenta(senza);
    if (malformato(r2)) return r;
    if (r2.ok) avvisi.push(`il server non accetta il campo listino (report_malformed${dettaglioDi(r)}): ${senza.notes ? 'la versione è nelle note' : 'allegato senza la versione del listino'}.`);
    return r2;
  };
  const conAvvisi = (r, rapporto, avviso) => {
    const righe = [...avvisi, ...(avviso ? [avviso] : [])];
    return { ...r, rapporto: rapporto === 'allegato' && avvisi.length ? 'ridotto' : rapporto, ...(righe.length ? { avviso: righe.join(' ') } : {}) };
  };
  let r = await tentaRapporto(report);
  if (r.status === 413 && r.reason === 'report_too_big') {
    const misura = `${r.body && r.body.bytes ? r.body.bytes : '?'} byte, massimo ${r.body && r.body.max ? r.body.max : '?'}`;
    const snello = { ...report, tools: { ...(report.tools || {}) } };
    delete snello.tools.byName;
    delete snello.notes;
    r = await tentaRapporto(snello);
    if (r.status === 413 && r.reason === 'report_too_big') {
      r = await tenta(null);
      return conAvvisi(r, 'scartato', `rapporto troppo grande anche senza l'elenco degli strumenti (${misura}): rilasciato SENZA rapporto.`);
    }
    if (!malformato(r)) return conAvvisi(r, 'ridotto', `rapporto troppo grande (${misura}): allegato senza l'elenco degli strumenti e le note.`);
  }
  if (malformato(r)) {
    const dettaglio = dettaglioDi(r);
    r = await tenta(null);
    return conAvvisi(r, 'scartato', `il server non ha capito il rapporto (report_malformed${dettaglio}): rilasciato SENZA rapporto.`);
  }
  return conAvvisi(r, 'allegato');
}

// ─── Domanda di fine sessione (endpoint routineClosing) ─────────────────────

/** Il corpo della richiesta: una credenziale sola, il server ne rifiuta due o nessuna. PURA. */
export function corpoChiusura(op, { passphrase = '', ticket = '', id = '', answer, requestId = '' } = {}) {
  if (!passphrase === !ticket) throw new Error('serve esattamente una fra parola d\'ordine e biglietto');
  const corpo = passphrase ? { passphrase: String(passphrase), op } : { ticket: String(ticket), op };
  if (op === 'question' && passphrase && requestId) corpo.requestId = String(requestId);
  if (op === 'answer') {
    if (passphrase) corpo.id = String(id || '');
    corpo.answer = String(answer ?? '');
  }
  return corpo;
}

/**
 * Traduce la risposta di `routineClosing`. PURA.
 * 'assente' = nessuna domanda da avere (endpoint che non c'è, rete, 5xx): si
 * chiude comunque. 'rifiutato' = il server ha guardato e ha detto no.
 */
export function leggiRispostaChiusura(status, body) {
  const b = body || {};
  if (status === 200 && b.ok) {
    return { esito: 'ok', question: typeof b.question === 'string' ? b.question : '', id: b.id ? String(b.id) : '' };
  }
  const reason = String(b.reason || `http_${status}`);
  // Un 404 senza motivo del server è la funzione che non esiste (pagina HTML);
  // `bad_closing` è un 404 vero del server, e resta un rifiuto.
  const senzaServer = status === 0 || status >= 500 || b.reason === 'malformed_response' || (status === 404 && !b.reason);
  if (senzaServer) return { esito: 'assente', reason: status === 404 ? 'endpoint_assente' : reason };
  const out = { esito: 'rifiutato', reason };
  if (b.detail) out.detail = String(b.detail);
  if (b.bytes !== undefined) out.bytes = b.bytes;
  if (b.max !== undefined) out.max = b.max;
  return out;
}

export const EXIT_CHIUSURA = { ok: 0, assente: 2, rifiutato: 4 };

/** La riga da stampare su un rifiuto: su `answer_too_big` coi numeri, perché chi scrive accorci lui. PURA. */
export function testoRifiutoChiusura(r) {
  if (r.reason === 'answer_too_big') {
    return `RIFIUTATO dal server: answer_too_big — la risposta è di ${r.bytes ?? '?'} byte, il massimo è ${r.max ?? '?'}. `
      + 'Non è stato salvato niente: accorciala tu e rilancia.';
  }
  return `RIFIUTATO dal server: ${r.reason}${r.detail ? `: ${r.detail}` : ''}`;
}

export async function domandaChiusura(cred, opts) {
  // Un id per invocazione, uguale in tutti i ritentativi di call(): il server ritrova lo
  // stesso documento invece di crearne uno orfano per ogni 5xx arrivato dopo la scrittura.
  const requestId = cred.passphrase ? randomUUID() : '';
  const { status, body } = await call('routineClosing', { ...corpoChiusura('question', { ...cred, requestId }), ...creditiDi(opts) }, opts);
  const r = leggiRispostaChiusura(status, body);
  // Senza testo, o senza l'id con cui rispondere, non c'è una domanda a cui rispondere.
  if (r.esito === 'ok' && (!r.question.trim() || (cred.passphrase && !r.id))) return { esito: 'assente', reason: 'busta_incompleta' };
  return r;
}

export async function rispostaChiusura(cred, answer, opts) {
  const { status, body } = await call('routineClosing', { ...corpoChiusura('answer', { ...cred, answer }), ...creditiDi(opts) }, opts);
  return leggiRispostaChiusura(status, body);
}

/**
 * Le parole di `domanda` e `risposta`: la parola d'ordine (orchestratore) o
 * `--biglietto` (worker), mai tutte e due. PURA.
 * @returns {{ cred: object } | { errore: string }}
 */
export function argomentiChiusura(cmd, args, data = {}) {
  const uso = cmd === 'risposta'
    ? 'risposta "<parola-d-ordine>" <id>  oppure  risposta --biglietto <biglietto>, col testo da stdin'
    : 'domanda "<parola-d-ordine>"  oppure  domanda --biglietto <biglietto>';
  const estranei = Object.keys(data).filter((k) => k !== 'biglietto');
  if (estranei.length) return { errore: `--${estranei[0]} non vale qui. Uso: ${uso}` };
  const biglietto = typeof data.biglietto === 'string' ? data.biglietto.trim() : '';
  if (biglietto) {
    if (args.length) return { errore: `Argomento non capito: "${String(args[0]).slice(0, 40)}": col biglietto non serve altro. Uso: ${uso}` };
    return { cred: { ticket: biglietto } };
  }
  const attesi = cmd === 'risposta' ? 2 : 1;
  if (args.length !== attesi || args.some((a) => !String(a).trim())) return { errore: `Uso: ${uso}` };
  return { cred: cmd === 'risposta' ? { passphrase: args[0], id: args[1] } : { passphrase: args[0] } };
}

/** Il comando esatto per rispondere, stampato insieme alla domanda. La parola d'ordine resta segnaposto. PURA. */
export function comandoRisposta(io, cred, id) {
  const chi = cred.ticket ? `--biglietto ${cred.ticket}` : `"<parola-d-ordine>" ${id}`;
  return `node "${io}" risposta ${chi} <<'FINE'\n<la tua risposta>\nFINE`;
}

/**
 * Spedisce il ramo corrente su origin, prima del rilascio. L'hook di
 * salvataggio parte solo su Edit/Write: un `git commit` fatto a mano dal
 * worker restava a terra, e il contenitore moriva con lui (giro del 14/09).
 *
 * Salta (ok, skipped) con una HEAD staccata o su un ramo protetto — la stessa
 * regola dell'hook e di finish-local (lib/branch-integrity.isProtectedBranch:
 * main, master, il default dichiarato da origin). Prima un push normale; se
 * git lo rifiuta per storia divergente (un rebase), --force-with-lease, che
 * è contro il ref remoto conosciuto: se qualcun altro ha spinto nel frattempo
 * git rifiuta, ed è giusto così. Un fallimento torna con la causa: chi chiama
 * NON rilascia.
 */
export function pushRamoCorrente(root, { exec = execFileSync, env = process.env } = {}) {
  const run = (args) => {
    try {
      return { ok: true, out: String(exec('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) || '').trim() };
    } catch (e) {
      const testo = String((e && (e.stderr || e.stdout)) || (e && e.message) || '').trim();
      return { ok: false, out: testo };
    }
  };
  const head = run(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!head.ok) return { ok: false, skipped: false, branch: '', reason: `stato di git illeggibile: ${head.out}` };
  const ramo = head.out;
  if (ramo === 'HEAD') return { ok: true, skipped: true, branch: '', reason: 'HEAD staccata: nessun ramo da spedire' };
  const def = run(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  const principale = def.ok ? def.out.replace(/^origin\//, '') : '';
  if (isProtectedBranch(ramo, principale)) return { ok: true, skipped: true, branch: ramo, reason: `'${ramo}' è un ramo protetto: non si spedisce da qui` };
  // La destinazione si dichiara sulla riga stessa (sorgente:destinazione),
  // come nell'hook: una sentinella negli unit test la cerca lì.
  // Come l'hook: una copia dei dati del server nei commit da spedire si toglie dalla loro storia, o il ramo non parte (#1108).
  let copie = { stato: 'pulito', avviso: '' };
  const routine = isRoutineInstance(root, { env });
  try {
    copie = spedibileSenzaCopie(root, routine ? { nome: 'claude-routine', email: 'claude@routine' } : {});
  } catch (_) { /* senza elenco si spedisce come prima: la sentinella resta la seconda rete */ }
  if (copie.stato === 'fermo') return { ok: false, skipped: false, branch: ramo, reason: copie.avviso };
  try { installaControlloSpedizione(root); } catch (_) { /* il controllo qui sopra c'è già stato */ }
  const avviso = copie.avviso ? { avviso: copie.avviso } : {};
  const push = run(['push', 'origin', `HEAD:refs/heads/${ramo}`]);
  if (push.ok) return { ok: true, skipped: false, branch: ramo, ...avviso };
  // «! [remote rejected]» è il SERVER che dice di no (un pre-receive, una
  // regola del repo, il push protection): non è storia divergente, un rebase
  // non lo cura e il lease non si tenta (verifica del giro 4, stessa regola
  // dell'hook di salvataggio).
  if (/\[remote rejected\]/i.test(push.out)) {
    return { ok: false, skipped: false, branch: ramo, reason: `il server remoto ha rifiutato il push (una regola del repo, un pre-receive, il push protection?): ${pulisciGit(push.out)}` };
  }
  if (/rejected|non-fast-forward|fetch first|stale info/i.test(push.out)) {
    // --force-if-includes: il lease da solo si fida del ref remoto che questa
    // copia conosce, e dopo un `git fetch` quel ref è già il commit dell'altro
    // — il lease combacia e il rinvio lo sovrascrive (verifica del giro 2).
    // Con --force-if-includes git rifiuta se quel commit non è mai passato
    // dalla storia locale di questo ramo.
    const lease = run(['push', '--force-with-lease', '--force-if-includes', 'origin', `HEAD:refs/heads/${ramo}`]);
    if (lease.ok) return { ok: true, skipped: false, branch: ramo, forced: true, ...avviso };
    return { ok: false, skipped: false, branch: ramo, reason: `storia divergente, e anche --force-with-lease è stato rifiutato (qualcun altro ha spinto su '${ramo}'?): ${pulisciGit(lease.out)}` };
  }
  return { ok: false, skipped: false, branch: ramo, reason: pulisciGit(push.out) };
}

/**
 * La consegna di un riallineamento: il marcatore del correttore porta in `dal` il commit verificato. Una che si ferma
 * con una domanda che blocca non riallinea niente. Regola unica per dispatch --record-fixed e deliver fixed. PURA.
 */
export function consegnaDiRiallineamento(marcatore, { ferma = false, domanda = null } = {}) {
  const siFerma = ferma === true || !!(domanda && typeof domanda === 'object' && domanda.blocca !== false);
  return !!(marcatore && marcatore.role === 'fixer' && marcatore.dal) && !siFerma;
}

/**
 * Un riallineamento si registra solo se su origin c'è (#1964): registrato col ramo remoto fermo al commit verificato,
 * chi verificava dopo trovava un diff vuoto. La punta contiene la linea principale, parte, e origin la rilegge uguale.
 * → { ok, branch, punta, main, forced } | { ok:false, tipo: 'base'|'ramo'|'spedizione', reason }
 */
export function spedisciRiallineamento(root, { exec = execFileSync, env = process.env, base = 'refs/remotes/origin/main' } = {}) {
  const run = (args) => {
    try {
      return { ok: true, out: String(exec('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) || '').trim() };
    } catch (e) {
      return { ok: false, out: String((e && (e.stderr || e.stdout)) || (e && e.message) || '').trim() };
    }
  };
  const punta = run(['rev-parse', '--verify', 'HEAD^{commit}']);
  if (!punta.ok || !punta.out) return { ok: false, tipo: 'ramo', reason: `stato di git illeggibile: ${pulisciGit(punta.out)}` };
  const nomeMain = base.replace(/^refs\/remotes\//, '');
  const main = run(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  if (!main.ok || !main.out) return { ok: false, tipo: 'base', reason: `qui non c'è ${nomeMain}, la linea principale su cui si rifà la base` };
  if (!run(['merge-base', '--is-ancestor', main.out, punta.out]).ok) {
    return { ok: false, tipo: 'base', reason: `la punta ${punta.out.slice(0, 9)} non contiene ${nomeMain} (${main.out.slice(0, 9)}): il rebase non c'è, o è partito da una linea principale più vecchia di quella scaricata` };
  }
  const p = pushRamoCorrente(root, { exec, env });
  if (!p.ok) return { ok: false, tipo: 'spedizione', branch: p.branch, reason: `il ramo${p.branch ? ` '${p.branch}'` : ''} non arriva su origin: ${p.reason}` };
  if (p.skipped) return { ok: false, tipo: 'ramo', branch: p.branch, reason: `il ramo non parte: ${p.reason}` };
  // La spedizione può rifare i commit per togliere una copia dei dati: si confronta la punta di adesso.
  const dopo = run(['rev-parse', '--verify', 'HEAD^{commit}']);
  const ref = `refs/heads/${p.branch}`;
  const remoto = run(['ls-remote', 'origin', ref]);
  if (!remoto.ok) return { ok: false, tipo: 'spedizione', branch: p.branch, reason: `spedito, ma non riesco a rileggere '${p.branch}' su origin: ${pulisciGit(remoto.out)}` };
  const riga = remoto.out.split('\n').map((l) => l.trim().split(/\s+/)).find((c) => c[1] === ref);
  const su = riga ? riga[0].toLowerCase() : '';
  if (!dopo.ok || su !== dopo.out.toLowerCase()) {
    return { ok: false, tipo: 'spedizione', branch: p.branch, reason: `su origin '${p.branch}' ${su ? `è a ${su.slice(0, 9)}` : 'non c\'è'}, non alla punta della cartella ${dopo.out.slice(0, 9)}` };
  }
  return { ok: true, branch: p.branch, punta: dopo.out, main: main.out, forced: !!p.forced, ...(p.avviso ? { avviso: p.avviso } : {}) };
}

/** Il rifiuto di un riallineamento non spedito, uguale dalle due strade di consegna. PURA. */
export function testoRiallineamentoNonSpedito(sped) {
  return [
    `Riallineamento NON consegnato: ${sped.reason}.`,
    'Il server non ha registrato niente: chi verifica dopo di te legge il ramo da origin, e senza il rebase lì troverebbe il commit già verificato.',
    sped.tipo === 'spedizione'
      ? 'Non spingere a mano: in cloud il controllo dei permessi ferma il push. Se la causa sta nel ramo (una copia dei dati nella storia, detta qui sopra) toglila e rilancia lo stesso comando; altrimenti è un guasto: fai la domanda di fine sessione e rilascia con --guasto "guasto: github: <il messaggio qui sopra>" --senza-push. Il lavoro torna in coda sul suo ramo.'
      : sped.tipo === 'base'
        ? 'Rifai la base sulla linea principale (`git fetch origin main`, poi `git rebase origin/main`), poi rilancia lo stesso comando.'
        : 'Riporta la cartella sul ramo del lavoro, a rebase finito, poi rilancia lo stesso comando.',
  ].join('\n');
}

/**
 * Committa quello che è rimasto fuori dai commit, prima di spedire. L'hook di
 * salvataggio parte solo su Edit/Write: un file nato da una shell (rm, mv, un
 * generatore) al rilascio non era in nessun commit, il rilascio spediva HEAD,
 * diceva «spedito» e quel lavoro moriva col contenitore (giro del 14/09,
 * verifica). Stesse regole dell'hook: niente commit su un ramo protetto o a
 * HEAD staccata; l'autore dice la provenienza (routine o locale). Torna
 * { ok, skipped, committed: [file…], reason }: un `ok` falso ferma il rilascio.
 */
export function commitRestante(root, { exec = execFileSync, env = process.env } = {}) {
  const run = (args) => {
    try {
      return { ok: true, out: String(exec('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) || '').trim() };
    } catch (e) {
      return { ok: false, out: String((e && (e.stderr || e.stdout)) || (e && e.message) || '').trim() };
    }
  };
  const head = run(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!head.ok) return { ok: false, skipped: false, committed: [], reason: `stato di git illeggibile: ${head.out}` };
  // Prima della HEAD staccata: durante un rebase la HEAD È staccata, e un
  // rilascio che «salta» in silenzio lascerebbe il ramo a metà e mai su
  // origin. Qui si dice cosa finire, e il rilascio si ferma.
  const aMeta = operazioneGitInCorso(root, { exec });
  if (aMeta) return { ok: false, skipped: false, committed: [], reason: `${aMeta} è a metà: finiscila prima (risolvi i file, git add, poi git rebase --continue o git commit), o metterei in commit i segni di conflitto` };
  if (head.out === 'HEAD') return { ok: true, skipped: true, committed: [], reason: 'HEAD staccata: non committo' };
  const def = run(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  const principale = def.ok ? def.out.replace(/^origin\//, '') : '';
  if (isProtectedBranch(head.out, principale)) return { ok: true, skipped: true, committed: [], reason: `'${head.out}' è un ramo protetto: non committo` };
  const st = statoDirectory(root);
  if (!st.ok) return { ok: false, skipped: false, committed: [], reason: `non so cosa c'è fuori dai commit: ${st.motivo}` };
  if (!st.lines.length) return { ok: true, skipped: false, committed: [], reason: '' };
  const add = run(['add', '-A']);
  if (!add.ok) return { ok: false, skipped: false, committed: [], reason: pulisciGit(add.out) };
  // Un file nato da shell è il modo più comune di scaricare una copia dei dati del server: come l'hook, resta fuori (#1108).
  let fuori = [];
  try { fuori = copieInScena(root).map((c) => c.file); } catch (_) { /* la spedizione ricontrolla i commit */ }
  for (const f of fuori) if (!run(['reset', '-q', '--', f]).ok) run(['rm', '-q', '--cached', '--', f]);
  let restano = st.lines;
  if (fuori.length) {
    try { escludiInLocale(root, fuori); } catch (_) { /* l'avviso parte lo stesso */ }
    restano = run(['diff', '--cached', '--name-only']).out.split('\n').filter(Boolean);
    if (!restano.length) return { ok: true, skipped: false, committed: [], fuori, reason: '' };
  }
  const routine = isRoutineInstance(root, { env });
  const nome = routine ? 'claude-routine' : 'claude-local';
  const email = routine ? 'claude@routine' : 'claude@local';
  const elenco = `${restano.slice(0, 3).join(', ')}${restano.length > 3 ? ` (+${restano.length - 3} file)` : ''}`;
  const commit = run(['-c', `user.name=${nome}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', `auto: rilascio — ${elenco}`]);
  if (!commit.ok) return { ok: false, skipped: false, committed: [], reason: pulisciGit(commit.out) };
  return { ok: true, skipped: false, committed: restano, fuori, reason: '' };
}

/**
 * Un'operazione di git ferma a metà in `root` — «un rebase», «una fusione»,
 * «un cherry-pick», «un revert», o «la risoluzione di un conflitto» (file
 * non ancora fusi nell'indice) — oppure '' se non ce n'è nessuna. Stessa
 * regola dell'hook di salvataggio: in quel momento `git add -A` metterebbe in
 * commit i segni di conflitto (giro del 14/09, terza verifica).
 */
export function operazioneGitInCorso(root, { exec = execFileSync } = {}) {
  const run = (args) => {
    try {
      return { ok: true, out: String(exec('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) || '').trim() };
    } catch (_) {
      return { ok: false, out: '' };
    }
  };
  const gitDir = run(['rev-parse', '--absolute-git-dir']);
  if (gitDir.ok && gitDir.out) {
    for (const [nome, cosa] of [['rebase-merge', 'un rebase'], ['rebase-apply', 'un rebase'], ['MERGE_HEAD', 'una fusione'], ['CHERRY_PICK_HEAD', 'un cherry-pick'], ['REVERT_HEAD', 'un revert']]) {
      if (existsSync(join(gitDir.out, nome))) return cosa;
    }
  }
  const nonFusi = run(['ls-files', '-u']);
  if (nonFusi.ok && nonFusi.out) return 'la risoluzione di un conflitto';
  return '';
}

/** Le righe di git che dicono qualcosa (via i `hint:` e le vuote), in una riga. */
function pulisciGit(testo) {
  return String(testo || '').split('\n').map((l) => l.trim()).filter((l) => l && !/^hint:|^To /.test(l)).slice(0, 3).join(' ');
}

/**
 * Distingue un RIFIUTO da un GUASTO. PURA, ed è la distinzione che regge tutto
 * cosa deve fare chi lavora quando il server dice no.
 *
 * Un rifiuto è una RISPOSTA: il server ha guardato e ha detto no (il ruolo non
 * può, il passaggio di stato è illegale, il ramo non combacia, il biglietto è
 * morto). Ripiegare sulla vecchia strada dopo un rifiuto vorrebbe dire fare
 * lo stesso a dispetto del controllo — cioè rimettere in piedi esattamente il
 * buco che questa spec viene a chiudere.
 *
 * Un guasto è il server che non risponde. Lì la vecchia strada è un ripiego
 * legittimo, ma va detto ad alta voce.
 */
export function classifyReply(status, body) {
  if (status === 200 && body && body.ok) return 'ok';
  if (status === 0 || status >= 500) return 'fault';
  // Una risposta che non si legge (una pagina HTML al posto del JSON) non è
  // un no del server: è il server che non ha risposto. Detta come rifiuto
  // mandava a «leggere il motivo» di un motivo che non c'era (verifica del
  // giro 3 su questo lavoro).
  if (body && body.reason === 'malformed_response') return 'fault';
  return 'refused';
}

/**
 * Consegna un intento al server. `data` NON contiene mai il feedback su cui si
 * agisce: quello il server lo legge dal biglietto.
 * `reply` è ciò che il server ha da dire a chi ha consegnato: per la critica
 * del verificatore (feedback #561) porta l'esito calcolato e, se c'è da
 * correggere, la fase 2. Per le altre consegne non c'è.
 * @returns {{ outcome:'ok'|'refused'|'fault', reason?, id?, num?, reply? }}
 */
export async function deliver(t, intent, data, opts) {
  const { status, body } = await call('routineDeliver', { ticket: t, intent, data: data || {} }, opts);
  const outcome = classifyReply(status, body);
  return {
    outcome,
    reason: String((body && body.reason) || (outcome === 'ok' ? '' : `http_${status}`)),
    // La frase del rifiuto, quando il server la dà: senza, «malformed» non dice
    // se manca il riassunto, il commit o il testo di un rilievo.
    detail: String((body && body.detail) || ''),
    id: body && body.id,
    num: body && body.num,
    reply: body && typeof body.reply === 'object' ? body.reply : undefined,
  };
}

export async function compare(t, mine, opts) {
  const { status, body } = await call('routineCompare', { ticket: t, mine }, opts);
  return { ok: status === 200 && !!(body && body.ok), same: !!(body && body.same) };
}

/**
 * Autodichiarazione (SPEC-DOMANDE.md §1.2, #1148): chi lavora ha letto qualcosa che il server non vede (una pagina, un
 * file fuori dal repo) e si dichiara sporco. Da qui in poi ciò che scrive nasce non fidato; nessuna strada fa il contrario.
 */
export async function sporca(t, motivo, opts) {
  const { status, body } = await call('routineSporca', { ticket: t, motivo: String(motivo || '') }, opts);
  if (status === 200 && body && body.ok) return { outcome: 'ok', fiducia: body.fiducia };
  if (status === 404) return { outcome: 'fault', reason: 'routineSporca non è ancora pubblicata sul server' };
  return { outcome: status >= 500 || status === 0 ? 'fault' : 'refused', reason: String((body && body.reason) || `http_${status}`) };
}

/**
 * Un'operazione del biglietto (#1153, SPEC-DOMANDE.md §5): `segnala` e `rapporto`, e quelle del suo ambito. Il server
 * decide cosa si può fare: qui si porta la richiesta e si riporta la risposta com'è.
 * @returns {{ outcome:'ok'|'refused'|'fault', body?, reason?, detail? }}
 */
export async function operazione(t, op, dati, opts) {
  const { status, body } = await call('routineOperazione', { ticket: t, op: String(op || ''), dati: dati && typeof dati === 'object' ? dati : {} }, opts);
  if (status === 200 && body && body.ok) return { outcome: 'ok', body };
  if (status === 404 && !(body && body.reason)) return { outcome: 'fault', reason: 'routineOperazione non è ancora pubblicata sul server' };
  return {
    outcome: status >= 500 || status === 0 ? 'fault' : 'refused',
    reason: String((body && body.reason) || `http_${status}`),
    detail: String((body && body.detail) || ''),
  };
}

/** I dati di un'operazione dalla riga (`'{"id":"…"}'`) o da stdin; '' → {}. PURA. → { dati } | { errore } */
export function datiOperazione(grezzo) {
  const t = String(grezzo || '').trim();
  if (!t) return { dati: {} };
  let dati;
  try { dati = JSON.parse(t); } catch (e) { return { errore: `i dati sono un oggetto JSON, per esempio '{"id":"abc"}': ${e.message}` }; }
  if (!dati || typeof dati !== 'object' || Array.isArray(dati)) return { errore: 'i dati sono un oggetto JSON, per esempio \'{"id":"abc"}\'' };
  return { dati };
}

// ─── Lavori server (SPEC-DOMANDE.md §7, mappa #1159 §1.5) ────────────────────

/** Il token di filo-lavori per il biglietto (routineGitToken). → { outcome:'ok', token, scadeIl } | { outcome, reason } */
export async function gitToken(t, opts) {
  const { status, body } = await call('routineGitToken', { ticket: t, repo: 'server' }, opts);
  if (status === 200 && body && body.ok && body.token) return { outcome: 'ok', token: String(body.token), scadeIl: Number(body.scadeIl) || 0 };
  if (status === 404 && !(body && body.reason)) return { outcome: 'fault', reason: 'routineGitToken non è ancora pubblicata sul server' };
  return {
    outcome: status >= 500 || status === 0 ? 'fault' : 'refused',
    reason: String((body && body.reason) || `http_${status}`),
    detail: String((body && body.detail) || ''),
  };
}

/** Il ramo spinto su filo-security entra nel registro (routineRamoServer). → { outcome, sha?, ramoFidato?, reason? } */
export async function ramoServer(t, ramo, sha, opts) {
  const { status, body } = await call('routineRamoServer', { ticket: t, ramo: String(ramo || ''), sha: String(sha || '') }, opts);
  if (status === 200 && body && body.ok) return { outcome: 'ok', sha: String(body.sha || ''), ramoFidato: body.ramoFidato === true, fiducia: body.fiducia };
  if (status === 404 && !(body && body.reason)) return { outcome: 'fault', reason: 'routineRamoServer non è ancora pubblicata sul server' };
  return {
    outcome: status >= 500 || status === 0 ? 'fault' : 'refused',
    reason: String((body && body.reason) || `http_${status}`),
    detail: String((body && body.detail) || ''),
  };
}

/**
 * `git-server <azione> <cartella> [<ramo>]`: un git verso filo-security solo dopo il sì del server al biglietto. In
 * locale il token di quel sì va a quella sola chiamata; in cloud no, autentica il proxy della sessione (#1761).
 * → exit: 0 fatto, 1 uso o git fallito, 3 guasto, 4 token rifiutato. `lancia`, `token` ed `eco` per le prove.
 */
export async function eseguiGitServer({
  azione, cartella, ramo, biglietto, root = ROOT, env = process.env, strada = stradaGitServer(env),
  lancia = (argv, o) => spawnSync('git', argv, o), token = gitToken, scrivi = (r) => console.error(r),
  eco = (dove, testo) => (dove === 'out' ? process.stdout : process.stderr).write(testo),
} = {}) {
  const clonato = Boolean(String(cartella || '').trim()) && existsSync(join(resolve(String(cartella)), '.git'));
  const piano = pianoGitServer({ azione, cartella, ramo, root, clonato });
  if (piano.errore) { scrivi(`git-server: ${piano.errore} Il server non è stato chiamato.`); return 1; }
  if (piano.nota) scrivi(`git-server: ${piano.nota}`);
  if (piano.controllaOrigin) {
    const { env: ambienteNudo } = ambienteGitServer(env, '');
    const url = (dove) => {
      const r = lancia(['-C', piano.dir, 'remote', 'get-url', ...dove, 'origin'], { env: ambienteNudo, encoding: 'utf8' });
      return r && r.status === 0 ? String(r.stdout || '').trim() : '';
    };
    for (const u of [url([]), url(['--push'])]) {
      if (originDelServer(u)) continue;
      scrivi(`git-server: l'origin del clone è «${urlSenzaSegreti(u) || 'assente'}», non ${URL_SERVER}: il token non esce. Il server non è stato chiamato.`);
      return 1;
    }
  }
  if (!biglietto) { scrivi('NESSUN BIGLIETTO: il server non è stato chiamato. Passalo con --ticket <codice>.'); return 1; }
  const t = await token(biglietto);
  if (t.outcome !== 'ok') {
    const motivo = `${t.reason}${t.detail ? `: ${t.detail}` : ''}`;
    scrivi(t.outcome === 'refused' ? `RIFIUTATO dal server: niente token per filo-security (${motivo}).` : `guasto ${motivo}`);
    return t.outcome === 'refused' ? 4 : 3;
  }
  // In cloud il sì serve lo stesso: biglietto pulito, ambito e registro del ramo li decide il server a ogni chiamata,
  // anche se il token che porta resta qui e non arriva a git.
  const viaProxy = strada === 'proxy';
  const segreto = viaProxy ? '' : t.token;
  const { env: figlio, tolte } = viaProxy ? { env: ambienteViaProxy(env), tolte: [] } : ambienteGitServer(env, t.token);
  const verbo = piano.argv[0] === 'clone' ? 'clone' : piano.argv[2];
  if (viaProxy) {
    scrivi(`git-server: il server dà il via al biglietto. In cloud git ${verbo} su filo-security passa dal proxy della sessione, con le sue credenziali: il token non si usa.`);
  } else {
    const scade = t.scadeIl ? ` (scade alle ${new Date(t.scadeIl).toISOString().slice(11, 16)} UTC)` : '';
    scrivi(`git-server: token del biglietto ottenuto${scade}, git ${verbo} su filo-security.`);
    if (tolte.length) scrivi(`git-server: tolti per questa chiamata: ${[...new Set(tolte)].join(', ')}.`);
  }
  // L'URL con dentro il token può finire in un messaggio di git: l'uscita passa da qui, ripulita, mai diretta.
  const r = lancia(piano.argv, { env: figlio, stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r && r.stdout) eco('out', senzaToken(r.stdout, segreto));
  if (r && r.stderr) eco('err', senzaToken(r.stderr, segreto));
  if (r && r.error) { scrivi(`git-server: git non parte o si è fermato (${r.error.code || r.error.message}).`); return 1; }
  if (viaProxy && (!r || r.status !== 0)) {
    const respinto = chiHaRespinto(r && r.stderr)
      ? 'le credenziali le mette il proxy della sessione, che serve solo i repository agganciati alla sessione: se '
        + 'filo-security non è fra i repository della routine (claude.ai/code/routines), aggiungerlo è un passo dell\'owner. '
        + 'Il testo esatto, sopra, è quello da riportare.'
      : 'il motivo è nel testo di git, sopra.';
    scrivi(`git-server: git è uscito con ${r ? (r.status ?? r.signal) : '?'}. In cloud ${respinto}`);
    return 1;
  }
  if (!r || r.status !== 0) {
    const chi = {
      proxy: 'a respingerlo è il proxy della sessione, non GitHub: il token non è arrivato a GitHub. Il testo esatto, sopra, è quello da riportare.',
      github: 'GitHub l\'ha respinto (scaduto, revocato, o il biglietto non porta il repo).',
      ignoto: 'il rifiuto non dice chi lo manda: può essere GitHub o il proxy della sessione. Il testo esatto, sopra, è quello da riportare.',
    }[chiHaRespinto(r && r.stderr)] || 'il motivo è nel testo di git, sopra.';
    scrivi(`git-server: git è uscito con ${r ? (r.status ?? r.signal) : '?'}. Il token c'era, nell'URL di ${URL_SERVER} per questa sola chiamata: ${chi}`);
    return 1;
  }
  return 0;
}

// ─── L'impronta dichiarata a mano ────────────────────────────────────────────
//
// L'impronta del contenuto la timbra lo strumento. Una dichiarata sulla riga di
// comando può solo CONFERMARE quella vera, mai sostituirla: è la stessa regola
// che questo canale applica al nome del ramo (feedback #485).
//
// Confermare però vuol dire riconoscere la STESSA versione, non ricopiarla
// lettera per lettera nella forma lunga. Gli strumenti stampano le impronte
// accorciate a dodici lettere dappertutto, e git stesso tratta la forma corta
// come il commit intero: rifiutare chi conferma con quello che ha appena letto
// a schermo è attrito, e il rifiuto arrivava con un messaggio che si
// contraddiceva («hai dichiarato 1774f56387b9, ma la directory è su
// 1774f56387b9»: le stesse dodici lettere due volte, con dentro scritto che
// sono diverse).

/** Sotto questo numero di lettere un pezzo di impronta non conferma niente. */
export const MIN_IMPRONTA_CHARS = 7;

/**
 * L'impronta dichiarata conferma quella vera? PURA.
 *
 * Confermano: la stessa impronta, scritta in maiuscolo o minuscolo (sono
 * lettere esadecimali, la forma non cambia il commit), e una sua forma
 * abbreviata di almeno `MIN_IMPRONTA_CHARS` lettere. Non conferma un pezzo più
 * corto di così, che combacerebbe anche con commit diversi, né un'impronta che
 * non è un inizio di quella vera.
 *
 * `motivo`: 'punta_sconosciuta' | 'troppo_corta' | 'altro_commit'.
 */
export function confermaImpronta(dichiarato, punta) {
  const d = String(dichiarato || '').trim().toLowerCase();
  const p = String(punta || '').trim().toLowerCase();
  if (!d) return { ok: true, motivo: '' };
  if (!p) return { ok: false, motivo: 'punta_sconosciuta' };
  if (d === p) return { ok: true, motivo: '' };
  if (p.startsWith(d)) return d.length >= MIN_IMPRONTA_CHARS ? { ok: true, motivo: '' } : { ok: false, motivo: 'troppo_corta' };
  return { ok: false, motivo: 'altro_commit' };
}

/**
 * Il rifiuto per un'impronta che non conferma la punta vera. PURA.
 *
 * Le impronte si stampano accorciate, come ovunque, TRANNE quando le due forme
 * corte coincidono: lì mostrarle accorciate direbbe due volte la stessa cosa e
 * manderebbe chi legge a cercare una differenza che sullo schermo non c'è.
 */
export function testoImprontaDiversa(quale, dichiarato, punta, motivo = 'altro_commit') {
  const d = String(dichiarato || '');
  const p = String(punta || '');
  if (motivo === 'troppo_corta') {
    return `${quale}: hai dichiarato ${d}, che è più corto di ${MIN_IMPRONTA_CHARS} lettere, e la directory è su ${p.slice(0, 12)}. Un pezzo così corto combacia anche con commit diversi, quindi non conferma niente.\n`
      + 'Niente è stato consegnato: togli --sha e rilancia, che l\'impronta la timbra lo strumento, oppure scrivila per intero.';
  }
  const stessoCorto = d.slice(0, 12).toLowerCase() === p.slice(0, 12).toLowerCase();
  const mostra = (s) => (stessoCorto ? s : s.slice(0, 12));
  return `${quale}: hai dichiarato il commit ${mostra(d)}, ma la directory è su ${mostra(p)}.\n`
    + 'Niente è stato consegnato: un esito vale per il contenuto che hai davvero davanti, e l\'impronta la timbra lo strumento. Togli --sha e rilancia, oppure posizionati sul commit che hai esaminato.';
}

/**
 * Il rifiuto di una consegna fatta da fuori del ramo assegnato (#772): dov'è la cartella, qual è il ramo assegnato e
 * come tornarci. PURA. `g` è l'esito di guardiaConsegna; `sospesa` ({ ok, motivo }) c'è se il rifiuto ha toccato la soglia.
 */
export function testoConsegnaFuoriRamo(quale, g, sospesa = null) {
  const x = g || {};
  const nulla = 'Niente è stato consegnato.';
  const sospeso = (testa) => {
    const nonArrivata = sospesa && !sospesa.ok ? ` (ma la sospensione non è arrivata al server: ${sospesa.motivo || 'motivo ignoto'})` : '';
    return `${testa}Rifiuto ${x.count} di fila: la lavorazione automatica di questo feedback è sospesa e passa all'owner${nonArrivata}. Non rilanciare: rilascia il biglietto.`;
  };
  const conta = () => (x.count ? ` Rifiuto ${x.count} di ${IDENTITY_REJECT_LIMIT}: al ${IDENTITY_REJECT_LIMIT}° di fila il lavoro passa all'owner.` : '');
  if (x.motivo === 'rebase') {
    const di = x.rebaseDi && x.rebaseDi !== '?' ? ` del ramo "${x.rebaseDi}"` : '';
    return `${quale}: c'è un rebase in corso${di}. ${nulla}\n`
      + 'Finiscilo (risolvi i file in conflitto, `git add`, `git rebase --continue`), controlla che la cartella sia tornata sul ramo, poi rilancia lo stesso comando.';
  }
  if (x.motivo === 'cartella') {
    const ramo = x.current ? ` (ramo "${x.current}")` : '';
    const sul = x.assigned ? `, sul ramo assegnato "${x.assigned}"` : '';
    const testa = `${quale}: la consegna parte dalla cartella "${x.cartella}"${ramo}, ma il lavoro si consegna dalla cartella in cui è stato posizionato, "${x.radice}"${sul}. ${nulla}\n`;
    if (x.escalated) return sospeso(testa);
    return `${testa}Porta lì i commit del lavoro (\`git -C "${x.radice}" cherry-pick <i tuoi commit>\`), poi rilancia lo stesso comando da "${x.radice}".${conta()}`;
  }
  if (x.motivo === 'altrove') {
    const a = x.altrove || {};
    const n = (a.commit || []).length;
    const ramo = a.ramo ? ` (ramo "${a.ramo}")` : '';
    const testa = `${quale}: la cartella "${a.cartella}"${ramo} ha ${n === 1 ? 'un commit fatto' : `${n} commit fatti`} dopo l'inizio di questo lavoro che il ramo assegnato "${x.assigned}" non contiene: il lavoro sta lì, e la verifica non lo troverebbe. ${nulla}\n`;
    if (x.escalated) return sospeso(testa);
    return `${testa}Portali sul ramo assegnato (\`git -C "${a.radice}" cherry-pick ${(a.commit || []).map((c) => c.slice(0, 12)).join(' ')}\`), poi rilancia lo stesso comando. Se quei commit non sono di questo lavoro, togli quella cartella (\`git worktree remove "${a.cartella}"\`: il suo ramo resta) e rilancia.${conta()}`;
  }
  if (x.motivo === 'dichiarato') {
    return `${quale}: hai dichiarato il ramo "${x.declared}", ma la cartella è sul ramo "${x.current}". ${nulla} Il ramo lo legge lo strumento dalla cartella: uno dichiarato può solo confermarlo.\n`
      + (x.assigned && x.assigned === x.current
        ? 'La cartella è sul ramo assegnato: togli --branch e rilancia.'
        : `Se il lavoro sta su "${x.declared}", torna lì (\`git checkout ${x.declared}\`) e rilancia; se sta su "${x.current}", togli --branch.`);
  }
  const dove = x.current ? `sul ramo "${x.current}"${x.motivo === 'principale' ? ', la linea principale' : ''}`
    : x.rebaseDi ? (x.rebaseDi === '?' ? 'a metà di un rebase' : `a metà del rebase di "${x.rebaseDi}"`) : 'staccata, su nessun ramo';
  const atteso = x.assigned ? `il ramo assegnato a questo lavoro è "${x.assigned}"` : 'una consegna che va in verifica parte dal ramo del lavoro';
  const testa = `${quale}: la cartella è ${dove}, ma ${atteso}. ${nulla}\n`;
  if (x.escalated) return sospeso(testa);
  const prima = !x.current && x.rebaseDi ? 'Chiudi quel rebase (`git rebase --continue` o `git rebase --abort`), poi torna' : 'Torna';
  const comando = `git checkout ${x.assigned || '<il ramo del tuo lavoro>'}`;
  const lavoro = x.current ? ` su "${x.current}"` : '';
  return `${testa}${prima} sul ramo ${x.assigned ? 'assegnato' : 'del lavoro'} con \`${comando}\`; se hai committato il lavoro${lavoro}, portalo lì (\`git cherry-pick\` dei tuoi commit) e rilancia lo stesso comando.${conta()}`;
}

/** Gli intenti che una consegna conosce: decidono se la prima parola di `deliver` è un intento o un biglietto. */
/**
 * Cosa stampa una consegna registrata. Una con una domanda che blocca ferma il lavoro: chi consegna deve saperlo
 * adesso, o crede di averlo mandato in verifica; una domanda con «blocca» false (#1577) non lo ferma. PURA.
 */
export function testoConsegnaRiuscita(r, data = {}, intento = '') {
  const reply = r && r.reply && typeof r.reply === 'object' ? r.reply : null;
  const ok = r && r.num ? `OK: ${r.num}` : 'OK';
  const conDomanda = !!data.domanda && typeof data.domanda === 'object' && intento !== 'domanda';
  const cosa = conDomanda ? 'la domanda' : 'la fermata';
  if (reply && reply.outcome === 'stop') {
    const dom = typeof reply.domanda === 'string' && reply.domanda ? `, domanda ${reply.domanda}` : '';
    return `${ok}: il lavoro è FERMO e aspetta l'owner (${cosa} è consegnata${dom}). Rilascia il biglietto.`;
  }
  const provv = reply && (reply.outcome === 'provvisoria' ? reply.domanda : reply.domandaProvvisoria);
  if (typeof provv === 'string' && provv) return `${r.num ? ok : 'OK: consegnato'}. La domanda ${provv} non ferma il lavoro: vale la consigliata finché l'owner non risponde.`;
  if (reply && reply.outcome === 'server') return `${ok}: passato ai lavori server, che lo riprendono dal ramo. Rilascia il biglietto.`;
  if (conDomanda) return `${r && r.num ? ok : 'OK: consegnato'}. ATTENZIONE: la consegna portava ${cosa} ma il server non ha fermato il lavoro (server vecchio?).`;
  return r && r.num ? ok : 'OK: consegnato.';
}

export const INTENTI_CONSEGNA = ['verdict', 'fixed', 'secaudit', 'status', 'note', 'feedback', 'domanda', 'piano'];

/**
 * Una fermata (`--status design`) senza la domanda scritta da chi si ferma non parte (#1790): il server non ne compone
 * più. Fa eccezione `locale`, che va ai lavori server o ai Ricevuti senza domanda; un guasto non è una fermata e si
 * dichiara nel rilascio. Il testo del rifiuto, o ''. PURA.
 */
export function fermataSenzaDomanda(intento, data = {}) {
  if (intento !== 'status' || data.status !== 'design') return '';
  if (data.reason === 'guasto') {
    return 'Un guasto non è una fermata e non è una domanda (#1790): il lavoro torna in coda da sé. Dichiaralo nel rilascio, '
      + 'col gruppo e il messaggio esatto: release <biglietto> --role <il tuo ruolo> --guasto "<gruppo>: <il messaggio esatto>". Non ho consegnato niente.';
  }
  if (data.reason === 'locale' || (data.domanda && typeof data.domanda === 'object')) return '';
  return `Una fermata${data.reason ? ` («${String(data.reason).slice(0, 40)}»)` : ''} senza la tua domanda non parte: il server non compone domande (#1790). `
    + 'Scrivi la domanda in JSON (titolo fino a 10 parole, contesto, problema, almeno due opzioni con pro, contro e l\'azione, consiglio) '
    + 'e rilancia con --domanda <file.json>. Per il codice del server: --reason locale. Non ho consegnato niente.';
}

// Il piano di un lavoro grosso, che la sessione dopo riceve se questa muore: largo, ma con un tetto detto.
export const MAX_PIANO_BYTES = 64 * 1024;

/** Il piano letto dal file di `--piano`: { ok, testo } o { ok: false, errore } col rimedio. */
export function leggiPiano(file) {
  let testo = '';
  try { testo = readFileSync(resolve(String(file || '')), 'utf8'); } catch (e) {
    return { ok: false, errore: `Non leggo il piano in ${file} (${e.code || e.message}): non ho consegnato niente.` };
  }
  if (!testo.trim()) return { ok: false, errore: `Il piano in ${file} è vuoto: non ho consegnato niente.` };
  const byte = Buffer.byteLength(testo, 'utf8');
  if (byte > MAX_PIANO_BYTES) return { ok: false, errore: `Il piano è di ${byte} byte, il massimo è ${MAX_PIANO_BYTES}: accorcialo (le parti fatte bastano in una riga) e rilancia.` };
  return { ok: true, testo };
}

/**
 * «Già risolto su main» (SPEC-RIDISEGNO-LAVORO.md §3, regola 5): `--fusione` è una fusione sulla linea principale di
 * origin/main. Il server controlla da sé che citi il feedback e sia venuta dopo; qui si ferma prima chi sbaglia sha.
 * → { ok, sha } | { ok: false, errore }
 */
export function controllaFusione(root, sha, { ref = 'origin/main' } = {}) {
  const corto = String(sha || '').trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(corto)) return { ok: false, errore: `--fusione vuole lo sha della fusione su main che lo risolve, non "${corto.slice(0, 40)}".` };
  const g = (args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
  let intero = '';
  try { intero = g(['rev-parse', '--verify', '--quiet', `${corto}^{commit}`]); } catch (_) { /* sotto */ }
  if (!intero) return { ok: false, errore: `La fusione ${corto} qui non c'è: fai git fetch origin main e controlla lo sha.` };
  let linea = [];
  try { linea = g(['rev-list', '--first-parent', ref]).split('\n'); } catch (e) {
    return { ok: false, errore: `Non riesco a leggere ${ref} (${String(e.stderr || e.message).trim().split('\n')[0]}).` };
  }
  if (!linea.includes(intero)) return { ok: false, errore: `${corto} non è una fusione sulla linea principale di ${ref}: un commit dentro un ramo non dice che il lavoro è arrivato.` };
  return { ok: true, sha: intero };
}

// Quante parole vogliono questi comandi DOPO il biglietto (che sta sempre davanti).
const POSIZIONALI_DOPO_BIGLIETTO = { work: 0, heartbeat: 0, release: 0, compare: 2, deliver: 1 };

/** «Manca l'intento, o è scritto storto»: il testo è uno, per chi passa il biglietto a mano e per chi no. PURA. */
export function testoIntentoNonCapito(parola) {
  const p = String(parola || '');
  return `${p ? `Intento non capito: «${p.slice(0, 40)}».` : 'Manca l\'intento della consegna.'} Gli intenti sono: ${INTENTI_CONSEGNA.join(', ')}. Non ho consegnato niente.`;
}

/**
 * Il biglietto passato a mano (`--ticket` o `--biglietto`) vale allo stesso modo in ogni comando che ne
 * usa uno, con una regola sola sulla parola davanti: lo stesso biglietto (spazi intorno compresi) lo
 * conferma, una parola con la forma lunga di un biglietto vero è un secondo biglietto e si rifiuta, ogni
 * altra parola resta dopo il biglietto e la nominano i controlli del comando. Probe e ticket lo rifiutano
 * col motivo; `domanda` e `risposta` lo leggono da sé. PURA.
 * @returns {{ args: string[] } | { errore: string }}
 */
export function bigliettoAMano(cmd, args, dato) {
  const b = String(dato || '').trim();
  const lista = Array.isArray(args) ? [...args] : [];
  // Il biglietto davanti si ripulisce come quello a mano: uno spazio o un a capo copiati col codice il server li rifiuterebbe (#878).
  if (POSIZIONALI_DOPO_BIGLIETTO[cmd] !== undefined && typeof lista[0] === 'string') lista[0] = lista[0].trim();
  if (!b) return { args: lista };
  if (cmd === 'probe' || cmd === 'ticket') {
    return { errore: `--ticket non vale con «${cmd}»: lì serve la parola d'ordine. Non ho fatto niente.` };
  }
  if (POSIZIONALI_DOPO_BIGLIETTO[cmd] === undefined) return { args: lista };
  const davanti = String(lista[0] ?? '').trim();
  if (davanti === b) return { args: [b, ...lista.slice(1)] };
  // Un intento, un ruolo o un valore senza il suo campo chiamati «secondo biglietto» facevano togliere il
  // biglietto giusto, e senza promemoria la risposta dopo era «aggiungi il biglietto»: un giro a vuoto.
  if (!haFormaDiBigliettoVero(davanti)) return { args: [b, ...lista] };
  const senzaIntento = cmd === 'deliver' && lista.length < 2;
  return {
    errore: `Due biglietti diversi (${davanti.slice(0, 12)}… e --ticket ${b.slice(0, 12)}…)${senzaIntento ? ', e manca l\'intento' : ''}: non ho fatto niente. `
      + (senzaIntento ? `Passa un biglietto solo, e dopo l'intento (${INTENTI_CONSEGNA.join(', ')}).` : 'Passane uno solo.'),
  };
}

/** La parola in più dopo quelle che il comando vuole, se c'è: rilascio e consegna hanno i loro testi. PURA. */
export function parolaInPiu(cmd, args) {
  const dopo = POSIZIONALI_DOPO_BIGLIETTO[cmd];
  if (!['work', 'heartbeat', 'compare'].includes(cmd) || !Array.isArray(args) || args.length <= dopo + 1) return '';
  return String(args[dopo + 1]);
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  // I comandi nei testi stampati, i nostri e quelli del server, portano alla copia fissata (#763).
  absolutizeOutput(ROOT);
  const [cmd, ...tutti] = process.argv.slice(2);
  // Il biglietto a mano si toglie per primo, con la stessa regola delle registrazioni (#587).
  const mano = leggiBigliettoAMano(tutti);
  if (mano.errore) { console.error(`${mano.errore} Non ho fatto niente.`); process.exit(1); }
  const rest = mano.args;
  // Un passaggio solo: i `--campo valore` diventano dati dell'intento, il resto
  // sono posizionali. Così l'ordine fra flag e posizionali non conta, e un
  // valore che assomiglia a un comando non viene scambiato per tale.
  // I nomi di campo che questo strumento conosce.
  const CAMPI = new Set([
    'notes', 'frase', 'text', 'title', 'status', 'reason', 'resolvedInVersion',
    'branch', 'sha', 'verdict', 'critique', 'summary', 'findings', 'report',
    'userNote', 'priority', 'guasto', 'loop', 'name', 'json',
    'segnala', 'senza-push', 'senza-rapporto', 'role', 'stop', 'biglietto', 'ticket', 'domanda', 'forza',
    'feedback', 'piano', 'fusione', 'motivo',
  ]);
  // «Sembra un'opzione ma scritta storta?»: un trattino solo, un trattino
  // lungo da copia-incolla, o la forma di Windows con la barra — e il nome che
  // resta è uno dei nostri campi. La conchiglia di Git trasforma `/guasto` in
  // un percorso, quindi si guarda anche l'ultimo pezzo del percorso.
  const SEMBRA_OPZIONE_STORTA = (arg) => {
    const t = String(arg ?? '');
    if (!t || t.startsWith('--')) return false;
    const TRATTINI = ['-', '‐', '‑', '‒', '–', '—', '−'];
    // QUALUNQUE nome, non solo i nostri: `-guast` scritto male veniva preso per
    // una parola libera e buttato via, e il giro si chiudeva senza dichiarare
    // il guasto, rispondendo «OK» (feedback #565). Un numero negativo resta un
    // valore.
    if (TRATTINI.includes(t[0])) return !apreUnElenco(t) && !/^[0-9]/.test(t.replace(/^[-‐‑‒–—−]+/, ''));
    // La conchiglia di Git riscrive `/guasto` come percorso: si guarda l'ultimo
    // pezzo, e solo per i nomi che conosciamo — un percorso vero è un valore.
    if (t.includes('/')) return CAMPI.has(t.split('/').pop().split('=')[0]);
    return false;
  };

  // Quelli che senza il loro testo non hanno senso: un «sì» al loro posto
  // vuol dire consegnare a vuoto.
  const CAMPI_TESTO = new Set([
    'notes', 'frase', 'text', 'title', 'critique', 'summary', 'report',
    'userNote', 'guasto', 'reason', 'branch', 'sha', 'status', 'segnala', 'role', 'domanda',
    'feedback', 'piano', 'fusione', 'motivo',
  ]);
  // E quelli che un valore non lo vogliono MAI: sono interruttori. Senza
  // questo elenco `--json` finiva fra i campi con valore, spariva dai
  // posizionali, e chi lo cercava lì non lo trovava: il ruolo usciva vuoto,
  // chi guida leggeva «server vecchio» e lanciava sempre il worker generico —
  // col biglietto ormai ritirato, che è la cosa che non si annulla (#565).
  const CAMPI_BANDIERA = new Set(['json', 'senza-push', 'senza-rapporto', 'stop', 'forza']);
  const args = [];
  const flags = [];
  const data = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    // Un biglietto vero davanti è un posizionale anche col trattino (o due): nessuna opzione ha la sua forma.
    if (haFormaDiBigliettoVero(a.trim())) { args.push(a.trim()); continue; }
    // Un'opzione scritta storta non è un posizionale: presa per tale, il
    // biglietto veniva rilasciato e il guasto NON dichiarato, con la risposta
    // che diceva «OK» (feedback #565).
    if (!a.startsWith('--')) {
      if (SEMBRA_OPZIONE_STORTA(a)) {
        const nome = String(a).replace(/^[-‐‑‒–—−]+/, '').split('/').pop().split('=')[0];
        console.error(`Argomento non capito: "${a}" — non ho fatto niente. Le opzioni si scrivono con due trattini: --${nome} …`);
        process.exit(1);
      }
      args.push(a);
      continue;
    }
    // Un nome sbagliato non deve passare in silenzio: `--noets "…"` faceva
    // partire la consegna col report VUOTO e il server rispondeva OK — lo
    // stesso danno che il controllo sui posizionali, qui sotto, esiste per
    // impedire (feedback #565).
    if (!CAMPI.has(a.slice(2).split('=')[0])) {
      console.error(`Campo non capito: "${a}" — non ho consegnato niente.`);
      console.error(`Campi ammessi: ${[...CAMPI].map((c) => `--${c}`).join(' ')}`);
      process.exit(1);
    }
    flags.push(a);
    // `--campo=valore` è la forma che regge quando la riga passa da npm, e va
    // capita qui: prima diventava un CAMPO di nome «campo=valore» col valore
    // `true`, e la consegna partiva col report vuoto rispondendo OK (#565).
    const uguale = a.indexOf('=');
    if (uguale > 2) {
      data[a.slice(2, uguale)] = a.slice(uguale + 1);
      continue;
    }
    const key = a.slice(2);
    // Un interruttore non mangia mai la parola dopo di sé: scritto prima della
    // parola d'ordine se la prendeva per valore, e restavano zero posizionali.
    if (CAMPI_BANDIERA.has(key)) { data[key] = true; continue; }
    const next = rest[i + 1];
    // «-- vedi sotto» è testo: un campo che segue è scritto attaccato ai suoi trattini (#878).
    if (next === undefined || (next.startsWith('--') && !apreUnElenco(next))) {
      // Un campo di TESTO senza il suo testo non è un sì: è un report che
      // parte vuoto mentre la risposta dice OK (feedback #565).
      if (CAMPI_TESTO.has(key)) {
        // `--piano` vuole un FILE, non un testo: dirgli «un testo» lo mandava a passarlo sulla riga di comando.
        console.error(key === 'segnala' ? SEGNALA_TOLTA : key === 'piano'
          ? `--${key} vuole il percorso di un file subito dopo di sé (un .md scritto prima): non ho consegnato niente.`
          : `--${key} vuole un testo dopo di sé — non ho consegnato niente.`);
        process.exit(1);
      }
      data[key] = true;
    } else { data[key] = next; i += 1; }
  }

  // I DUE TESTI (spec ROUTINE-AUTH-SPEC.md §8) hanno destinatari diversi: il
  // report va cifrato per l'owner, la frase resta in chiaro per chi ha mandato
  // il feedback. Chi consegna scrive `--frase`, una parola sola in italiano come
  // il resto delle ricette; il server la riceve col suo nome. Un solo nome per
  // la stessa cosa: due (uno qui e uno lì) è come si perde un testo per strada.
  if (typeof data.frase === 'string') { data.userNote = data.frase; }
  delete data.frase;
  // Il biglietto a mano vale in OGNI comando con la stessa regola (#587): accettarlo per poi ignorarlo
  // faceva rilasciare in silenzio un biglietto diverso da quello passato.
  if (cmd === 'domanda' || cmd === 'risposta') {
    if (mano.ticket) data.biglietto = mano.ticket;
  } else {
    const conMano = bigliettoAMano(cmd, args, mano.ticket);
    if (conMano.errore) { console.error(conMano.errore); process.exit(1); }
    args.splice(0, args.length, ...conMano.args);
    // Ignorata, `loop` senza trattini dava un battito solo e un «OK».
    const inPiu = parolaInPiu(cmd, args);
    if (inPiu) {
      const cosa = { compare: 'Dopo il biglietto vanno solo il ruolo e il numero.', heartbeat: 'Dopo il biglietto qui non va altro: il battito continuo si chiede con --loop.' }[cmd] || 'Dopo il biglietto qui non va altro.';
      console.error(`Argomento non capito: "${inPiu.slice(0, 40)}": non ho fatto niente. ${cosa}`);
      process.exit(1);
    }
  }

  // `--segnala <file.md>` non c'è più (#1790): il server non compone domande da un markdown. Si riconosce per dire
  // cosa scrivere al suo posto, invece di consegnare una fermata che il server rifiuterebbe.
  if (data.segnala !== undefined) {
    console.error(SEGNALA_TOLTA);
    process.exit(1);
  }

  // `--domanda <file.json>` accanto a una fermata (#1358): la domanda per l'owner, controllata qui come la controlla il
  // server. L'intento `domanda` la legge più sotto, da sola; su note, secaudit e feedback non fermerebbe niente, e su
  // una critica la domanda viaggia col suo rilievo col «?» (dispatch --record-verifier, #1790).
  if (typeof data.domanda === 'string' && cmd === 'deliver') {
    const intentoDom = [args[0], args[1]].find((a) => ['status', 'fixed', 'domanda'].includes(a));
    if (!intentoDom) {
      console.error('--domanda vale solo su deliver domanda, status e fixed (su una critica la porta il rilievo col «?»: dispatch --record-verifier --domanda): non ho consegnato niente.');
      process.exit(1);
    }
    if (intentoDom !== 'domanda') {
      let testo = '';
      try { testo = readFileSync(resolve(data.domanda), 'utf8'); } catch (e) {
        console.error(`Non leggo ${data.domanda} (${e.code || e.message}): non ho consegnato niente.`);
        process.exit(1);
      }
      const { leggiDomandaJson } = await import('./domanda.mjs');
      const letta = leggiDomandaJson(testo, { conOrigine: false });
      if (letta.errore) { console.error(letta.errore); process.exit(1); }
      data.domanda = letta.domanda;
    }
  }

  // `--feedback`, `--piano`, `--fusione` e `--motivo` hanno un comando solo ciascuno: altrove finirebbero nei dati senza effetto.
  {
    const intentoDi = () => [args[0], args[1]].find((a) => INTENTI_CONSEGNA.includes(a)) || '';
    const fuori = data.feedback !== undefined && cmd !== 'ticket' ? '--feedback vale solo con ticket'
      : data.motivo !== undefined && !(cmd === 'deliver' && intentoDi() === 'fixed') ? '--motivo vale solo con deliver fixed'
      : data.piano !== undefined && !(cmd === 'deliver' && intentoDi() === 'piano') ? '--piano vale solo con deliver piano'
        : data.fusione !== undefined && !(cmd === 'deliver' && intentoDi() === 'status') ? '--fusione vale solo con deliver status --status done --reason gia_risolto'
          : '';
    if (fuori) { console.error(`${fuori}: non ho fatto niente.`); process.exit(1); }
  }

  // `--stop` resta accettato per chi lo scrive ancora, ma non serve: è la
  // segnalazione che ferma il lavoro, e senza l'owner non saprebbe cosa
  // decidere. Stessa regola di dispatch --record-fixed --ferma.
  if (data.stop !== undefined) {
    const suFixed = cmd === 'deliver' && [args[0], args[1]].includes('fixed');
    if (data.stop !== true || !suFixed || !(data.domanda && typeof data.domanda === 'object')) {
      console.error('--stop vale solo su deliver fixed, senza valore, e insieme a --domanda <file.json> (che da sola ferma già il lavoro): non ho consegnato niente.');
      process.exit(1);
    }
  }

  const usage = () => {
    // Il percorso VERO di questo strumento, non la forma corta: se sta girando
    // la copia fissata, `scripts/…` porterebbe a quello del ramo di lavoro —
    // cioè proprio la cosa che il contratto dei worker vieta di scrivere a mano.
    const io = resolve(fileURLToPath(import.meta.url)).split('\\').join('/');
    console.error(`Uso: node "${io}" <probe|ticket|work|immagine|heartbeat|veglia|release|deliver|operazione|segnala|rapporto|sporca|git-server|ramo-server|compare|domanda|risposta> <segreto> [...]`);
    process.exit(1);
  };

  // `heartbeat` può girare senza posizionali (il biglietto viaggia nell'ambiente);
  // `domanda` e `risposta` del worker hanno il biglietto in `--biglietto`.
  if (!cmd || (!args[0] && !['heartbeat', 'domanda', 'risposta', 'segnala', 'rapporto'].includes(cmd))) usage();

  if (cmd === 'domanda' || cmd === 'risposta') {
    const a = argomentiChiusura(cmd, args, data);
    if (a.errore) { console.error(`${a.errore} — non ho mandato niente.`); process.exit(1); }
    if (cmd === 'domanda') {
      const r = await domandaChiusura(a.cred);
      if (r.esito === 'assente') { console.error(`nessuna domanda (${r.reason}): niente da rispondere, chiudi o rilascia come sempre.`); process.exit(EXIT_CHIUSURA.assente); }
      if (r.esito === 'rifiutato') { console.error(testoRifiutoChiusura(r)); process.exit(EXIT_CHIUSURA.rifiutato); }
      const io = resolve(fileURLToPath(import.meta.url)).split('\\').join('/');
      console.log(`${r.question.trim()}\n\nPer rispondere:\n${comandoRisposta(io, a.cred, r.id)}`);
      process.exit(0);
    }
    // Il testo arriva da stdin (heredoc): sulla riga di comando gli apostrofi
    // italiani romperebbero la shell. Da un terminale senza tubo si aspetterebbe per sempre.
    let testo = '';
    if (!process.stdin.isTTY) {
      const pezzi = [];
      for await (const p of process.stdin) pezzi.push(p);
      testo = Buffer.concat(pezzi).toString('utf8').trim();
    }
    if (!testo) {
      console.error('Nessuna risposta su stdin — non ho mandato niente. Il testo va fra due righe FINE:');
      console.error(`  … risposta ${a.cred.ticket ? '--biglietto <biglietto>' : '"<parola-d-ordine>" <id>'} <<'FINE'\n  niente\n  FINE`);
      process.exit(1);
    }
    const r = await rispostaChiusura(a.cred, testo);
    if (r.esito === 'ok') { console.log('OK: risposta registrata.'); process.exit(0); }
    if (r.esito === 'assente') { console.error(`risposta non arrivata (${r.reason}): chiudi comunque, senza insistere.`); process.exit(EXIT_CHIUSURA.assente); }
    console.error(testoRifiutoChiusura(r)); process.exit(EXIT_CHIUSURA.rifiutato);
  } else if (cmd === 'probe') {
    const r = await probe(args[0]);
    if (r.outcome === 'work') { console.log('c’è lavoro'); process.exit(0); }
    if (r.outcome === 'nothing') { console.error(`niente da fare (${r.reason})`); process.exit(2); }
    console.error(`guasto ${r.reason}`); process.exit(3);
  } else if (cmd === 'ticket') {
    let feedback = '';
    if (data.feedback !== undefined) {
      const { numeroFeedback } = await import('./lib/su-main.mjs');
      feedback = numeroFeedback(data.feedback);
      if (!feedback) { console.error(`--feedback vuole un numero di feedback (1680, #1680 o 1680.2), non "${String(data.feedback).slice(0, 30)}": non ho chiesto niente.`); process.exit(1); }
    }
    const r = await ticket(args[0], feedback ? { feedback } : undefined);
    // Un server che non conosce la richiesta per numero dà il primo della coda: quel biglietto si restituisce subito,
    // o la sessione accesa per un feedback lavorerebbe su un altro.
    if (r.outcome === 'work' && feedback && String(r.feedback || '').replace(/^#/, '') !== feedback) {
      const reso = await release(r.ticket, '');
      console.error(`guasto: chiesto il biglietto di #${feedback}, il server ne ha dato ${r.feedback ? `uno di #${r.feedback}` : 'uno senza dire di quale feedback'} (server che non conosce ancora la richiesta per numero?). ${reso.ok ? 'Biglietto restituito' : `Biglietto NON restituito (${reso.reason}): scade da solo`}, non ho lavorato niente.`);
      process.exit(3);
    }
    if (r.outcome === 'work') {
      // Senza la decisione registrata il gancio rifiuta il lancio: meglio fermarsi qui che con un worker rifiutato.
      const reg = registraDecisione(r);
      if (!reg.ok) {
        const io = resolve(fileURLToPath(import.meta.url)).split('\\').join('/');
        console.error(`guasto: decisione del server non registrata per il gancio in ${reg.file} (${reg.why}), il lancio del worker verrebbe rifiutato. Rilascia il biglietto: node "${io}" release ${r.ticket} --role orchestrator`);
        process.exit(3);
      }
      // `--json`: biglietto E ruolo, per chi deve scegliere il worker prima di
      // lanciarlo. Senza flag resta la sola stringa, come sempre.
      const decisi = { ...(r.model ? { model: r.model } : {}), ...(r.effort ? { effort: r.effort } : {}) };
      console.log(data.json === true ? JSON.stringify({ ticket: r.ticket, role: r.role || '', ...decisi }) : r.ticket);
      process.exit(0);
    }
    if (r.outcome === 'nothing') { console.error(`niente da fare (${r.reason})`); process.exit(2); }
    console.error(`guasto ${r.reason}`); process.exit(3);
  } else if (cmd === 'work') {
    const r = await work(args[0]);
    if (!r.ok) { console.error(`guasto ${r.reason}`); process.exit(3); }
    console.log(JSON.stringify(r.payload, null, 2));
  } else if (cmd === 'immagine') {
    const a = argomentiImmagine(args, mano.ticket);
    if (a.errore) { console.error(`${a.errore} Il server non è stato chiamato.`); process.exit(1); }
    let biglietto = a.ticket;
    if (!biglietto) {
      const { readTicket } = await import('./lib/routine-ticket.mjs');
      biglietto = readTicket(ROOT);
    }
    if (!biglietto) {
      console.error('NESSUN BIGLIETTO: il server non è stato chiamato. Passalo con --ticket <codice>.');
      process.exit(1);
    }
    const r = await immagine(biglietto, a.id);
    if (r.outcome === 'refused') {
      console.error(r.reason === 'no_image'
        ? `Nessuna immagine «${a.id}» per il tuo lavoro: usa un id che c'è in «immagini».`
        : `RIFIUTATO dal server (${r.reason}).`);
      process.exit(4);
    }
    if (r.outcome !== 'ok') { console.error(`guasto ${r.reason}`); process.exit(3); }
    let voce;
    try { voce = scriviImmagine(r.voce, { root: ROOT }); } catch (e) {
      console.error(`immagine ricevuta ma non scritta su disco (${e.message})`); process.exit(3);
    }
    console.log(JSON.stringify(voce, null, 2));
    if (voce && voce.errore) console.error(`immagine ${a.id} non aperta: ${voce.errore}`);
  } else if (cmd === 'heartbeat') {
    // Il ciclo lo avvia dispatch, che passa il biglietto nell'ambiente: la riga
    // di comando di un processo la legge chiunque sulla macchina.
    let biglietto = args[0];
    if (!biglietto) {
      const { readTicket } = await import('./lib/routine-ticket.mjs');
      biglietto = readTicket(ROOT);
    }
    if (!biglietto) {
      // Uscita 1, non 3: per il contratto 3 è «canale giù», e qui il server non è stato chiamato.
      console.error('NESSUN BIGLIETTO: non c’è nessun semaforo da tenere vivo, e il server non è stato chiamato. Passalo con --ticket <codice>.');
      process.exit(1);
    }
    if (!flags.includes('--loop')) {
      const r = await heartbeat(biglietto);
      if (!r.ok && r.final) segnaBigliettoFinito(ROOT, biglietto, r.reason);
      if (!r.ok) { console.error(`guasto ${r.reason}`); process.exit(3); }
      console.log(`OK: semaforo vivo fino a ${r.expiresAt}`);
      for (const a of r.avvisi) console.error(`misura scartata dal server (${a.campo}: ${a.reason}): ${a.detail || ''}`);
    } else {
      // Sessioni lunghe: si batte finché il biglietto vale. Quando il server
      // dice che è morto (rilasciato o semaforo caduto) il ciclo finisce da solo
      // — nessun processo che resta appeso a battere il cuore di un morto.
      //
      // Su un intoppo passeggero si RIBATTE più fitto invece di arrendersi: il
      // battito è l'unica cosa che tiene in piedi un lavoro lungo, e mollarlo
      // per un buco di rete di due minuti butterebbe via un'ora di lavoro come
      // è già successo. Si insiste finché il semaforo può ancora essere vivo:
      // oltre quella soglia il biglietto è morto comunque e insistere è rumore.
      let primoGuastoMs = 0;
      for (;;) {
        const r = await heartbeat(biglietto);
        if (r.ok) {
          for (const a of r.avvisi) console.error(`misura scartata dal server (${a.campo}: ${a.reason}): ${a.detail || ''}`);
          primoGuastoMs = 0; await defaultSleep(attesaBattito(r.expiresAt)); continue;
        }
        if (r.final) { segnaBigliettoFinito(ROOT, biglietto, r.reason); console.error(`battito finito: ${r.reason}`); process.exit(0); }
        const ora = Date.now();
        if (!primoGuastoMs) primoGuastoMs = ora;
        if (ora - primoGuastoMs >= LEASE_TTL_MS) {
          console.error(`battito finito: canale irraggiungibile da ${Math.round((ora - primoGuastoMs) / 60000)} minuti`);
          process.exit(0);
        }
        console.error(`battito: intoppo (${r.reason}), riprovo`);
        await defaultSleep(RETRY_EVERY_MS);
      }
    }
  } else if (cmd === 'veglia') {
    if (args.length !== 1 || !looksLikeTicket(args[0]) || Object.keys(data).length) {
      console.error('Uso: veglia <biglietto> — solo il biglietto del worker che vegli. Non ho fatto niente.');
      process.exit(1);
    }
    const nelClone = cloneDelBiglietto(ROOT, args[0]);
    if (nelClone) process.exit(rilancia(nelClone.strumenti, 'routine-channel.mjs', process.argv.slice(2)));
    const { veglia, segniDiVita, FETTA_MS } = await import('./lib/veglia-worker.mjs');
    const { stopBeat } = await import('./lib/routine-beat.mjs');
    const ticket = args[0];
    const fetta = Number(process.env.FILO_VEGLIA_FETTA_MS);
    const esito = await veglia({
      fetta: Number.isFinite(fetta) && fetta >= 0 ? Math.min(fetta, FETTA_MS) : FETTA_MS,
      leggi: () => segniDiVita({ root: ROOT, ticket }),
      // Il rilascio è quello di sempre, dalla cartella che tiene il biglietto; della sua stampa passa solo l'esito.
      rilascia: (guasto, mio) => {
        const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'release', ticket, '--role', 'orchestrator', '--forza',
          '--guasto', guasto, ...(mio ? [] : ['--senza-push'])], { encoding: 'utf8', env: process.env });
        const ok = r.status === 0 && /OK: biglietto rilasciato/.test(String(r.stdout || ''));
        if (!ok) stopBeat(ROOT, { ticket });
        const motivo = ok ? '' : (String(r.stdout || '').match(/rilascio non riuscito \(([^)]{1,80})\)/) || [])[1] || `uscita ${r.status}`;
        return { ok, motivo };
      },
    });
    console.log(esito.testo);
    process.exit(esito.uscita);
  } else if (cmd === 'release') {
    // `--guasto "motivo"`: il guasto si dichiara AL CANALE nel rilascio, non a
    // parole nel testo di ritorno (che nessuna macchina legge).
    // Una parola in più qui non è un posizionale: è un `--guasto` scritto
    // senza trattini, e il giro si chiuderebbe senza dichiarare niente,
    // rispondendo «OK» (feedback #565).
    if (args.length > 1) {
      console.error(`Argomento non capito: "${String(args[1]).slice(0, 40)}" — non ho rilasciato niente. Il motivo di un guasto si scrive così: --guasto "…"`);
      process.exit(1);
    }
    const guasto = typeof data.guasto === 'string' ? data.guasto : '';
    // Il rilascio di un worker morto chiesto dall'orchestratore: ramo, promemoria e battito stanno nel clone (#1182).
    const nelClone = cloneDelBiglietto(ROOT, args[0]);
    if (nelClone) process.exit(rilancia(nelClone.strumenti, 'routine-channel.mjs', process.argv.slice(2)));
    // Chi lavora ancora qui non perde biglietto né cartella (#1480): l'orchestratore rilascia solo senza lavoro vivo
    // (`--forza` per il worker morto davvero), un worker solo quando i suoi processi sono finiti.
    const marcatore = leggiMarcatoreBiglietto(ROOT);
    const cartellaSua = !marcatore || !marcatore.ticket || String(marcatore.ticket) === String(args[0]);
    const chiRilascia = typeof data.role === 'string' ? data.role : '';
    if (chiRilascia === 'orchestrator' ? data.forza !== true : cartellaSua && !!marcatore) {
      const vivo = lavoroVivo(ROOT, chiRilascia === 'orchestrator' ? {} : { cosa: ['processi'] });
      if (vivo.vivo) {
        console.error(`LAVORO VIVO: ${testoLavoroVivo(vivo, 'rilasciato il biglietto')}`);
        console.error(chiRilascia === 'orchestrator'
          ? 'Chiudi il giro senza rilasciare: chi lavora qui consegna e rilascia da sé, e un biglietto abbandonato scade da solo. --forza solo per un worker morto davvero (il gancio ti ha detto «Worker finito», o il canale dice che il suo battito è scaduto).'
          : 'Aspetta che finiscano (un comando in sottofondo si aspetta, non si abbandona), o fermali se non servono più, poi rilancia lo stesso comando.');
        process.exit(USCITA_LAVORO_VIVO);
      }
    }
    // Un biglietto già finito non spedisce più (lo prenderebbe chi ha il ramo adesso); la cartella di un altro biglietto
    // non si committa, non si spedisce e non si sigilla.
    const finito = cartellaSua && bigliettoFinito(marcatore);
    if (!cartellaSua || finito) {
      console.error(!cartellaSua
        ? `la cartella è del biglietto ${String(marcatore.ticket).slice(0, 8)}…, non di questo: non committo, non spedisco e non sigillo niente.`
        : 'questo biglietto è già finito (rilasciato, o morto per il battito): non committo e non spedisco niente.');
    }
    // PRIMA del server: il ramo corrente va su origin. Un commit fatto a mano
    // dal worker non passa dall'hook, e senza questo push moriva col
    // contenitore. Se il push non riesce NON si rilascia: si stampa la causa e
    // si esce diverso da zero, il worker sistema e rilancia (il biglietto scade
    // da solo dopo 60 minuti se muore). `--senza-push` dove non c'è un repo.
    if (data['senza-push'] !== true && cartellaSua && !finito) {
      // Prima quello che è rimasto fuori dai commit (un file nato da una
      // shell non passa dall'hook): si committa qui, e si dice.
      const c = commitRestante(ROOT);
      if (!c.ok) {
        console.error(`Modifiche fuori dai commit che non riesco a committare: ${c.reason}`);
        console.error('Non ho rilasciato niente: porta la directory a un commit e rilancia lo stesso comando.');
        process.exit(1);
      }
      if (c.committed.length) {
        console.error(`committate ${c.committed.length} modifiche rimaste fuori dai commit: ${c.committed.slice(0, 3).join(', ')}${c.committed.length > 3 ? ` (+${c.committed.length - 3} file)` : ''}`);
      }
      if (c.fuori && c.fuori.length) {
        console.error(`NON committo e NON spedisco ${c.fuori.join(', ')}: ha la forma di una copia dei dati del server e il repo è pubblico. Resta nella cartella, invisibile a git: spostalo nella cartella temporanea del sistema (os.tmpdir()).`);
      }
      const p = pushRamoCorrente(ROOT);
      if (!p.ok) {
        console.error(`Il ramo${p.branch ? ` '${p.branch}'` : ''} NON è arrivato su origin: ${p.reason}`);
        // In una routine un push a mano resta fermo sul controllo dei permessi, che in cloud nessuno approva (#1797).
        const inRoutine = isRoutineInstance(ROOT) || !!marcatore;
        console.error(inRoutine
          ? 'Non ho rilasciato niente. Non spingere a mano: in cloud il controllo dei permessi ferma il push e la sessione resta appesa. Se la causa sta nel ramo (una copia dei dati nella storia, detta qui sopra) toglila e rilancia lo stesso comando, che rispedisce da sé; altrimenti è un guasto: rilascia con --guasto "guasto: github: <il messaggio qui sopra>" --senza-push.'
          : 'Non ho rilasciato niente: il ramo deve arrivare su origin prima del rilascio. Rimetti a posto la spedizione e rilancia lo stesso comando (--senza-push solo se qui non c\'è un repo).');
        process.exit(1);
      }
      if (p.avviso) console.error(p.avviso);
      console.error(p.skipped ? `push saltato: ${p.reason}` : `ramo '${p.branch}' spedito su origin${p.forced ? ' (storia riscritta: --force-with-lease)' : ''}`);
    }
    // Il rapporto di fine sessione lo fa uno script, non l'agente, e parte da
    // solo qui. Se lo script fallisce si rilascia comunque, con la nota.
    let rapporto = null;
    if (data['senza-rapporto'] !== true) {
      const ruolo = typeof data.role === 'string' ? data.role : '';
      try {
        const { generaRapporto } = await import('./session-report.mjs');
        // Dal momento del biglietto: chi rilascia è quasi sempre un
        // sotto-agente col suo transcript; quando è l'orchestratore a
        // rilasciare per un worker morto, la finestra lascia fuori i worker
        // dei biglietti prima.
        const { readTicketSince } = await import('./lib/routine-ticket.mjs');
        rapporto = await generaRapporto({ role: ruolo, ticket: args[0], cwd: ROOT, since: readTicketSince(ROOT, { ticket: args[0] }) });
      } catch (e) {
        // Stessa versione di rapportoVuoto: la sentinella in routineChannelRilascio le confronta.
        rapporto = { v: 3, role: ruolo, ticket: args[0], notes: [`rapporto non generato: ${String((e && e.message) || e)}`] };
      }
    }
    const r = await releaseConRapporto(args[0], guasto, rapporto);
    if (r.avviso) console.error(r.avviso);
    // Col biglietto muore anche il battito. Ci arriverebbe da solo al giro dopo
    // (il server risponde `dead_ticket` e il ciclo esce), ma spegnerlo adesso
    // evita dieci minuti di processo che batte per un morto.
    //
    // SOLO se il rilascio è andato a buon fine, e SOLO il battito di QUESTO
    // biglietto: un rilascio rifiutato non ha liberato niente, e spegnere "il
    // battito che c'è" ammazzava il lavoro di un altro giro ancora vivo.
    if (r.ok) {
      const { stopBeat } = await import('./lib/routine-beat.mjs');
      stopBeat(ROOT, { ticket: args[0] });
      segnaBigliettoFinito(ROOT, args[0], 'rilasciato');
      // Fine giro LEGITTIMA: il punto fermo si sigilla sul contenuto attuale
      // (#507). Senza, i commit fatti dopo l'ultima consegna — la pulizia del
      // verificatore, per esempio — al posizionamento successivo nello stesso
      // clone verrebbero scartati come moncone di un'istanza morta.
      if (cartellaSua) try {
        const { sealCurrentWork } = await import('./lib/branch-integrity.mjs');
        const { readRole } = await import('./lib/routine-role.mjs');
        // Il ruolo nel sigillo: dopo un «pass» vale come pulizia solo quello del verificatore (#880).
        const chi = readRole(ROOT);
        sealCurrentWork(ROOT, { by: chi ? `release:${chi}` : 'release' });
      } catch (_) { /* best-effort: il rilascio è già andato */ }
    }
    // Un biglietto che il server dice morto non ha più niente da tenere vivo: il battito si spegne e la fine si segna,
    // o il suo battito ancora acceso varrebbe come lavoro vivo per chi viene dopo (#1480).
    if (!r.ok && BATTITO_FINITO.has(r.reason)) {
      const { stopBeat } = await import('./lib/routine-beat.mjs');
      stopBeat(ROOT, { ticket: args[0] });
      segnaBigliettoFinito(ROOT, args[0], r.reason);
    }
    if (r.ok) console.log(guasto ? 'OK: biglietto rilasciato, guasto dichiarato.' : 'OK: biglietto rilasciato.');
    else console.log(`rilascio non riuscito (${r.reason})`);
  } else if (cmd === 'deliver') {
    // deliver [<biglietto>] <intento> [--campo valore …]
    //
    // Il biglietto si può omettere: lo ritrova da solo (lo ha messo il
    // dispatcher dove chi consegna lo trova). Chiedere a chi lavora di
    // ricopiarlo a ogni consegna è la scommessa già persa sulla provenienza dei
    // feedback — su decine di ritrovamenti, uno solo risultava firmato giusto.
    // `--ticket` a mano è già davanti, al posto del biglietto (bigliettoAMano, più su).
    const INTENTI = INTENTI_CONSEGNA;
    let biglietto = args[0];
    let intento = args[1] || '';
    if (INTENTI.includes(args[0])) {
      intento = args[0];
      const { readTicket } = await import('./lib/routine-ticket.mjs');
      biglietto = readTicket(ROOT);
      if (!biglietto) {
        // Uscita 1, non 3: per il contratto 3 è «canale giù, fermati», e qui il
        // server non è stato nemmeno chiamato.
        console.error('NESSUN BIGLIETTO: questa consegna non ha un lavoro a cui riferirsi, e il server non è stato chiamato. Ripeti lo stesso comando aggiungendo --ticket <codice> (il codice è nelle istruzioni con cui sei partito).');
        process.exit(1);
      }
    }
    // Un posizionale avanzato NON viene ignorato in silenzio. È la trappola in
    // cui questa riscrittura è già caduta: le ricette passavano il report come
    // ultimo argomento, il canale lo scartava, e la consegna usciva OK con le
    // note vuote — il feedback si chiudeva senza che l'owner leggesse niente.
    const avanzati = args.slice(INTENTI.includes(args[0]) ? 1 : 2);
    if (avanzati.length) {
      console.error(`Argomento non capito: "${avanzati[0].slice(0, 40)}". I dati si passano come --campo valore.`);
      console.error('Il report va in --notes "…", la frase per chi ha mandato il feedback in --frase "…", il testo di un feedback nuovo in --text "…".');
      process.exit(1);
    }
    // Senza intento una parola storta partiva verso il server COME biglietto, e dopo un biglietto COME
    // intento: la regola è una, l'intento storto si ferma qui con l'elenco.
    if (!intento) {
      console.error(testoIntentoNonCapito(haFormaDiBigliettoVero(biglietto) ? '' : biglietto));
      process.exit(1);
    }
    if (!INTENTI.includes(intento)) {
      console.error(testoIntentoNonCapito(intento));
      process.exit(1);
    }
    // La versione in cui il fix confluisce la sa solo questa macchina (è quella
    // in costruzione, nel manifesto del progetto). Va timbrata da sola: è ciò
    // che regge il "questo è arrivato agli utenti" nella bacheca e
    // l'archiviazione automatica, e chiedere a chi lavora di ricordarsene
    // significa perderla.
    if (intento === 'status' && data.status === 'done' && !data.resolvedInVersion) {
      try {
        const { readFileSync } = await import('node:fs');
        const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
        if (pkg.version) data.resolvedInVersion = pkg.version;
      } catch (_) { /* senza versione si chiude lo stesso: non è un motivo per fermarsi */ }
    }
    // Le consegne che passano il ramo a una verifica valgono per un commit:
    // la messa in revisione (il primo passaggio di chi risolve), la correzione
    // e il verdetto. Con modifiche non salvate la verifica dopo proverebbe il
    // ramo senza di esse e boccerebbe una cosa fatta: un giro sprecato. Lo
    // strumento delle routine (dispatch --record-*) respingeva già; da qui,
    // che è la strada della ricetta per il primo passaggio, no (verifica del
    // giro 3 su questo lavoro). Stessa regola, stessa fonte (lib/dirty-tree).
    // I due esiti RAGIONATI (la verifica funzionale e il controllo di
    // sicurezza) valgono per il commit esaminato, non per il nome del ramo:
    // lo sha si timbra qui, da solo, come la versione di `done`. Chiederlo a
    // chi consegna è la scommessa già persa sul biglietto e sulla firma dei
    // feedback — e un esito senza commit torna a essere una firma su una
    // cartella, buona anche dopo che il foglio è stato sostituito (#485).
    // E uno dichiarato può solo CONFERMARE la punta vera, mai sostituirla
    // (più sotto): è la stessa regola che questo canale applica già al nome
    // del ramo, dove nominarne un altro è un rifiuto messo a registro e non
    // una correzione silenziosa.
    //
    // Le consegne che valgono per UN COMMIT: la messa in revisione, la
    // correzione, la critica e il verdetto del controllo di sicurezza. Con
    // modifiche non salvate la punta si sposta dopo la registrazione e l'esito
    // finisce a parlare di un contenuto diverso da quello esaminato.
    const passaAllaVerifica = intento === 'verdict' || intento === 'fixed' || intento === 'secaudit'
      || (intento === 'status' && data.status === 'revision_capability');
    let guardia = null;
    if (passaAllaVerifica) {
      const cosa = intento === 'verdict' ? 'critica'
        : intento === 'fixed' ? 'consegna'
          : intento === 'secaudit' ? 'verdetto' : 'revisione';
      const quale = intento === 'verdict' ? 'critica non registrata' : intento === 'secaudit' ? 'verdetto non registrato' : 'consegna non registrata';
      // Parte solo dal ramo assegnato, e al server va il ramo VERO della cartella (#772; regola in guardiaConsegna).
      let sospensione = null;
      guardia = guardiaConsegna(ROOT, {
        dichiarato: data.branch,
        escalate: () => { sospensione = deliver(biglietto, 'status', { status: 'design', reason: 'loop', notes: escalationNote() }); },
      });
      let sospesa = null;
      if (sospensione) {
        try {
          const s = await sospensione;
          sospesa = { ok: s.outcome === 'ok', motivo: s.reason };
        } catch (e) { sospesa = { ok: false, motivo: String((e && e.message) || e) }; }
      }
      if (!guardia.ok) {
        console.error(testoConsegnaFuoriRamo(quale, guardia, sospesa));
        process.exit(1);
      }
      data.branch = guardia.branch;
      const stato = statoDirectory(ROOT);
      if (!stato.ok) {
        console.error(statoIllegibileText(stato.motivo, cosa));
        console.error('Niente è stato consegnato: senza lo stato della directory non so su quale commit varrebbe.');
        process.exit(1);
      }
      if (stato.lines.length) {
        console.error(dirtyTreeText(stato.lines, cosa));
        console.error('Niente è stato consegnato: porta la directory a un commit e rilancia lo stesso comando.');
        process.exit(1);
      }
      // Directory pulita: adesso l'impronta. Uno sha dichiarato può solo
      // CONFERMARE la punta vera. Senza questo la difesa si spegneva
      // scrivendo un argomento in più: bastava dichiarare l'impronta di un
      // commit che qui non c'è perché l'esito nascesse intestato a un
      // contenuto mai esaminato (verifica del giro 1 su questo lavoro).
      // Anche correzione e revisione (#1148): il registro del ramo confronta questa punta con quella che troverà chi
      // viene dopo, e una consegna senza impronta il server la segna come buco.
      const punta = headSha(ROOT);
      if (!punta) {
        console.error(`${quale}: non riesco a farmi dire su quale commit è la directory, e un esito vale per il contenuto esaminato, non per il nome del ramo.`);
        console.error('Niente è stato consegnato: sistema git (sei nel deposito? c\'è un\'operazione a metà?) e rilancia lo stesso comando.');
        process.exit(1);
      }
      // Confermare vuol dire riconoscere la stessa versione, non ricopiarla
      // lettera per lettera: la forma corta che gli strumenti stampano
      // dappertutto, e le maiuscole, sono lo stesso commit.
      const conferma = confermaImpronta(data.sha, punta);
      if (!conferma.ok) {
        console.error(testoImprontaDiversa(quale, data.sha, punta, conferma.motivo));
        process.exit(1);
      }
      data.sha = punta;
      if (intento === 'fixed') {
        const { readMarker } = await import('./lib/routine-role.mjs');
        if (consegnaDiRiallineamento(readMarker(ROOT), { ferma: data.stop, domanda: data.domanda })) {
          const sped = spedisciRiallineamento(ROOT);
          if (!sped.ok) { console.error(testoRiallineamentoNonSpedito(sped)); process.exit(1); }
          if (sped.avviso) console.error(sped.avviso);
          data.sha = sped.punta;
        }
      }
    }
    // Il piano di un lavoro grosso (SPEC-RIDISEGNO-LAVORO.md § 2): da file, intero, e da solo.
    if (intento === 'piano') {
      const altri = Object.keys(data).filter((k) => k !== 'piano');
      if (typeof data.piano !== 'string' || altri.length) {
        console.error(`deliver piano vuole solo --piano <file.md>${altri.length ? ` (non ${altri.map((k) => `--${k}`).join(', ')})` : ''}: non ho consegnato niente.`);
        process.exit(1);
      }
      const p = leggiPiano(data.piano);
      if (!p.ok) { console.error(p.errore); process.exit(1); }
      data.piano = p.testo;
    }
    // Già risolto su main: chiude senza ramo, con la fusione che lo prova, il report e la frase.
    if (intento === 'status' && (data.reason === 'gia_risolto' || data.fusione !== undefined)) {
      const manca = data.status !== 'done' || data.reason !== 'gia_risolto' ? 'va con --status done --reason gia_risolto'
        : typeof data.fusione !== 'string' ? 'vuole --fusione <sha della fusione su main>'
          : !String(data.notes || '').trim() ? 'vuole --notes "<cosa hai controllato>"'
            : !String(data.userNote || '').trim() ? 'vuole --frase "<cosa trova adesso chi ha segnalato>"' : '';
      if (manca) { console.error(`La chiusura «già risolto su main» ${manca}: non ho consegnato niente.`); process.exit(1); }
      const f = controllaFusione(ROOT, data.fusione);
      if (!f.ok) { console.error(`${f.errore} Non ho consegnato niente.`); process.exit(1); }
      data.fusione = f.sha;
    }
    // Una domanda all'owner (#1149) è un oggetto: arriva da file, controllata come la controlla il server.
    if (intento === 'domanda') {
      const altri = Object.keys(data).filter((k) => k !== 'domanda');
      if (typeof data.domanda !== 'string' || altri.length) {
        console.error(`deliver domanda vuole solo --domanda <file.json>${altri.length ? ` (non ${altri.map((k) => `--${k}`).join(', ')})` : ''}: non ho consegnato niente. In alternativa: node scripts/domanda.mjs chiedi <file.json>.`);
        process.exit(1);
      }
      let testo = '';
      try { testo = readFileSync(resolve(data.domanda), 'utf8'); } catch (e) {
        console.error(`Non leggo ${data.domanda} (${e.code || e.message}): non ho consegnato niente.`);
        process.exit(1);
      }
      const { leggiDomandaJson } = await import('./domanda.mjs');
      const letta = leggiDomandaJson(testo, { conOrigine: false });
      if (letta.errore) { console.error(letta.errore); process.exit(1); }
      data.domanda = letta.domanda;
    }
    const fermata = fermataSenzaDomanda(intento, data);
    if (fermata) { console.error(fermata); process.exit(1); }
    const r = await deliver(biglietto, intento, data);
    // L'esito è REGISTRATO: adesso resta scritto anche QUI su quale contenuto è
    // stato dato. Non è un doppione dello sha appena spedito: è la memoria su
    // cui si regge il rifiuto dell'ultimo passo, che prima la scriveva solo
    // l'altra strada — e bastava registrare l'ok da qui perché la fusione
    // ripartisse a foglio sostituito (feedback #485, giro 3). Una correzione la
    // cancella, perché è contenuto nuovo.
    if (r.outcome === 'ok' && ['verdict', 'secaudit', 'fixed'].includes(intento)) {
      try {
        const { ricordaEsitoSuCommit } = await import('./lib/branch-integrity.mjs');
        const esito = ricordaEsitoSuCommit(ROOT, intento, String(data.sha || ''));
        // Astenersi si dice: se qui non resta niente, chi chiude deve saperlo
        // prima di credere che il controllo del contenuto sia stato fatto.
        if (!esito.scritto && intento !== 'fixed') {
          console.error(`nota: su questa macchina non resta scritto su quale commit vale questo esito (${esito.why}), quindi l'ultimo passo non potrà controllarlo da qui. Decide il server.`);
        }
      } catch (_) { /* best-effort: l'esito è già registrato */ }
    }
    if (r.outcome === 'ok' && (intento === 'status' || intento === 'fixed')) {
      // La consegna è REGISTRATA dal server: da questo istante il contenuto
      // della directory è la consegna, e il punto fermo va sigillato qui
      // (#507). Era la simmetria mancante: le consegne via dispatch
      // (--record-*) sigillavano, questa strada no — e il posizionamento
      // successivo nello stesso clone riportava il ramo alla base,
      // parcheggiando su discarded/ un lavoro intero già consegnato.
      try {
        const { sealCurrentWork } = await import('./lib/branch-integrity.mjs');
        sealCurrentWork(ROOT, { by: `deliver:${intento}` });
      } catch (_) { /* best-effort: la consegna è già registrata */ }
    }
    if (r.outcome === 'ok' && guardia && guardia.id) azzeraRifiuti(ROOT, guardia.id);
    if (r.outcome === 'ok') {
      console.log(testoConsegnaRiuscita(r, data, intento));
      process.exit(0);
    }
    if (r.outcome === 'refused') { console.error(`RIFIUTATO dal server: ${r.reason}${r.detail ? `: ${r.detail}` : ''}`); process.exit(4); }
    console.error(`guasto ${r.reason}`); process.exit(3);
  } else if (cmd === 'operazione' || cmd === 'segnala' || cmd === 'rapporto') {
    // Il testo da stdin (heredoc): sulla riga gli apostrofi italiani romperebbero la shell. Da un terminale senza tubo
    // non si aspetta.
    const leggiStdin = async () => {
      if (process.stdin.isTTY) return '';
      const pezzi = [];
      for await (const p of process.stdin) pezzi.push(p);
      return Buffer.concat(pezzi).toString('utf8');
    };
    const nome = cmd === 'operazione' ? String(args[0] || '').trim() : cmd;
    const sullaRiga = (cmd === 'operazione' ? args.slice(1) : args).join(' ').trim();
    const grezzo = sullaRiga || (await leggiStdin()).trim();
    let dati;
    if (cmd === 'operazione') {
      const d = datiOperazione(grezzo);
      if (d.errore) { console.error(`${nome}: ${d.errore}. Il server non è stato chiamato.`); process.exit(1); }
      dati = d.dati;
    } else {
      if (!grezzo) {
        console.error(`${cmd} vuole il testo, fra due righe FINE: … ${cmd} <<'FINE'\n  <testo>\n  FINE\nIl server non è stato chiamato.`);
        process.exit(1);
      }
      dati = { testo: grezzo };
    }
    const { readTicket } = await import('./lib/routine-ticket.mjs');
    const biglietto = mano.ticket || readTicket(ROOT);
    if (!biglietto) { console.error('NESSUN BIGLIETTO: il server non è stato chiamato. Passalo con --ticket <codice>.'); process.exit(1); }
    const r = await operazione(biglietto, nome, dati);
    if (r.outcome === 'ok') {
      if (cmd === 'segnala') console.log(`OK: segnalazione ${r.body.num || r.body.id} aperta (${r.body.fiducia === 'fidato' ? 'fidata' : 'non fidata'}).`);
      else if (cmd === 'rapporto') console.log(`OK: rapporto consegnato${r.body.chiuso ? `, ${r.body.compito} chiuso` : ''}.`);
      else console.log(JSON.stringify(r.body, null, 2));
      process.exit(0);
    }
    if (r.outcome === 'refused') { console.error(`RIFIUTATO dal server: ${r.reason}${r.detail ? `: ${r.detail}` : ''}`); process.exit(4); }
    console.error(`guasto ${r.reason}`); process.exit(3);
  } else if (cmd === 'sporca') {
    // Il biglietto è quello del giro (il marcatore lo scrive dispatch): sulla riga c'è solo il motivo.
    const motivo = args.join(' ').trim();
    if (!motivo) { console.error('sporca vuole il motivo: cosa hai letto che il server non vede. Il server non è stato chiamato.'); process.exit(1); }
    const { readTicket } = await import('./lib/routine-ticket.mjs');
    const biglietto = mano.ticket || readTicket(ROOT);
    if (!biglietto) { console.error('NESSUN BIGLIETTO: il server non è stato chiamato. Passalo con --ticket <codice>.'); process.exit(1); }
    const r = await sporca(biglietto, motivo);
    if (r.outcome === 'ok') { console.log('Biglietto sporcato: da qui ciò che scrivi nasce non fidato.'); process.exit(0); }
    if (r.outcome === 'refused') { console.error(`RIFIUTATO dal server: ${r.reason}`); process.exit(4); }
    console.error(`guasto ${r.reason}`); process.exit(3);
  } else if (cmd === 'git-server') {
    const { readTicket } = await import('./lib/routine-ticket.mjs');
    const [azione, cartella, ramo, ...troppi] = args;
    if (troppi.length) { console.error(`git-server prende azione, cartella e al più un ramo: «${troppi.join(' ')}» è di troppo. Il server non è stato chiamato.`); process.exit(1); }
    process.exit(await eseguiGitServer({ azione, cartella, ramo, biglietto: mano.ticket || readTicket(ROOT) }));
  } else if (cmd === 'ramo-server') {
    const ramo = String(args[0] || '').trim();
    const sha = String(args[1] || data.sha || '').trim();
    if (!ramo) { console.error('ramo-server vuole il ramo spinto su filo-security. Il server non è stato chiamato.'); process.exit(1); }
    const { readTicket } = await import('./lib/routine-ticket.mjs');
    const biglietto = mano.ticket || readTicket(ROOT);
    if (!biglietto) { console.error('NESSUN BIGLIETTO: il server non è stato chiamato. Passalo con --ticket <codice>.'); process.exit(1); }
    const r = await ramoServer(biglietto, ramo, sha);
    if (r.outcome === 'ok') {
      console.log(`Ramo del server registrato: ${ramo} a ${r.sha.slice(0, 12)}${r.ramoFidato ? '' : ' (il registro dice: non fidato)'}.`);
      process.exit(0);
    }
    if (r.outcome === 'refused') { console.error(`RIFIUTATO dal server: ${r.reason}${r.detail ? `: ${r.detail}` : ''}`); process.exit(4); }
    console.error(`guasto ${r.reason}`); process.exit(3);
  } else if (cmd === 'compare') {
    // Senza biglietto il ruolo scalava al suo posto e partiva verso il server come biglietto (#878).
    if (!looksLikeTicket(args[0])) {
      console.error('NESSUN BIGLIETTO: il server non è stato chiamato. Uso: compare <biglietto> <ruolo> <numero>, oppure aggiungi --ticket <codice> (il codice è nelle istruzioni con cui sei partito).');
      process.exit(1);
    }
    const r = await compare(args[0], { role: args[1] || '', num: args[2] || '' });
    if (!r.ok) { console.error('confronto non registrato'); process.exit(0); }
    console.log(r.same ? 'confronto: stessa scelta' : 'confronto: scelte diverse (registrato per l\'owner)');
  } else {
    usage();
  }
}
