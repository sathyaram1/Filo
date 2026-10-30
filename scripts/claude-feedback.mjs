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
//   senza quella prova il prefisso `local:` lo può scrivere chiunque. Porta l'impronta del biglietto della sessione
//   (`bigliettoLocale`, #1148): la fiducia la decide il server da lì, e senza biglietto nasce non fidato. Chi lo
//   lavora si sceglie ogni volta: `--locale` mette il segno `localOnly` (il
//   lavoro di questa sessione: nessuna routine lo prende), `--non-locale` lo apre per le routine. Fidati,
//   tutti e due saltano i giudici e vanno In coda, il primo con l'etichetta «server». Una routine non lo usa. Senza scelta
//   non parte niente. Senza token (o col token rifiutato) non parte niente:
//   da anonimo sarebbe un feedback d'utente. `--priorita` nasce col documento.
//
// USO
//   node scripts/claude-feedback.mjs "<titolo>" "<testo>" --locale|--non-locale
//                                                         [--priorita 0..3]
//                                                         [--url <indirizzo>]
//                                                         [--allega <file>]…
//                                                         [--aspetta 676,663.2]
//                                                         [--pacchetto 812,815]
//                                                         [--dry-run]
//
//   `--allega` (ripetibile, al più 5): un documento che viaggia CON il feedback,
//   cifrato per l'owner come il testo. È la strada per una spec o un log che
//   nel testo non entra (tetto ~6000 caratteri): il server la apre con la sua
//   chiave e la consegna ai giudici e alle routine come testo. Ammessi i tipi
//   dell'allowlist del cancello degli allegati (md, txt, log, json, csv, tsv, yaml, pdf,
//   immagini); un tipo diverso è un errore d'uso, non un feedback sospetto.
//   node scripts/claude-feedback.mjs "<titolo>" -          ← testo da stdin
//
//   `--aspetta` (#903): nasce aspettando quei feedback; nessuna routine lo prende finché non sono tutti fusi.
//   Numeri inesistenti e più di venti si rifiutano prima di aprire.
//
//   `--pacchetto` (FEEDBACK-STATES.md § 3a, Pacchetti): il feedback è un pacchetto che unisce quelle segnalazioni, e il
//   testo è la spec. Porta con sé i loro allegati (tutti, o non nasce) e alla nascita le archivia; chi le aspettava
//   aspetta il pacchetto. Si controllano prima di aprire: in coda e non ancora lavorate, non a priorità 3, non lavoro locale.
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
import { PRIORITA_AMMESSE, parsePriorita } from './lib/priorita.mjs';
import { trovaBiglietto } from './lib/biglietto-locale.mjs';
// Moduli IIFE: importarli li registra su globalThis.
import '../src/shared/feedbackThread.js';
// La PUBBLICA va caricata PRIMA della cifratura, come in owner-feedback.mjs:
// senza, il gate risulta spento e il testo verrebbe scritto IN CHIARO su un
// documento a lettura pubblica.
import '../src/shared/feedbackPublicKey.js';
import '../src/shared/feedbackCrypto.js';
import '../src/shared/feedbackClientIdHash.js';
import '../src/shared/feedback.js';
import '../src/shared/feedbackAttachTypes.js';
import '../src/shared/feedbackImage.js';
import '../src/shared/feedbackStatus.js';
import '../src/shared/feedbackAttese.js';
import './lib/freno-letture.mjs';
import { risolviFeedback } from './lib/pratica-locale.mjs';
import { isRoutineInstance } from './lib/routine-role.mjs';

const THREAD = globalThis.SN_FEEDBACK_THREAD;
const FB = globalThis.SN_FEEDBACK;

/** Il mittente con cui si firma una sessione locale. Fonte unica: shared. */
export const CLIENT_ID = (THREAD && THREAD.LOCAL_CLIENT_ID) || 'local:claude';

// Tipo dichiarato per estensione; se ammetterlo lo decide `SN_FEEDBACK_ATTACH.classify`, l'elenco
// unico del riquadro e della pagina dei feedback, a cui resta allineato il cancello degli allegati del server
// (filo-security, cancelloAllegati). Fuori da lì il feedback diventerebbe `suspicious_file`.
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
  if (typeof tipo !== 'string') return '';
  const ATTACH = globalThis.SN_FEEDBACK_ATTACH;
  return ATTACH && ATTACH.classify({ name: String(nome || ''), type: tipo }) ? tipo : '';
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

// La regola della priorità a riga di comando è una sola, condivisa con owner-feedback (--priorita).
export { PRIORITA_AMMESSE, parsePriorita };

/**
 * Deposita il feedback. Ritorna { ok, id, seq } oppure { ok:false, ... }.
 *
 * `seq` è il numero leggibile (#N): è best-effort già nell'app (se la query di
 * numerazione non risponde il feedback parte lo stesso, senza numero), quindi
 * qui può tornare null senza che sia un errore.
 */
