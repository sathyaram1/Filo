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
// STATO (pezzo #477.1): il canale c'è e funziona, ma NON ha ancora autorità.
//   Le decisioni continuano a passare dalla coda su git. Qui si può già
//   chiedere un biglietto, ritirare il lavoro, battere il cuore e rilasciare;
//   il confronto fra la scelta del server e quella del cammino su git viene
//   registrato per l'owner. La consegna passerà di qui col pezzo successivo.
//
// I SEGRETI NON PASSANO DALL'AMBIENTE
//   Parola d'ordine e biglietto si passano come ARGOMENTO, mai come variabile
//   d'ambiente: l'ambiente lo eredita ogni processo figlio, ed è esattamente il
//   difetto che questa spec viene a togliere. Se ti viene comodo esportarli,
//   fermati: stai ricreando il problema.
//
// USO
//   node scripts/routine-channel.mjs ticket <parola-d-ordine>
//       → stampa il biglietto su stdout (una riga), oppure "niente da fare".
//         Exit 0 = biglietto, 2 = niente da fare, 3 = guasto (il giro si ferma).
//
//   node scripts/routine-channel.mjs work <biglietto>
//       → stampa il JSON del proprio lavoro { role, ... }.
//
//   node scripts/routine-channel.mjs heartbeat <biglietto> [--loop]
//       → tiene vivo il semaforo. Con --loop batte finché il biglietto vive
//         (da lanciare in sottofondo per le sessioni lunghe).
//
//   node scripts/routine-channel.mjs release <biglietto>
//       → fine lavoro: il biglietto muore e il semaforo si libera.
//
//   node scripts/routine-channel.mjs compare <parola-d-ordine> <ruolo> <numero>
//       → registra cosa aveva scelto il cammino su git, per il confronto.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// L'indirizzo del canale. `FILO_ROUTINE_API` esiste per i test e per un
// eventuale ambiente di prova: NON è un segreto, è solo dove sta il server.
const BASE = process.env.FILO_ROUTINE_API
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

// Il battito va più fitto della scadenza del semaforo (30 minuti lato server):
// dieci minuti lasciano il margine per due battiti persi di fila.
const BEAT_EVERY_MS = 10 * 60 * 1000;

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
      if (res.status >= 500 && i < attempts) { last = { status: res.status, body }; await sleep(baseDelayMs * i); continue; }
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
  if (status === 200 && b.ok && b.work && b.ticket) return { outcome: 'work', ticket: String(b.ticket) };
  if (status === 200 && b.ok && b.work === false) return { outcome: 'nothing', reason: String(b.reason || '') };
  return { outcome: 'fault', reason: String(b.reason || `http_${status}`) };
}

export async function ticket(passphrase, opts) {
  const { status, body } = await call('routineTicket', { passphrase }, opts);
  return readTicketReply(status, body);
}

export async function work(t, opts) {
  const { status, body } = await call('routineWork', { ticket: t }, opts);
  if (status === 200 && body && body.ok) return { ok: true, payload: body.payload };
  return { ok: false, reason: String((body && body.reason) || `http_${status}`) };
}

export async function heartbeat(t, opts) {
  const { status, body } = await call('routineHeartbeat', { ticket: t }, opts);
  if (status === 200 && body && body.ok) return { ok: true, expiresAt: body.expiresAt };
  return { ok: false, reason: String((body && body.reason) || `http_${status}`) };
}

export async function release(t, opts) {
  const { status, body } = await call('routineRelease', { ticket: t }, opts);
  return { ok: status === 200 && !!(body && body.ok), reason: String((body && body.reason) || '') };
}

export async function compare(t, mine, opts) {
  const { status, body } = await call('routineCompare', { ticket: t, mine }, opts);
  return { ok: status === 200 && !!(body && body.ok), same: !!(body && body.same) };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = rest.filter((a) => a.startsWith('--'));
  const args = rest.filter((a) => !a.startsWith('--'));

  const usage = () => {
    console.error('Uso: node scripts/routine-channel.mjs <ticket|work|heartbeat|release|compare> <segreto> [...]');
    process.exit(1);
  };

  if (!cmd || !args[0]) usage();

  if (cmd === 'ticket') {
    const r = await ticket(args[0]);
    if (r.outcome === 'work') { console.log(r.ticket); process.exit(0); }
    if (r.outcome === 'nothing') { console.error(`niente da fare (${r.reason})`); process.exit(2); }
    console.error(`guasto ${r.reason}`); process.exit(3);
  } else if (cmd === 'work') {
    const r = await work(args[0]);
    if (!r.ok) { console.error(`guasto ${r.reason}`); process.exit(3); }
    console.log(JSON.stringify(r.payload, null, 2));
  } else if (cmd === 'heartbeat') {
    if (!flags.includes('--loop')) {
      const r = await heartbeat(args[0]);
      if (!r.ok) { console.error(`guasto ${r.reason}`); process.exit(3); }
      console.log(`OK: semaforo vivo fino a ${r.expiresAt}`);
    } else {
      // Sessioni lunghe: si batte finché il server risponde. Quando il
      // biglietto muore (rilasciato o semaforo caduto) il ciclo finisce da solo
      // — nessun processo che resta appeso a battere il cuore di un morto.
      for (;;) {
        const r = await heartbeat(args[0]);
        if (!r.ok) { console.error(`battito finito: ${r.reason}`); process.exit(0); }
        await defaultSleep(BEAT_EVERY_MS);
      }
    }
  } else if (cmd === 'release') {
    const r = await release(args[0]);
    console.log(r.ok ? 'OK: biglietto rilasciato.' : `rilascio non riuscito (${r.reason})`);
  } else if (cmd === 'compare') {
    const r = await compare(args[0], { role: args[1] || '', num: args[2] || '' });
    if (!r.ok) { console.error('confronto non registrato'); process.exit(0); }
    console.log(r.same ? 'confronto: stessa scelta' : 'confronto: scelte diverse (registrato per l\'owner)');
  } else {
    usage();
  }
}
