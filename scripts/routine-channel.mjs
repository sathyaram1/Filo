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
//   node scripts/routine-channel.mjs probe <parola-d-ordine>
//       → c'è lavoro? Non lega niente. Exit 0 = sì, 2 = niente da fare,
//         3 = guasto. Da chiedere PRIMA di pagare il setup dell'ambiente.
//
//   node scripts/routine-channel.mjs ticket <parola-d-ordine> [--json]
//       → stampa il biglietto su stdout (una riga), oppure "niente da fare".
//         Con `--json` stampa biglietto E ruolo insieme: serve a chi guida per
//         scegliere il tipo di worker PRIMA di lanciarlo.
//         Exit 0 = biglietto, 2 = niente da fare, 3 = guasto (il giro si ferma).
//
//   node scripts/routine-channel.mjs work <biglietto>
//       → stampa il JSON del proprio lavoro { role, ... }.
//
//   node scripts/routine-channel.mjs heartbeat [<biglietto>] [--loop]
//       → tiene vivo il semaforo. Con --loop batte finché il biglietto vive.
//         NON serve lanciarlo a mano: il ciclo lo avvia dispatch nel momento in
//         cui riceve il biglietto (lib/routine-beat.mjs), perché una cosa che
//         deve succedere sempre non si chiede a chi lavora. Senza biglietto fra
//         gli argomenti lo ritrova da solo, come le consegne.
//
//   node scripts/routine-channel.mjs release <biglietto> --role <ruolo> [--guasto "motivo"]
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
//         note, feedback. Exit 0 = accettata, 4 = RIFIUTATA dal server (non
//         ripiegare: il server ha guardato e ha detto no), 3 = guasto.
//         `--notes "…"` è il report per l'owner (il server lo cifra: nessuno
//         tranne lui lo rilegge). `--frase "…"` è la riga in chiaro per chi ha
//         mandato il feedback, che la vede nella sua bacheca. `--segnala
//         <file.md>` (su status, fixed e verdict) è la segnalazione per
//         l'owner — un trade-off vero, che decide lui — letta intera dal file
//         e scritta dal server nel livello L3 del feedback.
//
//   node scripts/routine-channel.mjs compare <biglietto> <ruolo> <numero>
//       → registra cosa aveva scelto il cammino su git accanto a cosa aveva
//         scelto il server, e consuma il biglietto. Serve solo nella fase in
//         cui i due canali convivono.
//
//   La FUSIONE su main non ha un sottocomando qui: passa da
//   `scripts/merge-gate.mjs <branch>`, che usa merge() di questo modulo. Il
//   merge lo fa il SERVER (SPEC-RIDISEGNO-MAX.md §10): verdetti registrati,
//   L5 sul diff che scarica lui, fusione via API con la sua identità.

import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pinnedRepoRoot } from './lib/tools-pin.mjs';
import { isProtectedBranch, headSha } from './lib/branch-integrity.mjs';
import { dirtyTreeText, statoDirectory, statoIllegibileText } from './lib/dirty-tree.mjs';
import { leggiTestoLivello } from './lib/livelli.mjs';

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
    return out;
  }
  if (status === 200 && b.ok && b.work === false) return { outcome: 'nothing', reason: String(b.reason || '') };
  return { outcome: 'fault', reason: String(b.reason || `http_${status}`) };
}

