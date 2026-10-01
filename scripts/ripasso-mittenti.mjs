// La prova del mittente (#595) sui feedback vecchi con prefisso riservato: a ciascuno quella di chi l'ha creato davvero.
// Owner e sessioni per epoca; routine e costruzione solo con un segno che un falso non può avere. Il testo non si decifra.
// Regole: tests/unit/ripassoMittenti.test.mjs. Uso: npm run feedback:ripasso [-- --dry-run]

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireBearer, FIRESTORE_BASE } from './lib/firestore-auth.mjs';
import { contatoreLetture } from './lib/letture.mjs';
import '../src/shared/feedbackThread.js';
import '../src/shared/feedbackPublicKey.js';
import '../src/shared/feedbackCrypto.js';
import '../src/shared/feedbackStatus.js';
import '../src/shared/feedback.js';

const FS = globalThis.SN_FB_STATUS;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const VIA = Object.freeze({
  EPOCA: 'nati prima che la prova esistesse',
  CAMPI: 'campi che solo il server scrive alla nascita',
  CODA_ID: 'coda di triage in git, per id',
  CODA_TITOLO: 'coda di triage in git, per titolo',
  NOTA_PADRE: 'nota del server sul feedback padre',
});

export const MOTIVO = Object.freeze({
  DOPO: 'nati quando la prova esisteva già',
  ILLEGGIBILE: 'stato non decifrabile',
  SEGNALATI: 'segnalati come attacco, spam o file sospetto',
  RICEVUTI_SEGNALATI: 'segnalati dai giudici, fermi nei Ricevuti',
  GIUDIZIO_ILLEGGIBILE: 'fermi nei Ricevuti con un giudizio che non si decifra',
  ESPLORATORE: "creati in anonimo dall'esploratore (test:explore): una prova non c'è",
  CODA_AMBIGUA: 'titolo della coda di triage non univoco',
  DERIVATO_SENZA_NOTA: 'derivati senza traccia del server sul padre',
  SENZA_SEGNO: 'nessun segno che li distingua da un falso',
});

const RISCHIO = ['attack', 'spam'];
const STATI_SEGNALATI_RE = /^(attack|spam|suspicious_file)/;
// La GitHub Action della coda creava col service account entro minuti dall'accodamento (cron di riserva: 30').
const FINESTRA_CODA_MS = { prima: 10 * 60e3, dopo: 24 * 3600e3 };

/** La famiglia del mittente per i conteggi, '' se il prefisso non è riservato. PURA. */
export function categoria(clientId) {
  const m = String(clientId || '').match(/^(owner|routine|agent|local):([^:]*)/i);
  if (!m) return '';
  const p = m[1].toLowerCase();
  if (p === 'owner' || p === 'local') return p;
  const ruolo = m[2].trim().toLowerCase();
  if (p === 'agent') return ruolo === 'costruzione' ? 'agent:costruzione' : 'agent (esploratore)';
  return `routine:${ruolo || '?'}`;
}

/**
 * Il motivo per cui un feedback segnalato resta senza prova, '' se non lo è. PURA.
 * Prima della prova il prefisso bastava a essere fidati, e un attacco fidato finiva in `unlabeled`, non in `attack`.
 * `pipeline`: oggetto decifrato, stringa se non si decifra, assente se mai giudicato.
 */
export function motivoSegnalato(d) {
  const st = String((d && d.status) || '');
  if (STATI_SEGNALATI_RE.test(st)) return MOTIVO.SEGNALATI;
  if (st !== 'unlabeled') return '';
  const p = d.pipeline;
  if (p === undefined || p === null || p === '') return '';
  if (typeof p !== 'object') return MOTIVO.GIUDIZIO_ILLEGGIBILE;
  const verdetti = Array.isArray(p.verdicts) ? p.verdicts : [];
  if (p.action === 'block_attack' || p.action === 'block_spam'
    || p.l1Category === 'dangerous' || p.l1Category === 'spam'
    || RISCHIO.includes(p.l2Class)
    || verdetti.some((v) => v && RISCHIO.includes(v.class))) return MOTIVO.RICEVUTI_SEGNALATI;
  return '';
}

