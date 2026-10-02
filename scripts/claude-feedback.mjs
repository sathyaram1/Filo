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
// COL TOKEN DELL'OWNER, SEMPRE (#595, #908)
//   Si usa la STESSA strada dell'app (`src/shared/feedback.js`), testo cifrato
//   verso l'owner, con la create autenticata che porta `senderProof: 'admin'`:
//   senza quella prova il prefisso `local:` lo può scrivere chiunque. Chi lo
//   lavora si sceglie ogni volta: `--locale` mette il segno `localOnly` (il
//   lavoro di questa sessione: nessuna routine lo prende, e `npm run finish` col
//   suo numero salta L5), `--non-locale` lo apre per le routine. Senza scelta
//   non parte niente. Senza token (o col token rifiutato) non parte niente:
//   da anonimo sarebbe un feedback d'utente. `--priorita` riusa lo stesso token.
//
// USO
//   node scripts/claude-feedback.mjs "<titolo>" "<testo>" --locale|--non-locale
//                                                         [--priorita 0..3]
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
//   3  rifiutato       — il server ha detto no (regole, campi, duplicato), o manca il token admin
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
import './lib/freno-letture.mjs';
import { isRoutineInstance } from './lib/routine-role.mjs';

const THREAD = globalThis.SN_FEEDBACK_THREAD;
const FB = globalThis.SN_FEEDBACK;

/** Il mittente con cui si firma una sessione locale. Fonte unica: shared. */
export const CLIENT_ID = (THREAD && THREAD.LOCAL_CLIENT_ID) || 'local:claude';

// Tipo dichiarato per estensione: la stessa allowlist del gate deterministico
// sugli allegati (filo-security, L0 fileGate) e delle storage.rules. Fuori da
// qui il feedback diventerebbe `suspicious_file`: meglio fermarsi prima.
// ⚠️ Tabella SENZA eredità, per lo stesso motivo di `PREFISSI_ALLEGATO` in
// src/shared/feedback.js (#582, giro 7): la chiave è l'estensione di un nome di
// file, e una tabella normale contiene già `__proto__` e `constructor` senza che
// nessuno ce li abbia messi. Un file chiamato `note.__proto__` si faceva
// dichiarare un tipo che non è una stringa, e partiva verso il deposito con
// `data:[object Object]` al posto del tipo, invece di essere respinto qui.
const MIME_PER_ESTENSIONE = Object.freeze(Object.assign(Object.create(null), {
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', log: 'text/plain',
  json: 'application/json', csv: 'text/csv', tsv: 'text/tab-separated-values',
  yaml: 'application/x-yaml', yml: 'application/x-yaml', pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
}));
export const MAX_ALLEGATI = 5;
export const MAX_ALLEGATO_BYTES = 4 * 1024 * 1024; // lo storage rifiuta oltre

/** Il tipo di un allegato dal nome, o '' se non è ammesso. PURA. */
export function mimeDiAllegato(nome) {
  const ext = extname(String(nome || '')).slice(1).toLowerCase();
  const tipo = MIME_PER_ESTENSIONE[ext];
  // `typeof === 'string'` e non `|| ''`: da qui esce il tipo che finisce nel
  // `data:` dell'allegato e poi nella richiesta al deposito. Quello che non è
  // una stringa non è un tipo, ed è un allegato da rifiutare.
  return typeof tipo === 'string' ? tipo : '';
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
  // #602 — la cifratura che non si può fare è un NO definitivo, non una rete
  // caduta: riprovare non cambia niente finché la copia dell'app resta com'è.
  // Senza questa riga cadeva nel ramo "riprova" qui sotto, e chi lancia lo
  // script a ripetizione ci sarebbe rimasto dentro.
  if (err && err.cifratura === true) return EXIT.RIFIUTATO;
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
 * La scala è 3/2/1/0 (lo 0 è un gradino della scala, non «nessuna»: assente
 * = non impostata). Qualunque altra cosa è un errore d'uso: meglio fermarsi
 * che scrivere una priorità inventata.
 * @returns {{ ok: true, valore: number|null } | { ok: false, motivo: string }}
 */
export const PRIORITA_AMMESSE = Object.freeze([0, 1, 2, 3]);
export function parsePriorita(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, valore: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || !PRIORITA_AMMESSE.includes(n)) {
    return { ok: false, motivo: `priorità "${raw}" non valida: ammessi ${PRIORITA_AMMESSE.join(', ')}` };
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
export async function apri({ titolo, testo, url = '', priorita = null, allegati = [], dryRun = false, idToken = '', locale = true } = {}) {
  const name = String(titolo || '').trim();
  const text = String(testo || '').trim();
  if (!name) return { ok: false, uso: true, motivo: 'titolo mancante' };
  if (!text) return { ok: false, uso: true, motivo: 'testo mancante' };

  if (dryRun) {
    return { ok: true, dryRun: true, id: '', seq: null, clientId: CLIENT_ID, name, priorita, allegati: allegati.length, locale };
  }
  if (!idToken) {
    return { ok: false, codice: EXIT.RIFIUTATO, motivo: 'manca il token admin: senza la prova del mittente il feedback sarebbe di un utente. Rigenera le credenziali: node scripts/admin-login.mjs' };
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
    }, { idToken, soloAdmin: true, ...(locale ? { localOnly: { by: CLIENT_ID, at: Date.now() } } : {}) });
  } catch (e) {
    return { ok: false, motivo: String((e && e.message) || e), codice: exitCodeForError(e) };
  }
  // Un allegato che non si è caricato NON è silenzioso: il feedback esiste,
  // ma senza il documento per cui magari è stato aperto. Si riporta.
  const falliti = Array.isArray(res && res.failed) ? res.failed : [];
  const caricati = ((res && res.files) || []).length + ((res && res.images) || []).length;
  return {
    ok: true, id: res.id, seq: res.seq, clientId: CLIENT_ID, name, allegati: caricati, falliti,
    senderProof: (res && res.senderProof) || '', locale: !!(res && res.localOnly),
  };
}

