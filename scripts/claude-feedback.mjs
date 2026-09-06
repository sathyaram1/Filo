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
//                                                         [--allega <file>]…
//                                                         [--dry-run]
//
//   `--allega` (ripetibile, al più 5): un documento che viaggia CON il feedback,
//   cifrato per l'owner come il testo. È la strada per una spec o un log che
//   nel testo non entra (tetto ~6000 caratteri): il server la apre con la sua
//   chiave e la consegna ai giudici e alle routine come testo. Ammessi i tipi
//   dell'allowlist del gate L0 (md, txt, log, json, csv, tsv, yaml, pdf,
//   immagini); un tipo diverso è un errore d'uso, non un feedback sospetto.
//   node scripts/claude-feedback.mjs "<titolo>" -          ← testo da stdin
//
// USCITE (distinte apposta: chi lancia lo script deve poter distinguere
// "non l'ho scritto io male" da "il server non c'è")
//   0  fatto           — il feedback è stato depositato
//   1  uso sbagliato   — mancano titolo o testo
//   3  rifiutato       — il server ha detto no (regole, campi, duplicato)
//   4  non raggiungibile — rete assente, timeout, guasto del server

import { readFileSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// Tipo dichiarato per estensione: la stessa allowlist del gate deterministico
// sugli allegati (filo-security, L0 fileGate) e delle storage.rules. Fuori da
// qui il feedback diventerebbe `suspicious_file`: meglio fermarsi prima.
const MIME_PER_ESTENSIONE = Object.freeze({
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', log: 'text/plain',
  json: 'application/json', csv: 'text/csv', tsv: 'text/tab-separated-values',
  yaml: 'application/x-yaml', yml: 'application/x-yaml', pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
});
export const MAX_ALLEGATI = 5;
export const MAX_ALLEGATO_BYTES = 4 * 1024 * 1024; // lo storage rifiuta oltre

/** Il tipo di un allegato dal nome, o '' se non è ammesso. PURA. */
export function mimeDiAllegato(nome) {
  const ext = extname(String(nome || '')).slice(1).toLowerCase();
  return MIME_PER_ESTENSIONE[ext] || '';
}

/**
 * Legge un file da allegare nella forma che `SN_FEEDBACK.submit` si aspetta
 * ({ name, type, dataUrl }). Lancia con un messaggio d'uso se il file manca,
 * è troppo grande o ha un tipo non ammesso.
 */
export function leggiAllegato(percorso) {
  const p = resolve(String(percorso || ''));
  let size;
  try { size = statSync(p).size; } catch (_) { throw new Error(`allegato non trovato: ${percorso}`); }
  const name = basename(p);
  const type = mimeDiAllegato(name);
  if (!type) throw new Error(`allegato di tipo non ammesso: ${name} (ammessi: ${Object.keys(MIME_PER_ESTENSIONE).join(', ')})`);
  if (size > MAX_ALLEGATO_BYTES) throw new Error(`allegato troppo grande: ${name} (max 4 MB)`);
  if (size === 0) throw new Error(`allegato vuoto: ${name}`);
  const b64 = readFileSync(p).toString('base64');
  return { name, type, dataUrl: `data:${type};base64,${b64}` };
}

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
export async function apri({ titolo, testo, url = '', priorita = null, allegati = [], dryRun = false } = {}) {
  const name = String(titolo || '').trim();
  const text = String(testo || '').trim();
  if (!name) return { ok: false, uso: true, motivo: 'titolo mancante' };
  if (!text) return { ok: false, uso: true, motivo: 'testo mancante' };

  if (dryRun) {
    return { ok: true, dryRun: true, id: '', seq: null, clientId: CLIENT_ID, name, priorita, allegati: allegati.length };
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
      // Le immagini vanno nel campo delle immagini, come dall'app: è quello che
      // i giudici guardano (le vedono direttamente). Il resto sono documenti.
      images: (Array.isArray(allegati) ? allegati : []).filter((a) => a.type.startsWith('image/')),
      files: (Array.isArray(allegati) ? allegati : []).filter((a) => !a.type.startsWith('image/')),
    });
  } catch (e) {
    return { ok: false, motivo: String((e && e.message) || e), codice: exitCodeForError(e) };
  }
  // Un allegato che non si è caricato NON è silenzioso: il feedback esiste,
  // ma senza il documento per cui magari è stato aperto. Si riporta.
  const falliti = Array.isArray(res && res.failed) ? res.failed : [];
  const caricati = ((res && res.files) || []).length + ((res && res.images) || []).length;
  return { ok: true, id: res.id, seq: res.seq, clientId: CLIENT_ID, name, allegati: caricati, falliti };
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

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));

