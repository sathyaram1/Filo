// claude-feedback.mjs — APRIRE un feedback da una sessione locale di Claude.
//
// PERCHÉ ESISTE
//   In locale owner e Claude trovano problemi che vanno messi in coda come
//   qualunque altro lavoro. Prima da qui non c'era modo di aprirne uno:
//   `owner-feedback.mjs` aggiorna solo feedback che esistono già, e depositarne
//   uno passando dall'app lo avrebbe fatto arrivare come un utente anonimo
//   qualunque — perdendo la PROVENIENZA, che è l'informazione per cui i
//   mittenti sono stati separati (agente esploratore, automazioni in cloud,
//   rilievi residui).
//
//   Qui il feedback nasce firmato `local:claude`: "Claude che lavora sulla
//   macchina dell'owner". In dashboard si legge come categoria propria — né
//   esploratore né automazione cloud — perché il contesto in cui nasce è
//   diverso da entrambi.
//
// NESSUNA CREDENZIALE DELL'OWNER
//   Si usa la STESSA strada dell'app (`src/shared/feedback.js`): creazione
//   anonima con la chiave pubblica di Firebase, testo cifrato verso l'owner.
//   Così questo strumento funziona anche su una copia del repo senza token
//   admin, e soprattutto non c'è nessuna credenziale in più da tenere qui.
//   L'unica eccezione è `--priorita`, che le regole non concedono a un mittente
//   anonimo: quella, se richiesta, si applica dopo con le credenziali
//   dell'owner se ci sono, e se non ci sono si dice e basta (il feedback è già
//   depositato).
//
// USO
//   node scripts/claude-feedback.mjs "<titolo>" "<testo>" [--priorita 1..3]
//                                                         [--url <indirizzo>]
//                                                         [--dry-run]
//   node scripts/claude-feedback.mjs "<titolo>" -          ← testo da stdin
//
// USCITE (distinte apposta: chi lancia lo script deve poter distinguere
// "non l'ho scritto io male" da "il server non c'è")
//   0  fatto           — il feedback è stato depositato
//   1  uso sbagliato   — mancano titolo o testo
//   3  rifiutato       — il server ha detto no (regole, campi, duplicato)
//   4  non raggiungibile — rete assente, timeout, guasto del server

import { readFileSync } from 'node:fs';
// Moduli IIFE: importarli li registra su globalThis.
import '../src/shared/feedbackThread.js';
// La PUBBLICA va caricata PRIMA della cifratura, come in owner-feedback.mjs:
// senza, il gate risulta spento e il testo verrebbe scritto IN CHIARO su un
// documento a lettura pubblica.
import '../src/shared/feedbackPublicKey.js';
import '../src/shared/feedbackCrypto.js';
import '../src/shared/feedbackClientIdHash.js';
import '../src/shared/feedback.js';
import '../src/shared/feedbackStatus.js';

const THREAD = globalThis.SN_FEEDBACK_THREAD;
const FB = globalThis.SN_FEEDBACK;

/** Il mittente con cui si firma una sessione locale. Fonte unica: shared. */
export const CLIENT_ID = (THREAD && THREAD.LOCAL_CLIENT_ID) || 'local:claude';

export const EXIT = Object.freeze({
  FATTO: 0,
  USO: 1,
  RIFIUTATO: 3,
  IRRAGGIUNGIBILE: 4,
});

/**
 * Un guasto di RETE o un errore del SERVER, o un rifiuto?
 *
 * PURA. È la distinzione che rende utili i codici d'uscita: se il feedback è
 * stato rifiutato, riprovare identico non serve a niente; se il server non si
 * raggiungeva, riprovare è esattamente la cosa giusta. Confonderli significa
 * far ritentare all'infinito un testo che non passerà mai, o far buttare via
 * un ritrovamento per una connessione caduta.
 *
 * @param {Error|string} err
 * @returns {number} uno di EXIT.RIFIUTATO | EXIT.IRRAGGIUNGIBILE
 */
export function exitCodeForError(err) {
  const msg = String((err && err.message) || err || '');
  // Rifiuto esplicito del server: le regole non hanno accettato il documento
  // (403), il documento era malformato (400) o esisteva già (409).
  if (/\((400|401|403|404|409|422)\)/.test(msg)) return EXIT.RIFIUTATO;
  // Sovraccarico o guasto del server: è la stessa famiglia di "riprova".
  if (/\((408|429|5\d\d)\)/.test(msg)) return EXIT.IRRAGGIUNGIBILE;
  // Rete: fetch fallita, DNS, timeout, socket chiusa.
  return EXIT.IRRAGGIUNGIBILE;
}

/**
 * Priorità richiesta dalla riga di comando. PURA.
 * Ammessi 1, 2, 3 (0 = nessuna, come nel resto del sistema). Qualunque altra
 * cosa è un errore d'uso: meglio fermarsi che scrivere una priorità inventata.
 * @returns {{ ok: true, valore: number|null } | { ok: false, motivo: string }}
 */
export function parsePriorita(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, valore: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 3) {
    return { ok: false, motivo: `priorità "${raw}" non valida: ammessi 1, 2, 3` };
  }
  return { ok: true, valore: n };
}

