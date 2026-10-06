// Chiedere al SERVER di fondere il proprio ramo su main — lato sessione locale.
//
// PERCHÉ ESISTE (SPEC-RIDISEGNO-MAX.md §10)
//   Il cancello delle routine aveva già tolto alla macchina che lavora il
//   potere di scrivere su `main`. Restava però la porta accanto: `npm run
//   finish` fondeva e pubblicava da qui, con le credenziali dell'owner —
//   presenti sulla stessa macchina dove gira un LLM che legge tutto il giorno
//   testo scritto da sconosciuti. Finché quella porta c'era, il muro non era un
//   muro: un'istanza catturata non doveva convincere nessuno, le bastava
//   spingere il ramo principale.
//
//   Da qui in poi anche il finish locale CHIEDE. Quello che parte da questo
//   file è una domanda, non un'azione: il server guarda il diff che scarica
//   lui, fa girare i controlli deterministici e decide.
//
//   Con `feedbackId` (#908) il server rilegge la pratica: se è un lavoro locale
//   provato fonde senza chiedere (L5 registra soltanto) e la chiude; se no dice
//   perché, e la fusione ferma aspetta il sì dell'owner in Gestione, per regola.
//   Con `pendingParts` (#915) la lascia aperta per la parte del server che manca.
//
//   La porta accanto non è stata murata togliendo la credenziale — quella su
//   questa macchina c'è ancora — ma **su GitHub**: una regola di protezione del
//   repo lascia scrivere su `main` la sola identità del server, e respinge
//   tutto il resto (provato). Quello che è cambiato qui è che non si tenta più:
//   un tentativo respinto in silenzio non è una difesa, è un guasto invisibile.
//
// COSA VIAGGIA
//   Il ramo, lo SHA della sua punta — cioè esattamente il codice su cui i
//   controlli locali sono girati — e, se c'è, l'id della pratica. Se nel frattempo il ramo è cambiato, il
//   server se ne accorge e non fonde: senza quello sha basterebbe far passare i
//   controlli su una versione e far fondere l'altra.
//
//   Non viaggia nessun verdetto: dire al server "i test sono verdi" non
//   servirebbe a niente, perché non gli si crede.
//
// La traduzione degli esiti è PURA e testata (tests/unit/ownerMerge.test.mjs):
// è il pezzo che decide cosa legge l'owner e con quale uscita si chiude.

import { findAdminRefreshToken, mintIdToken } from './firestore-auth.mjs';

// Dove vive il server. `FILO_ROUTINE_API` esiste per i test e per un eventuale
// ambiente di prova: NON è un segreto, è solo un indirizzo.
const BASE = process.env.FILO_ROUTINE_API
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

export const OWNER_MERGE_URL = `${BASE}/ownerMerge`;
export const OWNER_MERGE_APPROVALS_URL = `${BASE}/ownerMergeApprovals`;

/**
 * In che stato è la richiesta `id` secondo l'elenco del deposito (`ownerMergeApprovals`, op list). PURA.
 * Il server dà il nome della richiesta anche quando il deposito ha rifiutato di riaprirla perché già decisa (#486):
 * una richiesta rinfrescata adesso è la più nuova, quindi se non sta fra quelle in attesa è stata decisa.
 * @returns {{ state: 'pending'|'discarded'|'used'|'decided'|'', outcome?: string, motivo?: string }} '' = elenco illeggibile
 */
export function statoDellaRichiesta(id, elenco) {
  const e = (elenco && typeof elenco === 'object') ? elenco : null;
  if (!id || !e || e.ok !== true || !Array.isArray(e.pending)) return { state: '', motivo: 'l’elenco delle richieste non si legge' };
  const trova = (k) => (Array.isArray(e[k]) ? e[k] : []).find((v) => v && v.id === id);
  if (trova('pending')) return { state: 'pending' };
  const v = trova('failed') || trova('recent') || trova('preapproved');
  if (v && v.discarded === true) return { state: 'discarded' };
  if (v && v.used === true) return { state: 'used', outcome: String(v.outcome || '').slice(0, 40) };
  return { state: 'decided' };
}