/** L'istante (ms) da cui la prova `admin` c'è sempre: il primo feedback che la porta, o adesso. PURA. */
export function sogliaDellaProva(docs, adesso) {
  let min = Number(adesso);
  for (const d of Array.isArray(docs) ? docs : []) {
    if (!d || d.senderProof !== 'admin') continue;
    const t = Date.parse(d.createTime || '');
    if (Number.isFinite(t) && t < min) min = t;
  }
  return min;
}

/** `git log --diff-filter=A --name-only --format=@%H -- feedback-triage` → ['sha:percorso'] delle voci della coda. PURA. */
export function percorsiDellaCoda(log) {
  const out = [];
  let sha = '';
  for (const riga of String(log || '').split(/\r?\n/)) {
    if (riga.startsWith('@')) sha = riga.slice(1).trim();
    else if (sha && /^feedback-triage\/[^/]+\.json$/.test(riga.trim())) out.push(`${sha}:${riga.trim()}`);
  }
  return out;
}

/** L'uscita di `git cat-file --batch` → le voci JSON leggibili. PURA. */
export function vociDalBatch(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf || ''), 'utf8');
  const out = [];
  let i = 0;
  while (i < b.length) {
    const nl = b.indexOf(10, i);
    if (nl < 0) break;
    const m = b.subarray(i, nl).toString('utf8').match(/^\S+ blob (\d+)$/);
    i = nl + 1;
    if (!m) continue;
    const n = Number(m[1]);
    try { out.push(JSON.parse(b.subarray(i, i + n).toString('utf8'))); } catch (_) { /* non è una voce */ }
    i += n + 1;
  }
  return out;
}

/**
 * Le creazioni della coda di triage (scripts/apply-triage.mjs, fino al 17/08), col clientId che l'Action scriveva. PURA.
 * La stessa voce aggiunta su più rami conta una volta; una uid con due mittenti diversi non prova niente.
 */
export function vociDellaCoda(voci) {
  const perUid = new Map();
  const senzaUid = new Map();
  for (const e of Array.isArray(voci) ? voci : []) {
    if (!e || e.op !== 'create') continue;
    const clientId = `routine:${String(e.queuedBy || 'routine').slice(0, 80)}`;
    if (typeof e.uid === 'string' && e.uid) {
      perUid.set(e.uid, perUid.has(e.uid) && perUid.get(e.uid) !== clientId ? null : clientId);
    } else {
      const v = { clientId, name: String(e.name || ''), queuedAt: Date.parse(e.queuedAt || '') };
      senzaUid.set(`${v.clientId}\n${v.name}\n${e.queuedAt}`, v);
    }
  }
  return { perUid, senzaUid: [...senzaUid.values()] };
}

