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
//   La porta accanto non è stata murata togliendo la credenziale — quella su
//   questa macchina c'è ancora — ma **su GitHub**: una regola di protezione del
//   repo lascia scrivere su `main` la sola identità del server, e respinge
//   tutto il resto (provato). Quello che è cambiato qui è che non si tenta più:
//   un tentativo respinto in silenzio non è una difesa, è un guasto invisibile.
//
// COSA VIAGGIA
//   Il ramo e lo SHA della sua punta — cioè esattamente il codice su cui i
//   controlli locali sono girati. Se nel frattempo il ramo è cambiato, il
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
    if (r.result === 'merged') return { outcome: 'merged', sha: String(r.sha || '') };
    // Bloccata dai controlli: il server non l'ha respinta e basta, ha aperto
    // una richiesta in attesa. `requestId` vuoto significa che non c'è riuscito
    // (deposito non raggiungibile, oppure server non ancora rideployato): sono
    // due situazioni diverse per chi legge, e vanno dette diverse.
    if (r.result === 'blocked') {
      return { outcome: 'blocked', reason: String(r.reason || ''), requestId: String(r.requestId || '') };
    }
    if (r.result === 'conflict') return { outcome: 'conflict', reason: String(r.reason || '') };
    if (r.result === 'stale') return { outcome: 'stale', headSha: String(r.headSha || '') };
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
 * Cosa legge l'owner. PURA. Una riga di esito e, quando serve, la riga che
 * dice cosa fare adesso — mai un motivo tecnico lasciato lì da interpretare.
 */
export function messageForOwnerMerge(reply, branch = 'il ramo') {
  const r = reply || {};
  switch (r.outcome) {
    case 'merged':
      return `✓ '${branch}' fuso su main dal server${r.sha ? ` (${String(r.sha).slice(0, 8)})` : ''}.`;
    case 'blocked':
      // Il blocco NON è più un vicolo cieco. Il lavoro locale tocca le aree
      // protette quasi sempre (in locale si lavora proprio sulle guardie): un
      // messaggio che si ferma a "decidi tu cosa farne" lascia chi legge senza
      // nessuna mossa possibile — e su main, da qui, non scrive più nessuno.
      // La mossa c'è, ed è una sola: approvarla in Filo, dove serve una persona.
      return `✗ Fusione BLOCCATA dai controlli di sicurezza del server: ${r.reason || 'motivo non riportato'}\n`
        + '  Sono controlli automatici sul contenuto delle modifiche (aree protette,\n'
        + '  dipendenze nuove, segreti), e da qui non si aggirano.\n'
        + (r.requestId
          ? '\n  L\'ho messa IN ATTESA: approvala da Filo, prima schermata (l\'avviso in\n'
            + '  cima alla home), oppure Gestione → Automazioni. Da lì puoi anche scartarla.\n'
            + '  Se Filo è già aperto l\'avviso compare da solo, non serve riaprire niente.\n'
            + '  Vale per il commit appena controllato e per 24 ore: se scade, o se il\n'
            + '  ramo si muove, rilancia npm run finish.'
          : '\n  Non sono riuscito a metterla in attesa: nell\'app non comparirà niente da\n'
            + '  approvare. Riprova, e se non torna vanno rideployate le funzioni di sicurezza.');
    case 'conflict':
      return `✗ Conflitto: main è andato avanti e le modifiche non si incastrano da sole.\n`
        + '  Fai: git pull --rebase origin main, risolvi, e rilancia npm run finish.';
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
 *   0 fuso · 10 bloccato dai controlli · 20 conflitto · 30 ramo cambiato ·
 *   1 tutto il resto (rifiuti, guasti, server assente)
 */
export function exitCodeForOwnerMerge(reply) {
  switch ((reply || {}).outcome) {
    case 'merged': return 0;
    case 'blocked': return 10;
    case 'conflict': return 20;
    case 'stale': return 30;
    default: return 1;
  }
}

/**
 * La domanda al server: "fondi questo ramo, che alla mia ultima verifica era
 * questo commit". Ritorna sempre un esito classificato, mai un'eccezione.
 */
export async function askServerMerge({ branch, sha = '', fetchImpl = fetch, url = OWNER_MERGE_URL } = {}) {
  const refresh = findAdminRefreshToken();
  if (!refresh) return { outcome: 'no_owner_credential' };

  let idToken;
  try {
    idToken = await mintIdToken(refresh);
  } catch (e) {
    return { outcome: 'denied', reason: String((e && e.message) || e).slice(0, 200) };
  }

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ data: { branch: String(branch || ''), sha: String(sha || '') } }),
    });
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch (_) { body = {}; }
    return classifyOwnerMerge(res.status, body);
  } catch (e) {
    return { outcome: 'unreachable', reason: String((e && e.message) || e).slice(0, 200) };
  }
}