/** La richiesta potrebbe aspettare l'owner: in attesa, o non controllata. PURA. Decide se suonare il campanello. */
export function richiestaForseInAttesa(reply) {
  const r = reply || {};
  return r.outcome === 'blocked' && !!r.requestId && !['discarded', 'used', 'decided'].includes(r.requestState);
}

// La stessa approvazione da un browser qualunque (#489): serve il giorno in cui è Filo a non aprirsi.
export const PAGINA_APPROVAZIONI = 'https://filo-8b9cb.web.app';

/**
 * Dalla risposta grezza del server a un esito con un nome. PURA.
 *
 * Gli esiti sono sette, e sono diversi apposta: un blocco dei controlli non è
 * un conflitto, un ramo cambiato non è un guasto, e "il server non ha la
 * credenziale per scrivere" non è "il server non risponde". Appiattirli
 * significherebbe rimandare l'owner a indovinare cosa fare.
 *
 * @param {number} status  codice HTTP (0 = non ci si è arrivati)
 * @param {object} body    corpo JSON già interpretato
 * @returns {{ outcome, sha?, reason?, headSha? }}
 */
export function classifyOwnerMerge(status, body) {
  const b = body || {};
  const r = b.result || {};
  const errMsg = String((b.error && b.error.message) || '');

  if (status === 200 && r.ok === true) {
    if (r.result === 'merged') return { outcome: 'merged', sha: String(r.sha || ''), ...campiLocali(r) };
    // Bloccata dai controlli: il server non l'ha respinta e basta, ha aperto
    // una richiesta in attesa. `requestId` vuoto significa che non c'è riuscito
    // (deposito non raggiungibile, oppure server non ancora rideployato): sono
    // due situazioni diverse per chi legge, e vanno dette diverse.
    if (r.result === 'blocked') {
      return { outcome: 'blocked', reason: String(r.reason || ''), requestId: String(r.requestId || ''), ...campiLocali(r) };
    }
    if (r.result === 'conflict') return { outcome: 'conflict', reason: String(r.reason || '') };
    if (r.result === 'stale') return { outcome: 'stale', headSha: String(r.headSha || '') };
    // #929: main non è più quello su cui sono girati gli unit della fusione; chi chiede rifà la prova.
    if (r.result === 'main_moved') return { outcome: 'main_moved', mainSha: String(r.mainSha || '') };
    if (r.result === 'unit_rossi') return { outcome: 'unit_rossi', reason: String(r.reason || '') };
    return { outcome: 'fault', reason: `risposta inattesa: ${String(r.result || '')}` };
  }
  if (status === 200 && r.ok === false) {
    const reason = String(r.reason || '');
    if (reason === 'github_no_token') return { outcome: 'no_credential', reason };
    if (reason === 'github_unreachable' || /^github_5/.test(reason)) return { outcome: 'unreachable', reason };
    return { outcome: 'fault', reason: reason || 'guasto senza motivo' };
  }
  // Una chiamata che non esiste (ancora) è il caso più probabile di tutti finché
  // il server non è stato rideployato: dirlo per nome evita mezz'ora di caccia.
  if (status === 404) return { outcome: 'not_deployed', reason: errMsg };
  if (status === 401 || status === 403) return { outcome: 'denied', reason: errMsg };
  if (status === 400) return { outcome: 'rejected', reason: errMsg };
  if (status === 0 || status >= 500) return { outcome: 'unreachable', reason: errMsg || `http_${status}` };
  return { outcome: 'fault', reason: errMsg || `http_${status}` };
}

/**
 * Quello che il server dice della pratica locale (#908), solo se lo dice. PURA.
 * Tutto sta in `r.local` (localView in filo-security ownerMerge.js): ammessa →
 * num, skippedL5, blocks ({ gate, label, detail } o il solo nome), record, closed, late, pending, noted,
 * approvato e daRoutine (il sì dell'owner a un feedback non suo, #913); non ammessa → reason, detail.
 */