export async function ticket(passphrase, opts) {
  const { status, body } = await call('routineTicket', { passphrase }, opts);
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
  const { status, body } = await call('routineTicket', { passphrase, probe: true }, opts);
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

export async function heartbeat(t, opts = {}) {
  const { status, body } = await call('routineHeartbeat', { ticket: t, ...statoContenitore(opts) }, opts);
  if (status === 200 && body && body.ok) return { ok: true, expiresAt: body.expiresAt };
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
  const { status, body } = await call('routineRelease', payload, opts);
  return { ok: status === 200 && !!(body && body.ok), reason: String((body && body.reason) || ''), status, body };
}

/**
 * Rilascio col rapporto allegato, e le due ritentate che il server prevede:
 *   - 413 `report_too_big` → una volta senza `tools.byName` e `notes`; se è
 *     ancora troppo, senza rapporto, e lo si dice;
 *   - 400 `report_malformed` → senza rapporto, e lo si dice.
 * Il rilascio è idempotente: riprovare è sicuro. `esito.rapporto` dice cosa è
 * arrivato al server: 'allegato', 'ridotto', 'scartato' o 'assente';
 * `esito.avviso` è la riga da stampare quando qualcosa è andato perso.
 */
export async function releaseConRapporto(t, fault, report, opts) {
  const tenta = (rep) => release(t, fault, opts, rep);
  if (!report || typeof report !== 'object') return { ...(await tenta(null)), rapporto: 'assente' };
  let r = await tenta(report);
  if (r.status === 413 && r.reason === 'report_too_big') {
    const misura = `${r.body && r.body.bytes ? r.body.bytes : '?'} byte, massimo ${r.body && r.body.max ? r.body.max : '?'}`;
    const snello = { ...report, tools: { ...(report.tools || {}) } };
    delete snello.tools.byName;
    delete snello.notes;
    r = await tenta(snello);
    if (r.status === 413 && r.reason === 'report_too_big') {
      r = await tenta(null);
      return { ...r, rapporto: 'scartato', avviso: `rapporto troppo grande anche senza l'elenco degli strumenti (${misura}): rilasciato SENZA rapporto.` };
    }
    return { ...r, rapporto: 'ridotto', avviso: `rapporto troppo grande (${misura}): allegato senza l'elenco degli strumenti e le note.` };
  }
  if (r.status === 400 && r.reason === 'report_malformed') {
    // Il dettaglio è nella PRIMA risposta (quella che ha rifiutato il
    // rapporto), non nella seconda: letto dopo la ritentata si perdeva.
    const dettaglio = r.body && r.body.detail ? `: ${r.body.detail}` : '';
    r = await tenta(null);
    return { ...r, rapporto: 'scartato', avviso: `il server non ha capito il rapporto (report_malformed${dettaglio}): rilasciato SENZA rapporto.` };
  }
  return { ...r, rapporto: 'allegato' };
}

// ─── Domanda di fine sessione (endpoint routineClosing) ─────────────────────

/** Il corpo della richiesta: una credenziale sola, il server ne rifiuta due o nessuna. PURA. */
export function corpoChiusura(op, { passphrase = '', ticket = '', id = '', answer } = {}) {
  if (!passphrase === !ticket) throw new Error('serve esattamente una fra parola d\'ordine e biglietto');
  const corpo = passphrase ? { passphrase: String(passphrase), op } : { ticket: String(ticket), op };
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
  if (senzaServer) return { esito: 'assente', reason };
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
  const { status, body } = await call('routineClosing', corpoChiusura('question', cred), opts);
  const r = leggiRispostaChiusura(status, body);
  // Senza testo, o senza l'id con cui rispondere, non c'è una domanda a cui rispondere.
  if (r.esito === 'ok' && (!r.question.trim() || (cred.passphrase && !r.id))) return { esito: 'assente', reason: 'busta_incompleta' };
  return r;
}

export async function rispostaChiusura(cred, answer, opts) {
  const { status, body } = await call('routineClosing', corpoChiusura('answer', { ...cred, answer }), opts);
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
export function pushRamoCorrente(root, { exec = execFileSync } = {}) {
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
  const push = run(['push', 'origin', `HEAD:refs/heads/${ramo}`]);
  if (push.ok) return { ok: true, skipped: false, branch: ramo };
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
    if (lease.ok) return { ok: true, skipped: false, branch: ramo, forced: true };
    return { ok: false, skipped: false, branch: ramo, reason: `storia divergente, e anche --force-with-lease è stato rifiutato (qualcun altro ha spinto su '${ramo}'?): ${pulisciGit(lease.out)}` };
  }
  return { ok: false, skipped: false, branch: ramo, reason: pulisciGit(push.out) };
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
  const routine = Boolean(env.FILO_ROUTINE) && env.FILO_ROUTINE !== '0';
  const nome = routine ? 'claude-routine' : 'claude-local';
  const email = routine ? 'claude@routine' : 'claude@local';
  const elenco = `${st.lines.slice(0, 3).join(', ')}${st.lines.length > 3 ? ` (+${st.lines.length - 3} file)` : ''}`;
  const commit = run(['-c', `user.name=${nome}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', `auto: rilascio — ${elenco}`]);
  if (!commit.ok) return { ok: false, skipped: false, committed: [], reason: pulisciGit(commit.out) };
  return { ok: true, skipped: false, committed: st.lines, reason: '' };
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
 * Chiede al SERVER di fondere il ramo su main (SPEC-RIDISEGNO-MAX.md §10).
 *
 * Qui non si decide niente: il server verifica dallo stato VERO (verdetti di
 * verifica e sicurezza REGISTRATI), fa girare L5 sul diff che scarica lui da
 * GitHub, e fonde con la SUA identità. Il ramo passato può solo CONFERMARE
 * quello legato al biglietto: nominarne un altro è un rifiuto registrato, non
 * una correzione silenziosa. Nessun verdetto viaggia nel corpo — il vecchio
 * FILO_L4_VERDICT per il server non esiste.
 *
 * Stessi ritentativi di call(): i guasti transienti (rete, 5xx) si ritentano,
 * un rifiuto no.
 *
 * `approval` c'è solo sui blocchi: è la richiesta che il server ha aperto per
 * l'owner. Va portata fin qui, o chi legge il registro crede che il ramo sia
 * perduto proprio nel caso in cui invece basta un via libera.
 *
 * `opts.sha` è il CONTENUTO su cui i due esiti ragionati erano stati dati:
 * viaggia con la richiesta come già fa il cammino locale (`ownerMerge`), dove
 * il server pretende che combaci con la punta vera e altrimenti risponde
 * `stale`. Senza, l'ultimo passo del giro continua a parlare del nome del ramo
 * mentre tutti i passi prima parlano di un commit, e il via libera resta buono
 * anche dopo che il foglio è stato sostituito (feedback #485). La sicurezza
 * non dipende dal fatto che il chiamante lo dichiari: la punta vera il server
 * se la chiede comunque. Questo è il controllo in più, e il posto dove
 * l'informazione arriva.
 *
 * @returns {{ ok:true, result:'merged'|'blocked'|'conflict', reason?, sha?, approval? }
 *           | { ok:false, reason }}
 */
export async function merge(t, branch, opts) {
  const { sha = '', ...rest } = opts && typeof opts === 'object' ? opts : {};
  const payload = { ticket: t, branch: String(branch || '') };
  if (String(sha || '')) payload.sha = String(sha);
  const { status, body } = await call('routineMerge', payload, rest);
  if (status === 200 && body && body.ok && body.result) {
    return {
      ok: true,
      result: String(body.result),
      reason: String(body.reason || ''),
      sha: String(body.sha || ''),
      approval: String(body.approval || ''),
    };
  }
  return { ok: false, reason: String((body && body.reason) || `http_${status}`) };
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

// ─── CLI ─────────────────────────────────────────────────────────────────────

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  // Un passaggio solo: i `--campo valore` diventano dati dell'intento, il resto
  // sono posizionali. Così l'ordine fra flag e posizionali non conta, e un
  // valore che assomiglia a un comando non viene scambiato per tale.
  // I nomi di campo che questo strumento conosce.
  const CAMPI = new Set([
    'notes', 'frase', 'text', 'title', 'status', 'reason', 'resolvedInVersion',
    'branch', 'sha', 'verdict', 'critique', 'summary', 'findings', 'report',
    'userNote', 'priority', 'guasto', 'loop', 'name', 'json',
    'segnala', 'senza-push', 'senza-rapporto', 'role', 'stop',
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
    if (TRATTINI.includes(t[0])) return !/^[0-9]/.test(t.replace(/^[-‐‑‒–—−]+/, ''));
    // La conchiglia di Git riscrive `/guasto` come percorso: si guarda l'ultimo
    // pezzo, e solo per i nomi che conosciamo — un percorso vero è un valore.
    if (t.includes('/')) return CAMPI.has(t.split('/').pop().split('=')[0]);
    return false;
  };

  // Quelli che senza il loro testo non hanno senso: un «sì» al loro posto
  // vuol dire consegnare a vuoto.
  const CAMPI_TESTO = new Set([
    'notes', 'frase', 'text', 'title', 'critique', 'summary', 'report',
    'userNote', 'guasto', 'reason', 'branch', 'sha', 'status', 'segnala', 'role',
  ]);
  // E quelli che un valore non lo vogliono MAI: sono interruttori. Senza
  // questo elenco `--json` finiva fra i campi con valore, spariva dai
  // posizionali, e chi lo cercava lì non lo trovava: il ruolo usciva vuoto,
  // chi guida leggeva «server vecchio» e lanciava sempre il worker generico —
  // col biglietto ormai ritirato, che è la cosa che non si annulla (#565).
  const CAMPI_BANDIERA = new Set(['json', 'senza-push', 'senza-rapporto', 'stop']);
  const args = [];
  const flags = [];
  const data = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
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
    if (next === undefined || next.startsWith('--')) {
      // Un campo di TESTO senza il suo testo non è un sì: è un report che
      // parte vuoto mentre la risposta dice OK (feedback #565).
      if (CAMPI_TESTO.has(key)) {
        // `--segnala` vuole un FILE, non un testo: dirgli «un testo» lo mandava
        // a passare la segnalazione sulla riga di comando, e a sbagliare due
        // volte. Stessa frase di dispatch --record-*.
        console.error(key === 'segnala'
          ? '--segnala vuole il percorso di un file subito dopo di sé (un .md scritto prima): non ho consegnato niente.'
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

  // `--segnala <file.md>`: la segnalazione per l'owner (L3), letta INTERA dal
  // file con gli stessi controlli di dispatch --record-* (assente, vuoto,
  // oltre il tetto = errore chiaro, prima del server). Il server la legge col
  // nome `segnalazione` su status, fixed e verdict; su un altro intento non
  // avrebbe dove andare, e sparirebbe in silenzio.
  if (typeof data.segnala === 'string') {
    const intentoSeg = [args[0], args[1]].find((a) => ['status', 'fixed', 'verdict'].includes(a));
    if (cmd !== 'deliver' || !intentoSeg) {
      console.error('--segnala vale solo su deliver status, fixed e verdict: non ho consegnato niente.');
      process.exit(1);
    }
    const seg = leggiTestoLivello(data.segnala, 'segnala');
    if (!seg.ok) { console.error(seg.message); process.exit(1); }
    data.segnalazione = seg.testo;
  }
  delete data.segnala;

  // `--stop` resta accettato per chi lo scrive ancora, ma non serve: è la
  // segnalazione che ferma il lavoro, e senza l'owner non saprebbe cosa
  // decidere. Stessa regola di dispatch --record-fixed --ferma.
  if (data.stop !== undefined) {
    const suFixed = cmd === 'deliver' && [args[0], args[1]].includes('fixed');
    if (data.stop !== true || !suFixed || !data.segnalazione) {
      console.error('--stop vale solo su deliver fixed, senza valore, e insieme a --segnala <file.md> (che da sola ferma già il lavoro): non ho consegnato niente.');
      process.exit(1);
    }
  }

  const usage = () => {
    // Il percorso VERO di questo strumento, non la forma corta: se sta girando
    // la copia fissata, `scripts/…` porterebbe a quello del ramo di lavoro —
    // cioè proprio la cosa che il contratto dei worker vieta di scrivere a mano.
    const io = resolve(fileURLToPath(import.meta.url)).split('\\').join('/');
    console.error(`Uso: node "${io}" <probe|ticket|work|heartbeat|release|deliver|compare> <segreto> [...]`);
    process.exit(1);
  };

  // `heartbeat` è l'unico comando che può girare senza posizionali: il ciclo lo
  // avvia dispatch e il biglietto viaggia nell'ambiente, mai fra gli argomenti.
  if (!cmd || (!args[0] && cmd !== 'heartbeat')) usage();

  if (cmd === 'probe') {
    const r = await probe(args[0]);
    if (r.outcome === 'work') { console.log('c’è lavoro'); process.exit(0); }
    if (r.outcome === 'nothing') { console.error(`niente da fare (${r.reason})`); process.exit(2); }
    console.error(`guasto ${r.reason}`); process.exit(3);
  } else if (cmd === 'ticket') {
    const r = await ticket(args[0]);
    // `--json`: biglietto E ruolo, per chi deve scegliere il worker prima di
    // lanciarlo. Senza flag resta la sola stringa, come sempre.
    if (r.outcome === 'work') { console.log(data.json === true ? JSON.stringify({ ticket: r.ticket, role: r.role || '' }) : r.ticket); process.exit(0); }
    if (r.outcome === 'nothing') { console.error(`niente da fare (${r.reason})`); process.exit(2); }
    console.error(`guasto ${r.reason}`); process.exit(3);
  } else if (cmd === 'work') {
    const r = await work(args[0]);
    if (!r.ok) { console.error(`guasto ${r.reason}`); process.exit(3); }
    console.log(JSON.stringify(r.payload, null, 2));
  } else if (cmd === 'heartbeat') {
    // Il ciclo lo avvia dispatch, che passa il biglietto nell'ambiente: la riga
    // di comando di un processo la legge chiunque sulla macchina.
    let biglietto = args[0];
    if (!biglietto) {
      const { readTicket } = await import('./lib/routine-ticket.mjs');
      biglietto = readTicket(ROOT);
    }
    if (!biglietto) {
      console.error('Nessun biglietto: non c’è nessun semaforo da tenere vivo.');
      process.exit(3);
    }
    if (!flags.includes('--loop')) {
      const r = await heartbeat(biglietto);
      if (!r.ok) { console.error(`guasto ${r.reason}`); process.exit(3); }
      console.log(`OK: semaforo vivo fino a ${r.expiresAt}`);
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
        if (r.ok) { primoGuastoMs = 0; await defaultSleep(BEAT_EVERY_MS); continue; }
        if (r.final) { console.error(`battito finito: ${r.reason}`); process.exit(0); }
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
    // PRIMA del server: il ramo corrente va su origin. Un commit fatto a mano
    // dal worker non passa dall'hook, e senza questo push moriva col
    // contenitore. Se il push non riesce NON si rilascia: si stampa la causa e
    // si esce diverso da zero, il worker sistema e rilancia (il biglietto scade
    // da solo dopo 60 minuti se muore). `--senza-push` dove non c'è un repo.
    if (data['senza-push'] !== true) {
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
      const p = pushRamoCorrente(ROOT);
      if (!p.ok) {
        console.error(`Il ramo${p.branch ? ` '${p.branch}'` : ''} NON è arrivato su origin: ${p.reason}`);
        console.error('Non ho rilasciato niente: sistema il push e rilancia lo stesso comando (--senza-push solo se qui non c\'è un repo).');
        process.exit(1);
      }
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
        rapporto = await generaRapporto({ role: ruolo, ticket: args[0], cwd: ROOT, since: readTicketSince(ROOT) });
      } catch (e) {
        rapporto = { v: 1, role: ruolo, ticket: args[0], notes: [`rapporto non generato: ${String((e && e.message) || e)}`] };
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
      // Fine giro LEGITTIMA: il punto fermo si sigilla sul contenuto attuale
      // (#507). Senza, i commit fatti dopo l'ultima consegna — la pulizia del
      // verificatore, per esempio — al posizionamento successivo nello stesso
      // clone verrebbero scartati come moncone di un'istanza morta.
      try {
        const { sealCurrentWork } = await import('./lib/branch-integrity.mjs');
        sealCurrentWork(ROOT, { by: 'release' });
      } catch (_) { /* best-effort: il rilascio è già andato */ }
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
    const INTENTI = ['verdict', 'fixed', 'secaudit', 'status', 'note', 'feedback'];
    let biglietto = args[0];
    let intento = args[1] || '';
    if (INTENTI.includes(args[0])) {
      intento = args[0];
      const { readTicket } = await import('./lib/routine-ticket.mjs');
      biglietto = readTicket(ROOT);
      if (!biglietto) {
        console.error('Nessun biglietto: questa consegna non ha un lavoro a cui riferirsi.');
        process.exit(3);
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
    if (passaAllaVerifica) {
      const cosa = intento === 'verdict' ? 'critica'
        : intento === 'fixed' ? 'consegna'
          : intento === 'secaudit' ? 'verdetto' : 'revisione';
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
      if (intento === 'verdict' || intento === 'secaudit') {
        const quale = intento === 'verdict' ? 'critica non registrata' : 'verdetto non registrato';
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
      }
    }
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
    if (r.outcome === 'ok') {
      // Una consegna con segnalazione ferma il lavoro: chi consegna deve saperlo
      // adesso, o crede di averlo mandato in verifica.
      const fermo = r.reply && r.reply.outcome === 'stop';
      const conSegnalazione = typeof data.segnalazione === 'string' && data.segnalazione.trim();
      if (fermo) console.log(`${r.num ? `OK: ${r.num}` : 'OK'}: il lavoro è FERMO e aspetta l'owner (la segnalazione è consegnata). Rilascia il biglietto.`);
      else if (conSegnalazione) console.log(`${r.num ? `OK: ${r.num}` : 'OK: consegnato'}. ATTENZIONE: la consegna portava una segnalazione ma il server non ha fermato il lavoro (server vecchio?).`);
      else console.log(r.num ? `OK: ${r.num}` : 'OK: consegnato.');
      process.exit(0);
    }
    if (r.outcome === 'refused') { console.error(`RIFIUTATO dal server: ${r.reason}${r.detail ? `: ${r.detail}` : ''}`); process.exit(4); }
    console.error(`guasto ${r.reason}`); process.exit(3);
  } else if (cmd === 'compare') {
    const r = await compare(args[0], { role: args[1] || '', num: args[2] || '' });
    if (!r.ok) { console.error('confronto non registrato'); process.exit(0); }
    console.log(r.same ? 'confronto: stessa scelta' : 'confronto: scelte diverse (registrato per l\'owner)');
  } else {
    usage();
  }
}
