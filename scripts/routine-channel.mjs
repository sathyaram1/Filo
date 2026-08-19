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
//   node scripts/routine-channel.mjs release <biglietto> [--guasto "motivo"]
//       → fine lavoro: il biglietto muore e il semaforo si libera. Con
//         `--guasto` DICHIARI un guasto al server (SPEC-RIDISEGNO-MAX.md §12):
//         è così che il server smette di dare lavoro per il giro — le
//         richieste di biglietto successive escono con 3 — e il pacemaker
//         rispetta una pausa prima di riaccendere. Non "riportarlo" a parole:
//         il tuo testo di ritorno non lo legge nessuna macchina.
//
//   node scripts/routine-channel.mjs deliver <biglietto> <intento> [--campo valore …]
//       → consegna una decisione. Intenti: verdict, fixed, secaudit, status,
//         note, feedback. Exit 0 = accettata, 4 = RIFIUTATA dal server (non
//         ripiegare: il server ha guardato e ha detto no), 3 = guasto.
//         `--notes "…"` è il report per l'owner (il server lo cifra: nessuno
//         tranne lui lo rilegge). `--frase "…"` è la riga in chiaro per chi ha
//         mandato il feedback, che la vede nella sua bacheca.
//
//   node scripts/routine-channel.mjs compare <biglietto> <ruolo> <numero>
//       → registra cosa aveva scelto il cammino su git accanto a cosa aveva
//         scelto il server, e consuma il biglietto. Serve solo nella fase in
//         cui i due canali convivono.

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
  if (status === 200 && b.ok && b.work && b.ticket) return { outcome: 'work', ticket: String(b.ticket) };
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

export async function heartbeat(t, opts) {
  const { status, body } = await call('routineHeartbeat', { ticket: t }, opts);
  if (status === 200 && body && body.ok) return { ok: true, expiresAt: body.expiresAt };
  return { ok: false, reason: String((body && body.reason) || `http_${status}`) };
}

/**
 * Fine lavoro. `fault`, se presente, è il GUASTO DICHIARATO: il motivo per cui
 * questo giro non può lavorare, registrato AL CANALE invece che raccontato a
 * parole (il testo di ritorno di un worker non lo legge nessuna macchina). Il
 * server lo tronca e non lo interpreta; da lì in poi l'emissione dei biglietti
 * risponde `fault_declared` per il periodo di rispetto.
 */
export async function release(t, fault = '', opts) {
  const payload = { ticket: t };
  const motivo = String(fault || '').trim();
  if (motivo) payload.fault = motivo;
  const { status, body } = await call('routineRelease', payload, opts);
  return { ok: status === 200 && !!(body && body.ok), reason: String((body && body.reason) || '') };
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
  return 'refused';
}

/**
 * Consegna un intento al server. `data` NON contiene mai il feedback su cui si
 * agisce: quello il server lo legge dal biglietto.
 * @returns {{ outcome:'ok'|'refused'|'fault', reason?, id?, num? }}
 */
export async function deliver(t, intent, data, opts) {
  const { status, body } = await call('routineDeliver', { ticket: t, intent, data: data || {} }, opts);
  const outcome = classifyReply(status, body);
  return {
    outcome,
    reason: String((body && body.reason) || (outcome === 'ok' ? '' : `http_${status}`)),
    id: body && body.id,
    num: body && body.num,
  };
}

export async function compare(t, mine, opts) {
  const { status, body } = await call('routineCompare', { ticket: t, mine }, opts);
  return { ok: status === 200 && !!(body && body.ok), same: !!(body && body.same) };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  // Un passaggio solo: i `--campo valore` diventano dati dell'intento, il resto
  // sono posizionali. Così l'ordine fra flag e posizionali non conta, e un
  // valore che assomiglia a un comando non viene scambiato per tale.
  const args = [];
  const flags = [];
  const data = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) { args.push(a); continue; }
    flags.push(a);
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) data[key] = true;
    else { data[key] = next; i += 1; }
  }

  // I DUE TESTI (spec ROUTINE-AUTH-SPEC.md §8) hanno destinatari diversi: il
  // report va cifrato per l'owner, la frase resta in chiaro per chi ha mandato
  // il feedback. Chi consegna scrive `--frase`, una parola sola in italiano come
  // il resto delle ricette; il server la riceve col suo nome. Un solo nome per
  // la stessa cosa: due (uno qui e uno lì) è come si perde un testo per strada.
  if (typeof data.frase === 'string') { data.userNote = data.frase; }
  delete data.frase;

  const usage = () => {
    console.error('Uso: node scripts/routine-channel.mjs <ticket|work|heartbeat|release|deliver|compare> <segreto> [...]');
    process.exit(1);
  };

  if (!cmd || !args[0]) usage();

  if (cmd === 'probe') {
    const r = await probe(args[0]);
    if (r.outcome === 'work') { console.log('c’è lavoro'); process.exit(0); }
    if (r.outcome === 'nothing') { console.error(`niente da fare (${r.reason})`); process.exit(2); }
    console.error(`guasto ${r.reason}`); process.exit(3);
  } else if (cmd === 'ticket') {
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
      biglietto = readTicket(resolve(fileURLToPath(new URL('..', import.meta.url))));
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
        const pkg = JSON.parse(readFileSync(resolve(fileURLToPath(new URL('..', import.meta.url)), 'package.json'), 'utf8'));
        if (pkg.version) data.resolvedInVersion = pkg.version;
      } catch (_) { /* senza versione si chiude lo stesso: non è un motivo per fermarsi */ }
    }
    const r = await deliver(biglietto, intento, data);
    if (r.outcome === 'ok') { console.log(r.num ? `OK: ${r.num}` : 'OK: consegnato.'); process.exit(0); }
    if (r.outcome === 'refused') { console.error(`RIFIUTATO dal server: ${r.reason}`); process.exit(4); }
    console.error(`guasto ${r.reason}`); process.exit(3);
  } else if (cmd === 'compare') {
    const r = await compare(args[0], { role: args[1] || '', num: args[2] || '' });
    if (!r.ok) { console.error('confronto non registrato'); process.exit(0); }
    console.log(r.same ? 'confronto: stessa scelta' : 'confronto: scelte diverse (registrato per l\'owner)');
  } else {
    usage();
  }
}