function campiLocali(r) {
  const loc = (r.local && typeof r.local === 'object') ? r.local : null;
  if (!loc) return {};
  const out = {};
  if (loc.num) out.localNum = String(loc.num).slice(0, 24);
  if (loc.eligible === true) {
    if (loc.skippedL5 === true) {
      out.skippedL5 = true;
      out.blocks = Array.isArray(loc.blocks) ? loc.blocks.slice(0, 50) : [];
      out.record = String(loc.record || '').slice(0, 128);
    }
    if (typeof loc.closed === 'boolean') out.closed = loc.closed;
    if (Array.isArray(loc.pending) && loc.pending.length) {
      out.pending = loc.pending.slice(0, 10).map((p) => ({ part: String(p && p.part || ''), branch: String(p && p.branch || '').slice(0, 200) }));
    }
    if (loc.late && typeof loc.late === 'object') out.late = { part: String(loc.late.part || ''), at: String(loc.late.at || '').slice(0, 40) };
    if (typeof loc.noted === 'boolean') out.noted = loc.noted;
    if (loc.approvato === true) out.approvato = true;
    if (loc.approvato === true && loc.daRoutine === true) out.daRoutine = true;
    return out;
  }
  out.localReason = String(loc.reason || 'pratica_non_ammessa').slice(0, 80);
  out.localDetail = String(loc.detail || '').slice(0, 300);
  return out;
}

/** Un blocco registrato, in una riga: il server manda l'elenco intero, e un taglio si dichiara. PURA. */
function bloccoInRiga(t) {
  if (!t || typeof t !== 'object') return String(t || '');
  const nome = String(t.label || t.gate || 'controllo');
  const det = String(t.detail || '');
  if (!det) return nome;
  return det.length > 2000 ? `${nome}: ${det.slice(0, 2000)}… (elenco intero nella nota della pratica)` : `${nome}: ${det}`;
}

const NOME_PARTE = { app: 'dell’app', server: 'del server' };