function leggiStdin() {
  try { return readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

function uso() {
  console.error('Uso: node scripts/claude-feedback.mjs "<titolo>" "<testo>" [--priorita 1..3] [--url <indirizzo>] [--allega <file>]… [--dry-run]');
  console.error('     "<testo>" può essere "-" per leggerlo da stdin.');
}

export async function main(argv) {
  const flag = (nome) => {
    const i = argv.indexOf(`--${nome}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  if (argv.includes('--help') || argv.includes('-h')) { uso(); return EXIT.FATTO; }
  // Quello che non capisco lo dico, e non apro niente (feedback #565): il
  // controllo sta in un posto solo, scripts/lib/argomenti.mjs.
  const { controllaArgomenti } = await import('./lib/argomenti.mjs');
  const male = controllaArgomenti(argv, {
    opzioni: ['--priorita', '--url', '--allega', '--dry-run'],
    conValore: ['--priorita', '--url', '--allega'],
  });
  if (male) {
    console.error(`RIFIUTATO: ${male}`);
    uso();
    return EXIT.USO;
  }
  const prioritaRaw = flag('priorita');
  const url = flag('url');
  const dryRun = argv.includes('--dry-run');
  // `--allega` è ripetibile: si raccolgono tutti i valori.
  const percorsiAllegati = argv.flatMap((a, i) => (a === '--allega' && argv[i + 1] !== undefined ? [argv[i + 1]] : []));

  const valoriDiFlag = new Set([prioritaRaw, url, ...percorsiAllegati].filter((v) => v !== undefined));
  const posizionali = argv.filter((a) => !a.startsWith('--') && !valoriDiFlag.has(a));
  const titolo = posizionali[0];
  let testo = posizionali.slice(1).join(' ');
  // Solo su "-" esplicito: leggere stdin "quando non è un terminale" fa
  // restare lo strumento appeso ogni volta che lo lancia qualcosa che non è
  // una shell interattiva (un test, uno script) e che stdin non lo chiuderà mai.
  if (testo === '-') testo = leggiStdin();

  const p = parsePriorita(prioritaRaw);
  if (!p.ok) { console.error(`RIFIUTATO: ${p.motivo}`); return EXIT.USO; }

  if (percorsiAllegati.length > MAX_ALLEGATI) {
    console.error(`USO: al più ${MAX_ALLEGATI} allegati`);
    return EXIT.USO;
  }
  let allegati;
  try { allegati = percorsiAllegati.map(leggiAllegato); }
  catch (e) { console.error(`USO: ${e.message}`); return EXIT.USO; }

  const r = await apri({ titolo, testo, url, priorita: p.valore, allegati, dryRun });
  if (!r.ok) {
    console.error(`${r.uso ? 'USO' : 'RIFIUTATO'}: ${r.motivo}`);
    if (r.uso) uso();
    return r.uso ? EXIT.USO : (r.codice || EXIT.RIFIUTATO);
  }
  if (r.dryRun) {
    console.log(`(prova a vuoto) aprirei "${r.name}" come ${r.clientId}${p.valore ? `, priorità ${p.valore}` : ''}${r.allegati ? `, con ${r.allegati} allegati` : ''}.`);
    return EXIT.FATTO;
  }

  // Il numero è quello che l'owner userà per parlarne. Se manca lo si dice:
  // fingere che ci sia manderebbe a cercare un "#" che non esiste.
  console.log(r.seq
    ? `OK: feedback #${r.seq} aperto (${r.id}), mittente ${r.clientId}.`
    : `OK: feedback aperto (${r.id}), mittente ${r.clientId}. Numero non assegnato (la numerazione non ha risposto).`);

  if (r.allegati) console.log(`Allegati caricati: ${r.allegati}.`);
  for (const f of (r.falliti || [])) {
    console.error(`ALLEGATO NON CARICATO: ${f.name} (${f.reason}). Il feedback esiste ma senza questo documento.`);
  }

  if (p.valore) {
    const pr = await applicaPriorita(r.id, p.valore);
    if (pr.ok) console.log(`Priorità ${p.valore} impostata.`);
    else console.log(`Priorità NON impostata (${pr.motivo}): mettila dalla dashboard.`);
  }
  // Un allegato mancante è un rifiuto parziale: chi lancia lo script deve
  // accorgersene, perché il feedback senza il documento può non avere senso.
  return (r.falliti && r.falliti.length) ? EXIT.RIFIUTATO : EXIT.FATTO;
}

if (isMain) {
  process.exit(await main(process.argv.slice(2)));
}