/** I numeri dei derivati che il server ha annotato sul padre aprendoli (frasi del 19/08, 05/09 e 23/09). PURA. */
export function numeriDerivatiNelleNote(notes) {
  const out = new Set();
  const t = String(notes || '').replace(/\r/g, '');
  for (const m of t.matchAll(/I rilievi non (?:risolti|corretti) sono diventati il feedback (#\d+\.\d+)/g)) out.add(m[1]);
  for (const m of t.matchAll(/^Feedback derivat[oi] apert[oi]: (.+)$/gm)) {
    for (const n of m[1].matchAll(/(#\d+\.\d+) \(priorità/g)) out.add(n[1]);
  }
  return out;
}

const numeroDi = (d) => (d && d.seq ? `#${d.seq}${d.subSeq ? `.${d.subSeq}` : ''}` : '');
const campiDelServer = (d) => d.derived === true || Number.isInteger(d.generation) || d.alarmKeys === true;
const residuo = (d) => categoria(d && d.clientId) === 'routine:residuo';

/** I padri di cui leggere le note: solo per i derivati che non hanno già un segno, e mai di un segnalato. PURA. */
export function padriDaLeggere(docs) {
  const lista = Array.isArray(docs) ? docs.filter(Boolean) : [];
  const perId = new Map(lista.map((d) => [d.id, d]));
  const out = new Set();
  for (const d of lista) {
    if (d.senderProof || !residuo(d) || campiDelServer(d) || !d.parentId) continue;
    const p = perId.get(d.parentId);
    const st = String((p && p.status) || '');
    if (!p || !FS.isCanonical(st) || st === 'unlabeled' || STATI_SEGNALATI_RE.test(st)) continue;
    out.add(d.parentId);
  }
  return [...out];
}

function conta(lista, chiave) {
  const m = new Map();
  for (const d of lista) {
    const k = chiave(d);
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

/**
 * Chi riceve quale prova. PURA. `docs`: { id, seq, subSeq, createTime (del server), clientId e status decifrati,
 * senderProof, derived, generation, alarmKeys (bool), parentId, name (solo se in chiaro), pipeline }.
 * `coda` da vociDellaCoda, `derivatiDelPadre`: id del padre → Set dei numeri annotati dal server.
 * @returns {{ promossi: object[], saltati: { categoria: string, motivo: string, n: number }[] }}
 */
export function candidatiAlRipasso(docs, soglia, { coda = vociDellaCoda([]), derivatiDelPadre = new Map() } = {}) {
  const lista = Array.isArray(docs) ? docs.filter(Boolean) : [];
  const numeri = conta(lista, numeroDi);
  const titoli = conta(lista, (d) => (d.name ? `${d.clientId}\n${d.name}` : ''));
  const promossi = [];
  const saltati = new Map();
  const salta = (cat, motivo) => { const k = `${cat}\n${motivo}`; saltati.set(k, (saltati.get(k) || 0) + 1); };

  function provaRoutine(d, cat) {
    if (campiDelServer(d)) return { prova: 'server', via: VIA.CAMPI };
    if (coda.perUid.get(d.id) === d.clientId) return { prova: 'server', via: VIA.CODA_ID };
    const nato = Date.parse(d.createTime || '');
    const voci = d.name ? coda.senzaUid.filter((v) => v.clientId === d.clientId && v.name === d.name) : [];
    if (voci.length) {
      // Un falso che copia un titolo dalla coda pubblica fa due documenti con lo stesso titolo: non lo prende nessuno.
      const v = voci[0];
      const inFinestra = voci.length === 1 && nato >= v.queuedAt - FINESTRA_CODA_MS.prima && nato <= v.queuedAt + FINESTRA_CODA_MS.dopo;
      if (inFinestra && titoli.get(`${d.clientId}\n${d.name}`) === 1) return { prova: 'server', via: VIA.CODA_TITOLO };
      return { motivo: MOTIVO.CODA_AMBIGUA };
    }
    if (cat === 'routine:residuo') {
      const n = numeroDi(d);
      const annotati = derivatiDelPadre.get(d.parentId);
      if (d.subSeq > 0 && numeri.get(n) === 1 && annotati && annotati.has(n)) return { prova: 'server', via: VIA.NOTA_PADRE };
      return { motivo: MOTIVO.DERIVATO_SENZA_NOTA };
    }
    return { motivo: MOTIVO.SENZA_SEGNO };
  }

  for (const d of lista) {
    if (d.senderProof) continue;
    const cat = categoria(d.clientId);
    if (!cat) continue;
    const st = String(d.status || '');
    let esito;
    if (!FS.isCanonical(st)) esito = { motivo: MOTIVO.ILLEGGIBILE };
    else if (motivoSegnalato(d)) esito = { motivo: motivoSegnalato(d) };
    else if (cat === 'owner' || cat === 'local') {
      const nato = Date.parse(d.createTime || '');
      esito = Number.isFinite(nato) && nato < soglia ? { prova: 'admin', via: VIA.EPOCA } : { motivo: MOTIVO.DOPO };
    } else if (cat === 'agent (esploratore)') esito = { motivo: MOTIVO.ESPLORATORE };
    else esito = provaRoutine(d, cat);
    if (esito.prova) promossi.push({ ...d, categoria: cat, prova: esito.prova, via: esito.via });
    else salta(cat, esito.motivo);
  }
  return {
    promossi,
    saltati: [...saltati].map(([k, n]) => { const [cat, motivo] = k.split('\n'); return { categoria: cat, motivo, n }; }),
  };
}

/** Le righe del resoconto, per famiglia di mittente. PURA. */
export function resoconto({ promossi, saltati }) {
  const righe = [];
  const per = new Map();
  for (const d of promossi) {
    const k = `${d.categoria}\n${d.prova}\n${d.via}`;
    per.set(k, (per.get(k) || 0) + 1);
  }
  const ordina = (a, b) => a.localeCompare(b);
  righe.push(`Ricevono la prova: ${promossi.length}`);
  for (const k of [...per.keys()].sort(ordina)) {
    const [cat, prova, via] = k.split('\n');
    righe.push(`  ${cat}: ${per.get(k)} → ${prova} (${via})`);
  }
  righe.push(`Restano senza: ${saltati.reduce((s, x) => s + x.n, 0)}`);
  for (const s of [...saltati].sort((a, b) => ordina(a.categoria, b.categoria) || b.n - a.n)) {
    righe.push(`  ${s.categoria}: ${s.n} (${s.motivo})`);
  }
  return righe;
}

function leggiCodaDiTriage() {
  // Il repo lo decide la cartella: un GIT_DIR ereditato da un hook leggerebbe un altro repo.
  const env = { ...process.env };
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE;
  const opz = { cwd: ROOT, env, maxBuffer: 1 << 28, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] };
  const log = execFileSync('git', ['log', '--all', '--diff-filter=A', '--name-only', '--format=@%H', '--', 'feedback-triage'], { ...opz, encoding: 'utf8' });
  const specs = percorsiDellaCoda(log);
  if (!specs.length) return vociDellaCoda([]);
  return vociDellaCoda(vociDalBatch(execFileSync('git', ['cat-file', '--batch'], { ...opz, input: `${specs.join('\n')}\n` })));
}

const CAMPI = ['clientId', 'senderProof', 'status', 'seq', 'subSeq', 'derived', 'generation', 'alarmKeys', 'parentId', 'name', 'pipeline'];

async function leggiTutti(bearer, letture) {
  const q = { structuredQuery: { from: [{ collectionId: 'feedback' }], select: { fields: CAMPI.map((f) => ({ fieldPath: f })) } } };
  const res = await fetch(`${FIRESTORE_BASE}:runQuery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: JSON.stringify(q),
  });
  if (!res.ok) throw Object.assign(new Error(`lettura dei feedback fallita (${res.status})`), { codice: res.status >= 500 ? 4 : 3 });
  const righe = (await res.json()).filter((x) => x && x.document);
  letture.aggiungi(righe.length, 'segnalazioni');
  const { decryptFeedbackFields } = await import('./lib/decrypt-feedback-fields.mjs');
  const valore = globalThis.SN_FEEDBACK.fromFsValue;
  const docs = [];
  for (const x of righe) {
    const f = Object.fromEntries(Object.entries(x.document.fields || {}).map(([k, v]) => [k, valore(v)]));
    let dec = { clientId: String(f.clientId || ''), status: String(f.status || '') };
    try { dec = await decryptFeedbackFields(dec); } catch (_) { /* resta cifrato: non passa il prefisso */ }
    const d = {
      id: x.document.name.split('/').pop(), createTime: x.document.createTime || '',
      seq: Number(f.seq) || null, subSeq: Number(f.subSeq) || 0,
      clientId: String(dec.clientId || ''), status: String(dec.status || '').trim(), senderProof: typeof f.senderProof === 'string' ? f.senderProof : '',
      derived: f.derived === true, generation: Number.isInteger(f.generation) ? f.generation : null, alarmKeys: Array.isArray(f.alarmKeys),
      parentId: typeof f.parentId === 'string' ? f.parentId : '',
      // Il titolo serve solo dove è in chiaro (la coda vecchia): non si decifra.
      name: typeof f.name === 'string' && !/^FENC1:/.test(f.name) ? f.name : '',
    };
    // Il giudizio si apre solo dove decide: prefisso riservato, senza prova, fermo nei Ricevuti.
    if (f.pipeline && !d.senderProof && categoria(d.clientId) && d.status === 'unlabeled') {
      let p = f.pipeline;
      try { p = (await decryptFeedbackFields({ pipeline: p })).pipeline; } catch (_) { /* resta illeggibile */ }
      d.pipeline = p && typeof p === 'object' ? p : 'illeggibile';
    }
    docs.push(d);
  }
  return docs;
}

async function leggiNoteDeiPadri(ids, bearer, letture) {
  const out = new Map();
  if (!ids.length) return out;
  const { decryptFeedbackFields } = await import('./lib/decrypt-feedback-fields.mjs');
  const radice = FIRESTORE_BASE.replace(/^https:\/\/[^/]+\/v1\//, '');
  for (let i = 0; i < ids.length; i += 100) {
    const pezzo = ids.slice(i, i + 100);
    const res = await fetch(`${FIRESTORE_BASE}:batchGet`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ documents: pezzo.map((id) => `${radice}/feedback/${id}`), mask: { fieldPaths: ['notes'] } }),
    });
    if (!res.ok) throw Object.assign(new Error(`lettura delle note dei padri fallita (${res.status})`), { codice: res.status >= 500 ? 4 : 3 });
    const righe = (await res.json()).filter((x) => x && x.found);
    letture.aggiungi(righe.length, 'padri dei derivati');
    for (const x of righe) {
      let notes = x.found.fields?.notes?.stringValue || '';
      try { notes = (await decryptFeedbackFields({ notes })).notes || ''; } catch (_) { notes = ''; }
      out.set(x.found.name.split('/').pop(), numeriDerivatiNelleNote(notes));
    }
  }
  return out;
}

const num = (d) => numeroDi(d) || d.id;

async function main(argv) {
  const ignote = argv.filter((a) => a !== '--dry-run');
  if (ignote.length) { console.error(`USO: npm run feedback:ripasso [-- --dry-run] (non capito: ${ignote.join(' ')})`); return 1; }
  const dryRun = argv.includes('--dry-run');
  const letture = contatoreLetture();
  const adesso = Date.now();
  let coda;
  try {
    coda = leggiCodaDiTriage();
  } catch (e) {
    console.warn(`La coda di triage non si legge da git (${String((e && e.message) || e).split('\n')[0]}): nessuno la prende come prova.`);
    coda = vociDellaCoda([]);
  }
  let bearer;
  let docs;
  let derivatiDelPadre;
  try {
    bearer = await acquireBearer();
    docs = await leggiTutti(bearer, letture);
    derivatiDelPadre = await leggiNoteDeiPadri(padriDaLeggere(docs), bearer, letture);
  } catch (e) {
    console.error(`RIFIUTATO: ${String((e && e.message) || e)}`);
    return e && e.codice === 3 ? 3 : 4;
  }
  const soglia = sogliaDellaProva(docs, adesso);
  const esito = candidatiAlRipasso(docs, soglia, { coda, derivatiDelPadre });
  // Dal più recente: un giro interrotto lascia scoperti solo i più vecchi, che la soglia (il più vecchio provato) copre ancora.
  const promossi = esito.promossi.sort((a, b) => String(b.createTime).localeCompare(String(a.createTime)));
  console.log(`Soglia per owner e sessioni: ${new Date(soglia).toISOString()}.`);
  for (const r of resoconto(esito)) console.log(r);
  for (const prova of ['admin', 'server']) {
    const questi = promossi.filter((d) => d.prova === prova);
    if (questi.length) console.log(`  ${prova}: ${questi.map(num).join(' ')}`);
  }
  if (dryRun || !promossi.length) {
    console.log(dryRun ? '(prova a vuoto: non ho scritto niente)' : 'Niente da ripassare.');
    console.log(letture.riga());
    return 0;
  }
  let scritti = 0;
  for (const d of promossi) {
    // Senza la precondizione un documento cancellato nel frattempo rinascerebbe con il solo campo della prova.
    const res = await fetch(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(d.id)}?updateMask.fieldPaths=senderProof&currentDocument.exists=true`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ fields: { senderProof: { stringValue: d.prova } } }),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e && e.message) }));
    if (!res.ok) {
      const regole = res.status === 403 ? ' Le regole pubblicate non ammettono ancora il campo: npm run regole:pubblica, poi rilancia.' : '';
      console.error(`Fermo a ${num(d)} dopo ${scritti} scritti: scrittura rifiutata (${res.status}).${regole}`);
      console.log(letture.riga());
      return res.status === 0 || res.status >= 500 ? 4 : 3;
    }
    scritti += 1;
  }
  console.log(`Prova del mittente scritta su ${scritti} feedback.`);
  console.log(letture.riga());
  return 0;
}

if (resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))) {
  process.exit(await main(process.argv.slice(2)));
}