/** Un lavoro con app e server (#915): la pratica resta aperta per la parte che manca, o era già chiusa dall'altra. PURA. */
function righeDelleParti(r, pratica, num) {
  const righe = [];
  if (r.late) {
    righe.push(`  Pratica ${pratica}: l’aveva chiusa la fusione della parte ${NOME_PARTE[r.late.part] || r.late.part} dello stesso lavoro${r.late.at ? ` (${r.late.at})` : ''}. Questa era l’ultima parte, e la pratica resta chiusa.`);
  } else if (r.pending && r.pending.length) {
    righe.push(`  La pratica ${pratica} resta aperta: manca ${r.pending.map((p) => `la parte ${NOME_PARTE[p.part] || p.part} (${p.branch})`).join(', ')}, non ancora su main.`);
    const n = num ? String(num).replace(/^#+/, '') : '<N>';
    for (const p of r.pending.filter((x) => x.part === 'server')) righe.push(`  La chiude: npm run server:fondi -- ${p.branch} --feedback ${n}`);
  } else return righe;
  if (r.noted === false) righe.push('  La nota nella pratica NON si è scritta: in Gestione non si legge cosa manca.');
  return righe;
}

const RIPROPONI = '  Per riproporla serve un commit nuovo, anche vuoto, poi rilancia npm run finish:\n'
  + '    git commit --allow-empty -m "riproposta"';

/** Il seguito di un blocco: dove sta la richiesta, o perché in Filo non c'è niente da approvare (#486). PURA. */
function righeDellaRichiesta(r) {
  if (!r.requestId) {
    return '  Non sono riuscito a metterla in attesa: nell\'app non comparirà niente da\n'
      + '  approvare. Riprova, e se non torna vanno rideployate le funzioni di sicurezza.';
  }
  const giaDecisa = (perche) => `  NON l'ho messa in attesa: ${perche}\n  In Filo non c'è niente da approvare.\n${RIPROPONI}`;
  switch (r.requestState) {
    case 'pending':
      return '  L\'ho messa IN ATTESA: approvala da Filo, nella dashboard di gestione\n'
        + '  (l\'avviso in cima ai Ricevuti). Da lì puoi anche scartarla.\n'
        + '  Se la pagina è già aperta l\'avviso compare da solo, non serve riaprirla.\n'
        + `  Se Filo non si apre: ${PAGINA_APPROVAZIONI} da un browser qualunque,\n`
        + '  con l\'account del proprietario.\n'
        + '  Vale per il commit appena controllato e per 7 giorni: se scade, o se il\n'
        + '  ramo si muove, rilancia npm run finish.';
    case 'discarded':
      return giaDecisa('questa versione era già stata SCARTATA, e una richiesta\n  decisa non si riapre.');
    case 'used':
      return giaDecisa(`questa versione era già stata APPROVATA${r.requestOutcome === 'conflict' ? ', e la fusione\n  era finita in conflitto' : ''}. Un'approvazione vale una volta sola.`);
    case 'decided':
      return giaDecisa('questa versione era già stata decisa (approvata o\n  scartata), e una richiesta decisa non si riapre.');
    default:
      return `  Il server dice di averla messa in attesa, ma non sono riuscito a\n  controllarlo${r.requestCheck ? ` (${r.requestCheck})` : ''}.\n`
        + '  Se in cima ai Ricevuti della dashboard di gestione non c\'è l\'avviso,\n'
        + '  questa versione era già stata decisa e non si riapre.\n'
        + RIPROPONI;
  }
}

/**
 * Cosa legge l'owner. PURA. Una riga di esito e, quando serve, la riga che
 * dice cosa fare adesso — mai un motivo tecnico lasciato lì da interpretare.
 */
export function messageForOwnerMerge(reply, branch = 'il ramo', ctx = {}) {
  const r = reply || {};
  const num = ctx.feedbackNum || r.localNum;
  const pratica = num ? `#${String(num).replace(/^#+/, '')}` : 'la pratica';
  const chiudi = `npm run feedback -- ${ctx.feedbackId || '<id>'} done "fuso su main" --come-routine`;
  switch (r.outcome) {
    case 'merged': {
      const righe = [`✓ '${branch}' fuso su main dal server${r.sha ? ` (${String(r.sha).slice(0, 8)})` : ''}.`];
      if (r.skippedL5) {
        const blocchi = Array.isArray(r.blocks) ? r.blocks : [];
        righe.push(`  L5 saltato: lavoro locale di ${pratica}, ${r.approvato ? `feedback ${r.daRoutine ? 'di una routine' : 'di un utente'} che hai approvato come lavoro locale` : 'mittente provato'}.`);
        righe.push(blocchi.length
          ? `  Blocchi registrati (${blocchi.length}), li rileggi in Gestione → Automazioni, «Fuse senza chiedere»:\n${blocchi.map((t) => `    · ${bloccoInRiga(t)}`).join('\n')}`
          : '  Nessun blocco registrato: i controlli non avrebbero fermato niente.');
        if (blocchi.length && !r.record) righe.push('  La traccia dei blocchi NON si è registrata: l’elenco resta solo nella nota della pratica e nei log del server.');
      }
      const parti = righeDelleParti(r, pratica, num);
      if (parti.length) righe.push(...parti);
      else if (r.closed === true) righe.push(`  Pratica ${pratica} chiusa.`);
      else if (r.closed === false) righe.push(`  La pratica ${pratica} NON si è chiusa. Chiudila a mano: ${chiudi}`);
      else if (r.localReason) {
        // Il codice è su main ma la pratica resta aperta: una routine potrebbe rilavorarla.
        righe.push(`  Pratica ${pratica} non chiusa: ${r.localDetail || r.localReason}. Se il lavoro la conclude, chiudila a mano: ${chiudi}`);
      }
      return righe.join('\n');
    }
    case 'blocked':
      // Il lavoro locale tocca le aree protette quasi sempre: il messaggio dice
      // perché L5 non è stato saltato e dove si dà il sì. Aspettare il sì è una
      // regola del server, non un muro di questa macchina.
      return `✗ Fusione BLOCCATA dai controlli di sicurezza del server: ${r.reason || 'motivo non riportato'}\n`
        + '  Sono controlli automatici sul contenuto delle modifiche (aree protette,\n'
        + `  dipendenze nuove, segreti).${richiestaForseInAttesa(r) ? ' La fusione aspetta il tuo sì.' : ''}\n`
        + (r.localDetail || r.localReason
          ? `  L5 non è stato saltato: ${r.localDetail || r.localReason}.\n`
          : (ctx.feedbackId ? '' : '  Nessuna pratica collegata: con npm run finish -- --feedback <N> il lavoro locale\n'
            + '  di un feedback tuo o di una sessione con la prova del mittente, o che hai approvato\n'
            + '  come lavoro locale, non aspetta.\n'))
        + `\n${righeDellaRichiesta(r)}`;
    case 'conflict':
      return `✗ Conflitto: main è andato avanti e le modifiche non si incastrano da sole.\n`
        + '  Fai: git pull --rebase origin main, risolvi, e rilancia npm run finish.';
    case 'main_moved':
      return `✗ Main si è mosso a ogni prova degli unit sulla fusione${r.mainSha ? ` (adesso è ${String(r.mainSha).slice(0, 8)})` : ''}: nessuna fusione.
`
        + '  Il server fonde solo sul main su cui gli unit sono girati. Rilancia npm run finish.';
    case 'unit_rossi':
      return `✗ Il server non ha fuso: gli unit sul risultato della fusione erano rossi${r.reason ? ` (${r.reason})` : ''}.
`
        + '  Riallinea il ramo su origin/main, fai tornare verdi gli unit e rilancia npm run finish.';
    case 'stale':
      return `✗ Il ramo è cambiato dopo i controlli${r.headSha ? ` (adesso è ${String(r.headSha).slice(0, 8)})` : ''}.\n`
        + '  Il server fonde solo la versione che è stata controllata: rilancia\n'
        + '  npm run finish, così i controlli girano sul codice di adesso.';
    case 'no_credential':
      return '✗ Il server non ha la credenziale con cui scrive su main.\n'
        + '  Nessuna fusione è avvenuta. Vanno impostati i segreti della GitHub App\n'
        + '  (o il token di ripiego) sulle funzioni di sicurezza.';
    case 'not_deployed':
      return '✗ Il server non espone (ancora) la fusione per le sessioni locali.\n'
        + '  Nessuna fusione è avvenuta: vanno rideployate le funzioni di sicurezza.';
    case 'denied':
      return `✗ Il server non ti ha riconosciuto come proprietario${r.reason ? `: ${r.reason}` : '.'}\n`
        + '  Rigenera le credenziali: node scripts/admin-login.mjs';
    case 'rejected':
      return `✗ Richiesta rifiutata dal server: ${r.reason || 'ramo non fondibile'}`;
    case 'no_owner_credential':
      return '✗ Non trovo le tue credenziali di proprietario su questa macchina.\n'
        + '  Servono per chiedere la fusione al server: node scripts/admin-login.mjs';
    case 'unreachable':
      return `✗ Server non raggiungibile${r.reason ? ` (${r.reason})` : ''}: nessuna fusione è avvenuta.\n`
        + '  Il lavoro è al sicuro sul suo ramo: riprova più tardi.';
    default:
      return `✗ Fusione non riuscita${r.reason ? `: ${r.reason}` : ''}. Nessuna fusione è avvenuta.`;
  }
}

/**
 * L'uscita del processo. PURA. Zero SOLO se il codice è arrivato su main:
 * qualunque altro esito deve fermare chi ha lanciato il comando, anche quando
 * non è colpa di nessuno.
 *
 *   0 fuso · 10 bloccato dai controlli · 20 conflitto o unit rossi sulla fusione · 30 ramo cambiato ·
 *   1 tutto il resto (rifiuti, guasti, server assente)
 */
export function exitCodeForOwnerMerge(reply) {
  switch ((reply || {}).outcome) {
    case 'merged': return 0;
    case 'blocked': return 10;
    case 'conflict': return 20;
    case 'stale': return 30;
    case 'unit_rossi': return 20;
    default: return 1;
  }
}

/**
 * La domanda al server: "fondi questo ramo, che alla mia ultima verifica era
 * questo commit". Ritorna sempre un esito classificato, mai un'eccezione.
 */
export async function askServerMerge({ branch, sha = '', feedbackId = '', pendingParts = [], provaUnit = null, fetchImpl = fetch, url = OWNER_MERGE_URL, listUrl = OWNER_MERGE_APPROVALS_URL } = {}) {
  const refresh = findAdminRefreshToken();
  if (!refresh) return { outcome: 'no_owner_credential' };

  let idToken;
  try {
    idToken = await mintIdToken(refresh);
  } catch (e) {
    return { outcome: 'denied', reason: String((e && e.message) || e).slice(0, 200) };
  }

  const richiesta = () => fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data: {
      branch: String(branch || ''), sha: String(sha || ''),
      ...(feedbackId ? { feedbackId: String(feedbackId) } : {}),
      ...(feedbackId && Array.isArray(pendingParts) && pendingParts.length ? { pendingParts } : {}),
      ...(provaUnit && typeof provaUnit === 'object' ? { provaUnit } : {}),
    } }),
  });
  try {
    let res;
    try {
      res = await richiesta();
    } catch (e) {
      // Dopo minuti di test la connessione tenuta viva può essere già chiusa dall'altra parte (#933): un altro tentativo.
      if (!erroreDiConnessione(e)) throw e;
      res = await richiesta();
    }
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch (_) { body = {}; }
    const reply = classifyOwnerMerge(res.status, body);
    if (reply.outcome !== 'blocked' || !reply.requestId) return reply;
    const stato = await statoDalDeposito({ id: reply.requestId, idToken, fetchImpl, listUrl });
    return Object.assign(reply, { requestState: stato.state },
      stato.outcome ? { requestOutcome: stato.outcome } : {}, stato.motivo ? { requestCheck: stato.motivo } : {});
  } catch (e) {
    return { outcome: 'unreachable', reason: String((e && e.message) || e).slice(0, 200) };
  }
}