/**
 * Il token admin dell'owner: { idToken } oppure { idToken: '', motivo }.
 * Oggetto e non funzione perché i test lo sostituiscono: il vero va in rete.
 */
export const credenziale = {
  async ottieni() {
    const { findAdminRefreshToken, mintIdToken } = await import('./lib/firestore-auth.mjs');
    const rt = findAdminRefreshToken();
    if (!rt) return { idToken: '', motivo: 'nessuna credenziale admin su questa macchina' };
    try {
      return { idToken: await mintIdToken(rt) };
    } catch (e) {
      return { idToken: '', motivo: String((e && e.message) || e) };
    }
  },
};

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
export async function applicaPriorita(id, valore, idTokenGiaPreso = '') {
  let idToken = idTokenGiaPreso;
  if (!idToken) {
    const c = await credenziale.ottieni();
    if (!c.idToken) return { ok: false, motivo: c.motivo };
    idToken = c.idToken;
  }
  try {
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

const SENZA_SCELTA = [
  'RIFIUTATO: manca chi lo lavora, e non ho aperto niente. Rilancia con una delle due:',
  '  --non-locale  una segnalazione per le routine (un problema da mettere in coda);',
  '  --locale      il lavoro di questa sessione: nessuna routine lo prende, e la chiusura col suo numero salta L5.',
].join('\n');

// #914: da qui il feedback nasce dell'owner (prova admin) e salta i giudici; una routine apre i suoi dal canale,
// che li firma col biglietto, e non apre mai lavoro locale.
const IN_ROUTINE = [
  'RIFIUTATO: sei una routine, e da qui non apro niente: un feedback nato qui salterebbe i giudici come uno dell\'owner.',
  '  Un ritrovamento: node scripts/routine-channel.mjs deliver feedback --name "…" --text "…"',
  '  Un lavoro che si fa solo in locale: node scripts/routine-channel.mjs deliver status --status design --reason locale --notes "perché"',
].join('\n');

/** Siamo dentro una routine? Oggetto e non funzione, come `credenziale`, perché i test lo sostituiscono. */
export const ambiente = {
  routine() { return isRoutineInstance(resolve(fileURLToPath(import.meta.url), '..', '..')); },
};

function uso() {
  console.error('Uso: node scripts/claude-feedback.mjs "<titolo>" "<testo>" --locale|--non-locale [--priorita 0..3] [--url <indirizzo>] [--allega <file>]… [--dry-run]');
  console.error('     --non-locale lo apre per le routine; --locale è il lavoro di questa sessione, e nessuna routine lo prende.');
  console.error('     "<testo>" può essere "-" per leggerlo da stdin.');
  console.error('     Da npm, opzione e valore attaccati: npm run feedback:apri -- "t" "x" --allega=spec.md');
}

export async function main(argvIn) {
  let argv = Array.isArray(argvIn) ? [...argvIn] : [];
  const flag = (nome) => {
    const i = argv.indexOf(`--${nome}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  if (argv.includes('--help') || argv.includes('-h')) { uso(); return EXIT.FATTO; }
  if (ambiente.routine()) { console.error(IN_ROUTINE); return EXIT.RIFIUTATO; }
  // Quello che non capisco lo dico, e non apro niente (feedback #565): il
  // controllo sta in un posto solo, scripts/lib/argomenti.mjs. Le opzioni che
  // npm si è mangiato le riprendiamo dall'ambiente invece di rifiutare una
  // riga che chi l'ha scritta considera giusta.
  const { controllaArgomenti, argomentiDaNpm, espandiUguali, opzioneStorpiata } = await import('./lib/argomenti.mjs');
  const OPZ = {
    opzioni: ['--priorita', '--url', '--allega', '--locale', '--non-locale', '--dry-run'],
    conValore: ['--priorita', '--url', '--allega'],
  };
  argv = espandiUguali(argv, OPZ.conValore);
  const storpiata = opzioneStorpiata(process.env, OPZ.opzioni);
  if (storpiata) {
    console.error(`RIFIUTATO: ${storpiata}`);
    uso();
    return EXIT.USO;
  }
  const daNpm = argomentiDaNpm(process.env, OPZ);
  if (daNpm.errore) {
    console.error(`RIFIUTATO: ${daNpm.errore}`);
    uso();
    return EXIT.USO;
  }
  if (daNpm.nota) { console.error(daNpm.nota); argv = [...argv, ...daNpm.args]; }
  const male = controllaArgomenti(argv, OPZ);
  if (male) {
    console.error(`RIFIUTATO: ${male}`);
    uso();
    return EXIT.USO;
  }
  // Chi lo lavora si dice sempre: senza scelta, una segnalazione per le routine nasceva lavoro locale e non la
  // prendeva nessuno (verifica di #908, giro 6). Un errore d'uso costa una riga; un feedback perso no.
  const locale = argv.includes('--locale');
  if (locale === argv.includes('--non-locale')) {
    console.error(locale ? 'RIFIUTATO: --locale e --non-locale insieme: scegline uno. Non ho aperto niente.' : SENZA_SCELTA);
    uso();
    return EXIT.USO;
  }
  const prioritaRaw = flag('priorita');
  const url = flag('url');
  const dryRun = argv.includes('--dry-run');
  // `--allega` è ripetibile: si raccolgono tutti i valori.
  const percorsiAllegati = argv.flatMap((a, i) => (a === '--allega' && argv[i + 1] !== undefined ? [argv[i + 1]] : []));

  // I posizionali si contano per POSTO, non per valore: prima si toglievano le
  // parole «uguali al valore di un'opzione», e una parola del testo scritta
  // identica all'indirizzo passato spariva dal corpo senza dire niente — un
  // taglio muto sul testo di chi segnala (feedback #565).
  const CON_VALORE = new Set(['--priorita', '--url', '--allega']);
  const posizionali = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) { if (CON_VALORE.has(a)) i += 1; continue; }
    posizionali.push(a);
  }
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

  // La credenziale si chiede solo quando c'è davvero qualcosa da depositare:
  // un errore d'uso o una prova a vuoto non toccano la rete.
  const deposita = !dryRun && Boolean(String(titolo || '').trim() && String(testo || '').trim());
  const cred = deposita ? await credenziale.ottieni() : { idToken: '' };
  if (deposita && !cred.idToken) {
    console.error(`RIFIUTATO: ${cred.motivo || 'nessun token admin'}. Senza la prova del mittente non apro niente: node scripts/admin-login.mjs`);
    return EXIT.RIFIUTATO;
  }
  const r = await apri({ titolo, testo, url, priorita: p.valore, allegati, dryRun, idToken: cred.idToken, locale });
  if (!r.ok) {
    console.error(`${r.uso ? 'USO' : 'RIFIUTATO'}: ${r.motivo}`);
    if (r.uso) uso();
    return r.uso ? EXIT.USO : (r.codice || EXIT.RIFIUTATO);
  }
  if (r.dryRun) {
    console.log(`(prova a vuoto) aprirei "${r.name}" come ${r.clientId}, ${locale ? 'lavoro locale' : 'per le routine'}${p.valore != null ? `, priorità ${p.valore}` : ''}${r.allegati ? `, con ${r.allegati} allegati` : ''}.`);
    return EXIT.FATTO;
  }

  // Il numero è quello che l'owner userà per parlarne. Se manca lo si dice:
  // fingere che ci sia manderebbe a cercare un "#" che non esiste.
  console.log(r.seq
    ? `OK: feedback #${r.seq} aperto (${r.id}), mittente ${r.clientId}.`
    : `OK: feedback aperto (${r.id}), mittente ${r.clientId}. Numero non assegnato (la numerazione non ha risposto).`);
  console.log(locale
    ? `Lavoro locale: nessuna routine lo prende. Legalo al ramo con verify-local start --feedback ${r.seq || r.id} (o npm run finish -- --feedback ${r.seq || r.id}).`
    : 'Aperto per le routine.');

  if (r.allegati) console.log(`Allegati caricati: ${r.allegati}.`);
  for (const f of (r.falliti || [])) {
    console.error(`ALLEGATO NON CARICATO: ${f.name} (${f.reason}). Il feedback esiste ma senza questo documento.`);
  }

  // `!= null`, non un controllo di verità: lo 0 è una priorità da scrivere.
  if (p.valore != null) {
    const pr = await applicaPriorita(r.id, p.valore, cred.idToken);
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