/**
 * Deposita il feedback. Ritorna { ok, id, seq } oppure { ok:false, ... }.
 *
 * `seq` è il numero leggibile (#N): è best-effort già nell'app (se la query di
 * numerazione non risponde il feedback parte lo stesso, senza numero), quindi
 * qui può tornare null senza che sia un errore.
 */
export async function apri({ titolo, testo, url = '', priorita = null, dryRun = false } = {}) {
  const name = String(titolo || '').trim();
  const text = String(testo || '').trim();
  if (!name) return { ok: false, uso: true, motivo: 'titolo mancante' };
  if (!text) return { ok: false, uso: true, motivo: 'testo mancante' };

  if (dryRun) {
    return { ok: true, dryRun: true, id: '', seq: null, clientId: CLIENT_ID, name, priorita };
  }

  let res;
  try {
    res = await FB.submit({
      text,
      url: String(url || ''),
      // `name` è il titolo breve: nell'app lo genera un modello, qui lo scrive
      // chi apre il feedback (che il problema ce l'ha davanti).
      name: name.slice(0, 200),
      title: '',
      userAgent: `filo-locale/${process.platform} node-${process.versions.node}`,
      clientId: CLIENT_ID,
    });
  } catch (e) {
    return { ok: false, motivo: String((e && e.message) || e), codice: exitCodeForError(e) };
  }
  return { ok: true, id: res.id, seq: res.seq, clientId: CLIENT_ID, name };
}

/**
 * Priorità: le regole non la concedono a un mittente anonimo (vedi il ramo
 * `create` di firestore.rules), quindi si scrive DOPO, con le credenziali
 * dell'owner. È l'unico pezzo che ne ha bisogno: se qui non ci sono, il
 * feedback resta depositato e lo si dice — meglio di un feedback non aperto.
 *
 * Si scrive anche `priorityManual`, altrimenti il giudice di priorità del
 * server la sovrascrive appena passa: una priorità che sparisce da sola è
 * peggio di una non impostata.
 */
export async function applicaPriorita(id, valore) {
  const { findAdminRefreshToken, mintIdToken } = await import('./lib/firestore-auth.mjs');
  const rt = findAdminRefreshToken();
  if (!rt) return { ok: false, motivo: 'nessuna credenziale admin su questa macchina' };
  try {
    const idToken = await mintIdToken(rt);
    await FB.updateStatus(id, { priority: valore, priorityManual: true }, { idToken });
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: String((e && e.message) || e) };
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const isMain = process.argv[1]
  && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href.replace(/^file:\/\/(?=[A-Za-z]:)/, 'file:///');

function leggiStdin() {
  try { return readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

function uso() {
  console.error('Uso: node scripts/claude-feedback.mjs "<titolo>" "<testo>" [--priorita 1..3] [--url <indirizzo>] [--dry-run]');
  console.error('     "<testo>" può essere "-" per leggerlo da stdin.');
}

export async function main(argv) {
  const flag = (nome) => {
    const i = argv.indexOf(`--${nome}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const prioritaRaw = flag('priorita');
  const url = flag('url');
  const dryRun = argv.includes('--dry-run');

  const valoriDiFlag = new Set([prioritaRaw, url].filter((v) => v !== undefined));
  const posizionali = argv.filter((a) => !a.startsWith('--') && !valoriDiFlag.has(a));
  const titolo = posizionali[0];
  let testo = posizionali.slice(1).join(' ');
  if (testo === '-' || (!testo && !process.stdin.isTTY)) testo = leggiStdin();

  const p = parsePriorita(prioritaRaw);
  if (!p.ok) { console.error(`RIFIUTATO: ${p.motivo}`); return EXIT.USO; }

  const r = await apri({ titolo, testo, url, priorita: p.valore, dryRun });
  if (!r.ok) {
    console.error(`${r.uso ? 'USO' : 'RIFIUTATO'}: ${r.motivo}`);
    if (r.uso) uso();
    return r.uso ? EXIT.USO : (r.codice || EXIT.RIFIUTATO);
  }
  if (r.dryRun) {
    console.log(`(prova a vuoto) aprirei "${r.name}" come ${r.clientId}${p.valore ? `, priorità ${p.valore}` : ''}.`);
    return EXIT.FATTO;
  }

  // Il numero è quello che l'owner userà per parlarne. Se manca lo si dice:
  // fingere che ci sia manderebbe a cercare un "#" che non esiste.
  console.log(r.seq
    ? `OK: feedback #${r.seq} aperto (${r.id}), mittente ${r.clientId}.`
    : `OK: feedback aperto (${r.id}), mittente ${r.clientId}. Numero non assegnato (la numerazione non ha risposto).`);

  if (p.valore) {
    const pr = await applicaPriorita(r.id, p.valore);
    if (pr.ok) console.log(`Priorità ${p.valore} impostata.`);
    else console.log(`Priorità NON impostata (${pr.motivo}): mettila dalla dashboard.`);
  }
  return EXIT.FATTO;
}

if (isMain) {
  process.exit(await main(process.argv.slice(2)));
}