/** Lo stato della richiesta riletto dal deposito. Mai un'eccezione: un controllo fallito è `state: ''`. */
async function statoDalDeposito({ id, idToken, fetchImpl, listUrl }) {
  const lettura = () => fetchImpl(listUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data: { op: 'list' } }),
    ...(typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(30000) } : {}),
  });
  try {
    let res;
    try {
      res = await lettura();
    } catch (e) {
      if (!erroreDiConnessione(e)) throw e;
      res = await lettura();
    }
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch (_) { body = {}; }
    if (res.status !== 200) {
      return { state: '', motivo: `elenco delle richieste: ${String((body.error && body.error.message) || `http_${res.status}`).slice(0, 120)}` };
    }
    return statoDellaRichiesta(id, body.result);
  } catch (e) {
    return { state: '', motivo: `elenco delle richieste: ${String((e && e.message) || e).slice(0, 120)}` };
  }
}

/** Un `fetch failed` di una connessione chiusa o rifiutata, non una risposta del server. PURA. */
export function erroreDiConnessione(e) {
  const causa = (e && e.cause) || {};
  const codice = String(causa.code || (e && e.code) || '');
  return /^(ECONNRESET|EPIPE|ECONNREFUSED|ETIMEDOUT|UND_ERR_SOCKET|UND_ERR_CLOSED)$/.test(codice)
    || (e instanceof TypeError && /fetch failed/i.test(String(e.message || '')));
}