export async function apri({ titolo, testo, url = '', priorita = null, allegati = [], dryRun = false, idToken = '', locale = true, biglietto = null, attese = [], unisce = [] } = {}) {
  const name = String(titolo || '').trim();
  const text = String(testo || '').trim();
  if (!name) return { ok: false, uso: true, motivo: 'titolo mancante' };
  if (!text) return { ok: false, uso: true, motivo: 'testo mancante' };

  if (dryRun) {
    return { ok: true, dryRun: true, id: '', seq: null, clientId: CLIENT_ID, name, priorita, allegati: allegati.length, locale, attese, unisce };
  }
  if (!idToken) {
    return { ok: false, codice: EXIT.RIFIUTATO, motivo: 'manca il token admin: senza la prova del mittente il feedback sarebbe di un utente. Rigenera le credenziali: node scripts/admin-login.mjs' };
  }

  // Il biglietto della sessione; senza, o col server giù, il feedback nasce non fidato.
  const b = biglietto || await trovaBiglietto().catch(() => null);
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
    }, {
      idToken, soloAdmin: true,
      // Nasce col documento: il server alla nascita la vede e non la fa decidere al giudice (#914).
      ...(Number.isInteger(priorita) ? { priority: priorita } : {}),
      ...(locale ? { localOnly: { by: CLIENT_ID, at: Date.now() } } : {}),
      ...(Array.isArray(attese) && attese.length ? { waitsFor: attese } : {}),
      // Un pacchetto porta tutti gli allegati delle unite o non nasce: un caricamento mancato ferma prima del documento.
      ...(Array.isArray(unisce) && unisce.length ? { unisce: unisce.map(({ id, num }) => ({ id, num })), interi: true } : {}),
      // Uno sporco rimasto solo in locale il server non lo vede: senza biglietto il feedback nasce non fidato.
      ...(b && b.fp && !b.inAttesa ? { bigliettoLocale: b.fp } : {}),
    });
  } catch (e) {
    const motivo = String((e && e.message) || e);
    return { ok: false, motivo: e && e.allegatiFalliti ? `${motivo}. Il pacchetto non è nato: rilancia` : motivo, codice: exitCodeForError(e) };
  }
  // Un allegato che non si è caricato NON è silenzioso: il feedback esiste,
  // ma senza il documento per cui magari è stato aperto. Si riporta.
  const falliti = Array.isArray(res && res.failed) ? res.failed : [];
  const caricati = ((res && res.files) || []).length + ((res && res.images) || []).length;
  return {
    ok: true, id: res.id, seq: res.seq, clientId: CLIENT_ID, name, allegati: caricati, falliti,
    senderProof: (res && res.senderProof) || '', locale: !!(res && res.localOnly), attese, unisce,
    priorita: Number.isInteger(priorita) && res && res.senderProof === 'admin' ? priorita : null,
    biglietto: b && b.fp ? (b.fiducia === 'fidato' ? 'pulito' : 'sporco') : 'assente',
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
 * I numeri di `--aspetta` → [{ id, num }], con le regole di Gestione (SN_FB_ATTESE.valida): un feedback che nasce non
 * può aspettare sé stesso né chiudere un giro, quindi restano i numeri inesistenti e il tetto. Oggetto: i test lo sostituiscono.
 */
export const attese = {
  async risolvi(testo, idToken) {
    const ATT = globalThis.SN_FB_ATTESE;
    const letti = ATT.leggiNumeri(testo);
    if (!letti.ok || !letti.numeri.length) return letti.ok ? { ok: true, attese: [] } : letti;
    const { FIRESTORE_BASE } = await import('./lib/firestore-auth.mjs');
    return ATT.valida({
      id: '', numeri: letti.numeri,
      risolvi: async (n) => {
        const r = await risolviFeedback(n, { bearer: idToken, base: FIRESTORE_BASE });
        if (r.ok) return r.id;
        if (/^nessun feedback/.test(r.motivo)) return null;
        throw new Error(r.motivo);
      },
      leggiAttese: async () => new Map(),
    });
  },
};

/**
 * Le segnalazioni lette per `--pacchetto` → i motivi per cui non entrano (vuoto = entrano tutte). PURA.
 * `lette`: [{ ok, num, stato, priorita, locale, attese, ramo?, motivo? }]; `aspetta`: i numeri che il pacchetto stesso
 * aspetta; `pacchetti`: i numeri dei pacchetti aperti fra gli aspettati dalle unite.
 */
export function controllaUnite(lette, { aspetta = [], pacchetti = [] } = {}) {
  const giaPacchetti = new Set(pacchetti.map((n) => String(n).replace(/^#/, '')));
  const MAX = globalThis.SN_FB_ATTESE.MAX;
  const motivi = [];
  for (const u of Array.isArray(lette) ? lette : []) {
    const n = `#${u.num}`;
    if (!u.ok) { motivi.push(`${n}: ${u.motivo}`); continue; }
    if (!u.stato) motivi.push(`${n}: lo stato non si legge (manca la chiave privata?), e senza non so se è già in lavorazione`);
    else if (u.stato !== 'todo') motivi.push(`${n} è «${u.stato}»: nel pacchetto vanno solo segnalazioni in coda e non ancora lavorate`);
    // In coda non vuol dire mai lavorata: dopo una risposta dell'owner o una riapertura il ramo resta.
    else if (u.ramo) motivi.push(`${n} ha già un ramo con lavoro (${u.ramo}): nel pacchetto si rifarebbe da capo`);
    const dentro = (u.attese || []).map((w) => String(w.num || '').replace(/^#/, '')).filter((x) => giaPacchetti.has(x));
    if (dentro.length) motivi.push(`${n} è già nel pacchetto ${dentro.map((x) => `#${x}`).join(', ')}: due pacchetti farebbero lo stesso lavoro`);
    if (u.priorita === 3) motivi.push(`${n} ha priorità 3: si lavora subito e da sola, fuori dai pacchetti`);
    if (u.locale) motivi.push(`${n} è un lavoro locale: nessuna routine la prende, e nel pacchetto resterebbe ferma`);
    if ((u.attese || []).length >= MAX) motivi.push(`${n} aspetta già ${MAX} feedback: un'attesa in più non ci sta`);
    if (aspetta.includes(String(u.num))) motivi.push(`${n} è anche fra quelli che il pacchetto aspetta: si aspetterebbero a vicenda`);
  }
  return motivi;
}

/** La priorità del pacchetto senza `--priorita`: la più alta fra le unite, perché nessuna scenda aspettandolo. PURA. */
export function prioritaDelPacchetto(scelta, lette) {
  if (Number.isInteger(scelta)) return scelta;
  const note = (Array.isArray(lette) ? lette : []).map((u) => u && u.priorita).filter(Number.isInteger);
  return note.length ? Math.max(...note) : null;
}

// Lo stesso tetto di un feedback: le regole (immaginiValide, documentiValidi) e submit ne tengono 5 per tipo.
export const TETTO_PER_TIPO = 5;

/** La nota con cui una segnalazione unita si archivia alla nascita del pacchetto. PURA. */
export function notaUnita(numPacchetto) {
  return `Unito nel pacchetto #${numPacchetto}: il lavoro continua lì`;
}

/**
 * I riferimenti agli allegati di una unita, dai campi grezzi e dalla conversazione in chiaro: prima quelli della
 * segnalazione, poi quelli dei commenti. PURA. → [{ tipo: 'immagine'|'documento', nome, type, url, conversazione, indice }]
 */
export function riferimentiAllegati(fields, conversazione = '') {
  const valori = (k) => (fields && fields[k] && fields[k].arrayValue && fields[k].arrayValue.values) || [];
  const str = (v) => (v && typeof v.stringValue === 'string' ? v.stringValue : '');
  const immagini = valori('images').map((v) => ({ url: str(v) || str(v && v.mapValue && v.mapValue.fields && v.mapValue.fields.url), conversazione: false }));
  const documenti = valori('files').map((v) => {
    const m = (v && v.mapValue && v.mapValue.fields) || {};
    return { url: str(m.url), nome: str(m.name), type: str(m.type), conversazione: false };
  });
  for (const a of String(conversazione || '').split('\n').map((r) => THREAD.parseAttachmentLine(r)).filter(Boolean)) {
    if (a.kind === 'file') documenti.push({ url: a.url, nome: a.name, type: a.type, conversazione: true });
    else immagini.push({ url: a.url, conversazione: true });
  }
  const conIndice = (lista, tipo) => lista.filter((a) => a.url).map((a, i) => ({ tipo, nome: a.nome || '', type: a.type || '', url: a.url, conversazione: a.conversazione, indice: i + 1 }));
  return [...conIndice(immagini, 'immagine'), ...conIndice(documenti, 'documento')];
}

/**
 * Gli allegati delle unite ci stanno nel pacchetto, con quelli di `--allega`? I motivi del no (vuoto = sì). PURA.
 * `perUnita`: [{ u: { num }, allegati: [{ tipo }] }]; `propri`: { immagini, documenti } contati.
 */
export function tettoAllegati(perUnita, propri = {}) {
  const motivi = [];
  for (const [tipo, parola, mie] of [['immagine', 'immagini', Number(propri.immagini) || 0], ['documento', 'documenti', Number(propri.documenti) || 0]]) {
    const conti = (Array.isArray(perUnita) ? perUnita : []).map(({ u, allegati }) => [u.num, (allegati || []).filter((a) => a.tipo === tipo).length]).filter(([, n]) => n > 0);
    const dalleUnite = conti.reduce((s, [, n]) => s + n, 0);
    if (dalleUnite + mie <= TETTO_PER_TIPO) continue;
    motivi.push(`le unite portano ${dalleUnite} ${parola} (${conti.map(([n, k]) => `#${n}: ${k}`).join(', ')})${mie ? ` e tu ne alleghi ${mie}` : ''}: un feedback ne tiene al più ${TETTO_PER_TIPO}. Dividi il pacchetto${mie ? ', o allega meno' : ''}`);
  }
  return motivi;
}

/** Il tipo vero di un'immagine dai suoi byte, '' se non è un'immagine che Filo apre (l'SVG è attivo). PURA. */
function tipoImmagine(byte) {
  const b = byte || [];
  const t = globalThis.SN_FEEDBACK_IMAGE.sniffImageMime(b);
  // Il riconoscitore ripiega su PNG quando non riconosce: un PNG vero comincia con la sua firma.
  if (t === 'image/png' && !(b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)) return '';
  return globalThis.SN_FEEDBACK_ATTACH.classify({ name: '', type: t }) === 'image' ? t : '';
}

/**
 * Gli allegati scaricati delle unite → quelli del pacchetto: i documenti col nome «#N — nome», le immagini (che un nome
 * non l'hanno) con l'origine scritta in `origine`, da mettere in coda alla spec. `primaImmagini`: quante ne porta
 * `--allega`, che vengono prima. PURA. → { immagini, documenti, origine, motivi }
 */
export function copieDegliAllegati(perUnita, { primaImmagini = 0 } = {}) {
  const immagini = [];
  const documenti = [];
  const righe = [];
  const motivi = [];
  const dati = (type, byte) => `data:${type};base64,${Buffer.from(byte).toString('base64')}`;
  for (const { u, allegati } of Array.isArray(perUnita) ? perUnita : []) {
    for (const a of allegati || []) {
      const dove = a.conversazione ? ' della conversazione' : '';
      const byte = a.byte;
      const chi = a.tipo === 'immagine' ? `l'immagine ${a.indice}${dove}` : `l'allegato${dove} «${a.nome || a.indice}»`;
      if (!byte || !byte.length) { motivi.push(`#${u.num}: ${chi} è vuoto`); continue; }
      if (byte.length > MAX_ALLEGATO_BYTES) { motivi.push(`#${u.num}: ${chi} supera i 4 MB`); continue; }
      if (a.tipo === 'immagine') {
        const type = tipoImmagine(byte);
        if (!type) { motivi.push(`#${u.num}: ${chi} non è un'immagine che Filo apre`); continue; }
        immagini.push({ name: `#${u.num} — immagine ${a.indice}${dove}`, type, dataUrl: dati(type, byte) });
        righe.push(`- immagine ${primaImmagini + immagini.length}: da #${u.num}, la sua immagine ${a.indice}${dove}`);
        continue;
      }
      const originale = String(a.nome || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim() || `allegato ${a.indice}`;
      const name = `#${u.num} — ${originale}`;
      const type = a.type || mimeDiAllegato(originale);
      if (globalThis.SN_FEEDBACK_ATTACH.classify({ name, type }) !== 'file') { motivi.push(`#${u.num}: ${chi} ha un tipo che un feedback non ammette (${type || 'senza tipo'})`); continue; }
      documenti.push({ name, type, dataUrl: dati(type, byte) });
      righe.push(`- «${name}»: da #${u.num}${dove ? `, allegato${dove}` : ''}`);
    }
  }
  const origine = righe.length ? ['Allegati copiati dalle segnalazioni unite:', ...righe].join('\n') : '';
  return { immagini, documenti, origine, motivi };
}

/**
 * Chi aspetta una delle unite, dalle righe lette → [{ id, num, togli: [id], quali: [num], tenute: [num] }]: `tenute` sono
 * le sue altre attese. Le unite stesse no: si archiviano. PURA.
 */
export function chiAspetta(righe, unite) {
  const perId = new Map((Array.isArray(unite) ? unite : []).map((u) => [u.id, String(u.num)]));
  const out = [];
  for (const r of Array.isArray(righe) ? righe : []) {
    const id = String((r && r._id) || '');
    if (!id || perId.has(id)) continue;
    const attese = globalThis.SN_FB_ATTESE.atteseDi(r);
    const togli = attese.map((w) => w.id).filter((x) => perId.has(x));
    if (!togli.length) continue;
    out.push({
      id, num: FB.formatNum(Number(r.seq), Number(r.subSeq)) || id, togli, quali: togli.map((x) => perId.get(x)),
      tenute: attese.filter((w) => !perId.has(w.id)).map((w) => w.num || w.id),
    });
  }
  return out;
}

/** Letture e scritture di un pacchetto. Oggetto: i test lo sostituiscono, il vero va in rete. */
export const pacchetto = {
  async leggi(numeri, idToken) {
    const { segnalazioneDaUnire } = await import('./owner-feedback.mjs');
    return Promise.all(numeri.map(async (n) => ({ num: n, ...(await segnalazioneDaUnire(n, { bearer: idToken })) })));
  },
  // I riferimenti agli allegati di una unita, compresi quelli della conversazione (cifrata: senza chiave non so se ce ne sono).
  async allegati(u, idToken) {
    const { FIRESTORE_BASE } = await import('./lib/firestore-auth.mjs');
    const res = await fetch(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(u.id)}?mask.fieldPaths=images&mask.fieldPaths=files&mask.fieldPaths=notes`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!res.ok) throw new Error(`lettura degli allegati di #${u.num} fallita (${res.status})`);
    const f = (await res.json()).fields || {};
    let conversazione = f.notes?.stringValue || '';
    if (globalThis.SN_FEEDBACK_CRYPTO.isEncrypted(conversazione)) {
      const { decryptFeedbackFields, PLACEHOLDER } = await import('./lib/decrypt-feedback-fields.mjs');
      conversazione = String((await decryptFeedbackFields({ _id: u.id, notes: conversazione })).notes || '');
      if (conversazione === PLACEHOLDER || globalThis.SN_FEEDBACK_CRYPTO.isEncrypted(conversazione) || THREAD.reportUnreadable(conversazione)) {
        throw Object.assign(new Error(`la conversazione di #${u.num} non si decifra (manca la chiave privata?): senza non so se porta allegati`), { definitivo: true });
      }
    }
    return riferimentiAllegati(f, conversazione);
  },
  async scarica(a) {
    if (!FB.isAttachmentUrl(a.url)) throw Object.assign(new Error('l’indirizzo non è del deposito di Filo: non lo scarico'), { definitivo: true });
    const res = await fetch(a.url);
    if (!res.ok) throw new Error(`download fallito (${res.status})`);
    const { decryptAttachmentBytes } = await import('./lib/decrypt-feedback-fields.mjs');
    try { return await decryptAttachmentBytes(new Uint8Array(await res.arrayBuffer())); } catch (e) { throw Object.assign(e, { definitivo: true }); }
  },
  // Una scansione con la sola proiezione delle attese: chi aspetta una unita può essere qualunque feedback.
  async attesiDa(unite, idToken) {
    const r = await FB.listAllPaged({ idToken, fields: ['seq', 'subSeq', globalThis.SN_FB_ATTESE.CAMPO] });
    if (r.complete === false) throw new Error(`la lettura delle attese non è completa (${r.rows.length} documenti)`);
    return chiAspetta(r.rows, unite);
  },
  async sposta(x, voce, idToken) {
    const { spostaAttese } = await import('./owner-feedback.mjs');
    return spostaAttese(x.id, x.togli, voce, { bearer: idToken });
  },
  async archivia(u, nota, idToken) {
    const { scrivi } = await import('./owner-feedback.mjs');
    return scrivi(u.id, 'archived', nota, { bearer: idToken, rif: `#${u.num}` });
  },
};

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
  '  Un lavoro che chiede il server: node scripts/routine-channel.mjs deliver status --status design --reason locale --notes "perché"',
].join('\n');

/** Siamo dentro una routine? Oggetto e non funzione, come `credenziale`, perché i test lo sostituiscono. */
export const ambiente = {
  routine() { return isRoutineInstance(resolve(fileURLToPath(import.meta.url), '..', '..')); },
};

function uso() {
  console.error('Uso: node scripts/claude-feedback.mjs "<titolo>" "<testo>" --locale|--non-locale [--priorita 0..3] [--url <indirizzo>] [--allega <file>]… [--aspetta 676,663.2] [--pacchetto 812,815] [--dry-run]');
  console.error('     --pacchetto: il testo è la spec che unisce quelle segnalazioni; il pacchetto ne copia gli allegati e le archivia, e chi le aspettava aspetta lui.');
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
  const { controllaArgomenti, argomentiDaNpm, espandiUguali, opzioneStorpiata, avvisoTrattinoDaNpm } = await import('./lib/argomenti.mjs');
  const OPZ = {
    opzioni: ['--priorita', '--url', '--allega', '--locale', '--non-locale', '--aspetta', '--pacchetto', '--dry-run'],
    conValore: ['--priorita', '--url', '--allega', '--aspetta', '--pacchetto'],
    ripetibili: ['--allega'],
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
  const CON_VALORE = new Set(['--priorita', '--url', '--allega', '--aspetta', '--pacchetto']);
  const posizionali = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    // Per nome esatto: «-- vedi sotto» passa il controllo come testo, e qui non deve sparire (#878).
    if (OPZ.opzioni.includes(a)) { if (CON_VALORE.has(a)) i += 1; continue; }
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
  const aspettaRaw = flag('aspetta');
  if (argv.includes('--aspetta') && !String(aspettaRaw || '').trim()) { console.error('RIFIUTATO: --aspetta vuole i numeri (--aspetta 676,663.2). Non ho aperto niente.'); return EXIT.USO; }
  const numeriAttesa = globalThis.SN_FB_ATTESE.leggiNumeri(aspettaRaw || '');
  if (!numeriAttesa.ok) { console.error(`RIFIUTATO: --aspetta: ${numeriAttesa.motivo}. Non ho aperto niente.`); return EXIT.USO; }
  const pacchettoRaw = flag('pacchetto');
  if (argv.includes('--pacchetto') && !String(pacchettoRaw || '').trim()) { console.error('RIFIUTATO: --pacchetto vuole i numeri delle segnalazioni che unisce (--pacchetto 812,815). Non ho aperto niente.'); return EXIT.USO; }
  const numeriUnite = globalThis.SN_FB_ATTESE.leggiNumeri(pacchettoRaw || '');
  if (!numeriUnite.ok) { console.error(`RIFIUTATO: --pacchetto: ${numeriUnite.motivo.replace('un feedback ne aspetta', 'un pacchetto ne unisce')}. Non ho aperto niente.`); return EXIT.USO; }

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
  // Le attese si controllano prima di aprire: un numero sbagliato non deve lasciare dietro un feedback senza.
  let listaAttese = [];
  if (deposita && numeriAttesa.numeri.length) {
    let v;
    try { v = await attese.risolvi(numeriAttesa.numeri, cred.idToken); } catch (e) { v = { ok: false, motivo: `lettura dei numeri fallita: ${String((e && e.message) || e)}`, rete: true }; }
    if (!v.ok) { console.error(`RIFIUTATO: --aspetta: ${v.motivo}. Non ho aperto niente.`); return v.rete ? EXIT.IRRAGGIUNGIBILE : EXIT.RIFIUTATO; }
    listaAttese = v.attese;
  }
  // Le segnalazioni del pacchetto si controllano tutte prima di aprire, e i motivi si dicono tutti insieme.
  let unite = [];
  if (deposita && numeriUnite.numeri.length) {
    let lette;
    try { lette = await pacchetto.leggi(numeriUnite.numeri, cred.idToken); } catch (e) {
      console.error(`RIFIUTATO: --pacchetto: lettura delle segnalazioni fallita (${String((e && e.message) || e)}). Non ho aperto niente.`);
      return EXIT.IRRAGGIUNGIBILE;
    }
    // Chi aspetta già un pacchetto aperto è già preso: si leggono gli aspettati per saperlo.
    const attesi = [...new Set(lette.filter((u) => u && u.ok).flatMap((u) => (u.attese || []).map((w) => String(w.num || '').replace(/^#/, '')).filter(Boolean)))];
    let pacchetti = [];
    if (attesi.length) {
      try {
        pacchetti = (await pacchetto.leggi(attesi, cred.idToken))
          .filter((p) => p && p.ok && Array.isArray(p.unisce) && p.unisce.length && !['done', 'archived'].includes(p.stato)).map((p) => String(p.num));
      } catch (e) {
        console.error(`RIFIUTATO: --pacchetto: lettura dei feedback aspettati fallita (${String((e && e.message) || e)}). Non ho aperto niente.`);
        return EXIT.IRRAGGIUNGIBILE;
      }
    }
    const motivi = controllaUnite(lette, { aspetta: numeriAttesa.numeri, pacchetti });
    if (motivi.length) {
      console.error(`RIFIUTATO: --pacchetto, non ho aperto niente:\n${motivi.map((m) => `  - ${m}`).join('\n')}`);
      return EXIT.RIFIUTATO;
    }
    unite = lette;
  }
  // Gli allegati delle unite si contano, si scaricano e si controllano tutti prima di aprire: un pacchetto non nasce monco.
  const msg = (e) => String((e && e.message) || e);
  const codiceDi = (e) => (e && e.definitivo ? EXIT.RIFIUTATO : exitCodeForError(e));
  let copie = null;
  let attesi = [];
  if (unite.length) {
    let riferimenti;
    try { riferimenti = await Promise.all(unite.map(async (u) => ({ u, allegati: await pacchetto.allegati(u, cred.idToken) }))); } catch (e) {
      console.error(`RIFIUTATO: --pacchetto: ${msg(e)}. Non ho aperto niente.`);
      return codiceDi(e);
    }
    const mieImmagini = allegati.filter((a) => a.type.startsWith('image/')).length;
    const troppi = tettoAllegati(riferimenti, { immagini: mieImmagini, documenti: allegati.length - mieImmagini });
    if (troppi.length) {
      console.error(`RIFIUTATO: --pacchetto, gli allegati delle unite non ci stanno e non ho aperto niente:\n${troppi.map((m) => `  - ${m}`).join('\n')}`);
      return EXIT.RIFIUTATO;
    }
    let scaricati;
    try {
      scaricati = await Promise.all(riferimenti.map(async ({ u, allegati: lista }) => ({
        u,
        allegati: await Promise.all(lista.map(async (a) => {
          try { return { ...a, byte: await pacchetto.scarica(a) }; } catch (e) {
            const chi = a.tipo === 'immagine' ? `l'immagine ${a.indice}` : `l'allegato «${a.nome || a.indice}»`;
            throw Object.assign(new Error(`#${u.num}: ${chi}${a.conversazione ? ' della conversazione' : ''} non si apre (${msg(e)})`), { definitivo: !!(e && e.definitivo) });
          }
        })),
      })));
    } catch (e) {
      console.error(`RIFIUTATO: --pacchetto: ${msg(e)}. Non ho aperto niente.`);
      return codiceDi(e);
    }
    copie = copieDegliAllegati(scaricati, { primaImmagini: mieImmagini });
    if (copie.motivi.length) {
      console.error(`RIFIUTATO: --pacchetto, non ho aperto niente:\n${copie.motivi.map((m) => `  - ${m}`).join('\n')}`);
      return EXIT.RIFIUTATO;
    }
    // Chi aspetta una unita passerà ad aspettare il pacchetto: si sa prima di aprire, e un giro col pacchetto si dice prima.
    try { attesi = await pacchetto.attesiDa(unite, cred.idToken); } catch (e) {
      console.error(`RIFIUTATO: --pacchetto: non so chi aspetta le segnalazioni unite (${msg(e)}). Non ho aperto niente: rilancia.`);
      return codiceDi(e);
    }
    const giri = attesi.filter((x) => numeriAttesa.numeri.includes(String(x.num)));
    if (giri.length) {
      console.error(`RIFIUTATO: --pacchetto, non ho aperto niente:\n${giri.map((x) => `  - #${x.num} aspetta ${x.quali.map((n) => `#${n}`).join(', ')}, che entra nel pacchetto, e il pacchetto aspetta #${x.num}: si aspetterebbero a vicenda`).join('\n')}`);
      return EXIT.RIFIUTATO;
    }
  }
  const prioritaScelta = unite.length ? prioritaDelPacchetto(p.valore, unite) : p.valore;
  const r = await apri({
    titolo, testo: copie && copie.origine ? `${String(testo || '').trim()}\n\n${copie.origine}` : testo, url, priorita: prioritaScelta,
    allegati: copie ? [...allegati, ...copie.immagini, ...copie.documenti] : allegati,
    dryRun, idToken: cred.idToken, locale, attese: listaAttese, unisce: unite,
  });
  if (!r.ok) {
    console.error(`${r.uso ? 'USO' : 'RIFIUTATO'}: ${r.motivo}`);
    const daNpmSparito = r.uso && /mancante$/.test(r.motivo) ? avvisoTrattinoDaNpm(process.env) : '';
    if (daNpmSparito) console.error(daNpmSparito);
    if (r.uso) uso();
    return r.uso ? EXIT.USO : (r.codice || EXIT.RIFIUTATO);
  }
  if (r.dryRun) {
    console.log(`(prova a vuoto) aprirei "${r.name}" come ${r.clientId}, ${locale ? 'lavoro locale' : 'per le routine'}${p.valore != null ? `, priorità ${p.valore}` : ''}${r.allegati ? `, con ${r.allegati} allegati` : ''}${numeriAttesa.numeri.length ? `, che aspetta ${numeriAttesa.numeri.map((n) => `#${n}`).join(', ')}` : ''}${numeriUnite.numeri.length ? `, come pacchetto che unisce ${numeriUnite.numeri.map((n) => `#${n}`).join(', ')} (coi loro allegati, e alla nascita le archivio)` : ''}.`);
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
  // La fiducia la decide il server dal biglietto (#1148): pulito salta i giudici, sporco o assente ci passa.
  console.log(r.biglietto === 'pulito' ? 'Biglietto della sessione pulito: nasce fidato, niente giudici.'
    : r.biglietto === 'sporco' ? 'Biglietto della sessione sporco: nasce non fidato, passa dai giudici e la fusione aspetta il tuo sì.'
      : 'Nessun biglietto della sessione: nasce non fidato (node scripts/biglietto.mjs stato).');

  if (r.attese && r.attese.length) console.log(`Aspetta ${globalThis.SN_FB_ATTESE.testoAttese(r.attese)}: nessuna routine lo prende finché non sono tutti fusi, poi entra in coda da solo.`);
  // Alla nascita le unite si archiviano, e chi le aspettava aspetta il pacchetto. Un passo che non riesce non è
  // silenzioso: il pacchetto esiste già, e la riga per rimediare si stampa intera.
  let incompleto = false;
  const cheAspetta = (x, num) => `npm run feedback -- ${x.num} --aspetta ${[...x.tenute, num].join(',')}`;
  if (unite.length && !r.seq) {
    incompleto = true;
    const passi = [
      ...attesi.map((x) => cheAspetta(x, '<numero del pacchetto>')),
      ...unite.map((u) => `npm run feedback -- ${u.num} archived "${notaUnita('<numero del pacchetto>')}"`),
    ];
    console.error(`UNITE NON ARCHIVIATE: il pacchetto è nato senza numero (la numerazione non ha risposto), e attese e note lo nominano. ${unite.map((u) => `#${u.num}`).join(', ')} restano in coda. Quando ce l'ha, in quest'ordine:\n${passi.map((x) => `  ${x}`).join('\n')}`);
  } else if (unite.length) {
    const voce = { id: r.id, num: String(r.seq) };
    const nota = notaUnita(voce.num);
    // Prima le attese: una unita archiviata che qualcuno aspetta ancora manderebbe quel qualcuno all'owner (attesa chiusa).
    const spostate = await Promise.all(attesi.map(async (x) => {
      try { return { x, e: await pacchetto.sposta(x, voce, cred.idToken) }; } catch (e) { return { x, e: { ok: false, motivo: msg(e) } }; }
    }));
    const ferme = new Set(spostate.filter((s) => !s.e.ok).flatMap((s) => s.x.togli));
    const fatte = spostate.filter((s) => s.e.ok);
    if (fatte.length) console.log(`Attese spostate sul pacchetto: ${fatte.map(({ x }) => `#${x.num} (aspettava ${x.quali.map((n) => `#${n}`).join(', ')})`).join(', ')}.`);
    for (const { x, e } of spostate.filter((s) => !s.e.ok)) {
      incompleto = true;
      console.error(`ATTESA NON SPOSTATA su #${x.num} (${e.motivo}): aspetta ancora ${x.quali.map((n) => `#${n}`).join(', ')}. Rimedia con: ${cheAspetta(x, voce.num)}`);
    }
    const archiviate = await Promise.all(unite.filter((u) => !ferme.has(u.id)).map(async (u) => {
      try { return { u, e: await pacchetto.archivia(u, nota, cred.idToken) }; } catch (e) { return { u, e: { ok: false, motivo: msg(e) } }; }
    }));
    const riuscite = archiviate.filter((a) => a.e.ok).map((a) => `#${a.u.num}`);
    if (riuscite.length) console.log(`Archiviate ${riuscite.join(', ')} con la nota «${nota}».`);
    for (const { u, e } of archiviate.filter((a) => !a.e.ok)) {
      incompleto = true;
      console.error(`ARCHIVIAZIONE NON RIUSCITA su #${u.num} (${e.motivo}): resta in coda, e una routine la lavorerebbe da sola. Rimedia con: npm run feedback -- ${u.num} archived "${nota}"`);
    }
    for (const u of unite.filter((x) => ferme.has(x.id))) {
      incompleto = true;
      console.error(`#${u.num} NON ARCHIVIATA: qualcuno la aspetta ancora (sopra). Dopo aver spostato quell'attesa: npm run feedback -- ${u.num} archived "${nota}"`);
    }
  }
  if (copie && copie.immagini.length + copie.documenti.length) {
    console.log(`Allegati copiati dalle unite: ${copie.immagini.length} immagini, ${copie.documenti.length} documenti; da dove viene ognuno sta in coda alla spec.`);
  }
  if (r.allegati) console.log(`Allegati caricati: ${r.allegati}.`);
  for (const f of (r.falliti || [])) {
    console.error(`ALLEGATO NON CARICATO: ${f.name} (${f.reason}). Il feedback esiste ma senza questo documento.`);
  }

  // `!= null`, non un controllo di verità: lo 0 è una priorità da scrivere.
  if (r.priorita != null) console.log(`Priorità ${r.priorita} impostata.`);
  else if (p.valore != null) console.log(`Priorità ${p.valore} NON impostata: mettila con npm run feedback -- ${r.seq || r.id} --priorita ${p.valore}`);
  else if (!locale) console.log('Priorità: la decide il giudice di priorità, come per ogni feedback che entra in coda.');
  // Un allegato mancante è un rifiuto parziale: chi lancia lo script deve
  // accorgersene, perché il feedback senza il documento può non avere senso.
  return (r.falliti && r.falliti.length) || incompleto ? EXIT.RIFIUTATO : EXIT.FATTO;
}

if (isMain) {
  process.exit(await main(process.argv.slice(2)));
}
