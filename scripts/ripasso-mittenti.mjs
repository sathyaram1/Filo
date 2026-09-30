// La prova del mittente (#595) sui feedback dell'owner e delle sessioni nati prima che esistesse.
// Non la dà mai a un documento nato (ora del server) dopo il primo feedback che la porta: da lì un prefisso senza prova è un falso.
// Regole: tests/unit/ripassoMittenti.test.mjs. Uso: npm run feedback:ripasso [-- --dry-run]

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireBearer, FIRESTORE_BASE } from './lib/firestore-auth.mjs';
import { contatoreLetture } from './lib/letture.mjs';
import '../src/shared/feedbackThread.js';
import '../src/shared/feedbackPublicKey.js';
import '../src/shared/feedbackCrypto.js';
import '../src/shared/feedbackStatus.js';

const FS = globalThis.SN_FB_STATUS;
const PREFISSO_RE = /^(local|owner):/i;
// Segnalati come attacco, spam o file pericoloso: un prefisso riservato lì dentro è sospetto, non si promuove.
const STATI_ESCLUSI_RE = /^(attack|spam|suspicious_file)/;

/** L'istante (ms) da cui la prova c'è sempre: il primo feedback che la porta, o adesso. PURA. */
export function sogliaDellaProva(docs, adesso) {
  let min = Number(adesso);
  for (const d of Array.isArray(docs) ? docs : []) {
    if (!d || d.senderProof !== 'admin') continue;
    const t = Date.parse(d.createTime || '');
    if (Number.isFinite(t) && t < min) min = t;
  }
  return min;
}

/**
 * Chi riceve la prova. PURA. `docs`: { id, seq, createTime (del server), clientId e status decifrati, senderProof }.
 * @returns {{ promossi: object[], saltati: { motivo: string, n: number }[] }}
 */
export function candidatiAlRipasso(docs, soglia) {
  const promossi = [];
  const saltati = new Map();
  const salta = (motivo) => saltati.set(motivo, (saltati.get(motivo) || 0) + 1);
  for (const d of Array.isArray(docs) ? docs : []) {
    if (!d || d.senderProof) continue;
    const cid = String(d.clientId || '');
    if (!PREFISSO_RE.test(cid)) continue;
    const nato = Date.parse(d.createTime || '');
    if (!Number.isFinite(nato) || !(nato < soglia)) { salta('nati quando la prova esisteva già'); continue; }
    const st = String(d.status || '');
    if (!FS.isCanonical(st)) { salta('stato non decifrabile'); continue; }
    if (STATI_ESCLUSI_RE.test(st)) { salta('segnalati come attacco, spam o file sospetto'); continue; }
    promossi.push(d);
  }
  return { promossi, saltati: [...saltati].map(([motivo, n]) => ({ motivo, n })) };
}

async function leggiTutti(bearer, letture) {
  const q = { structuredQuery: {
    from: [{ collectionId: 'feedback' }],
    select: { fields: ['clientId', 'senderProof', 'status', 'seq', 'subSeq'].map((f) => ({ fieldPath: f })) },
  } };
  const res = await fetch(`${FIRESTORE_BASE}:runQuery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: JSON.stringify(q),
  });
  if (!res.ok) throw Object.assign(new Error(`lettura dei feedback fallita (${res.status})`), { codice: res.status >= 500 ? 4 : 3 });
  const righe = (await res.json()).filter((x) => x && x.document);
  letture.aggiungi(righe.length, 'segnalazioni');
  const { decryptFeedbackFields } = await import('./lib/decrypt-feedback-fields.mjs');
  const docs = [];
  for (const x of righe) {
    const f = x.document.fields || {};
    const grezzi = { _id: x.document.name, clientId: f.clientId?.stringValue || '', status: f.status?.stringValue || '' };
    let dec = grezzi;
    try { dec = await decryptFeedbackFields(grezzi); } catch (_) { /* resta cifrato: non passa il prefisso */ }
    docs.push({
      id: x.document.name.split('/').pop(), createTime: x.document.createTime || '',
      seq: Number(f.seq?.integerValue) || null, subSeq: Number(f.subSeq?.integerValue) || 0,
      clientId: String(dec.clientId || ''), status: String(dec.status || '').trim(), senderProof: f.senderProof?.stringValue || '',
    });
  }
  return docs;
}

const num = (d) => (d.seq ? `#${d.seq}${d.subSeq ? `.${d.subSeq}` : ''}` : d.id);

async function main(argv) {
  const ignote = argv.filter((a) => a !== '--dry-run');
  if (ignote.length) { console.error(`USO: npm run feedback:ripasso [-- --dry-run] (non capito: ${ignote.join(' ')})`); return 1; }
  const dryRun = argv.includes('--dry-run');
  const letture = contatoreLetture();
  const adesso = Date.now();
  let bearer;
  let docs;
  try {
    bearer = await acquireBearer();
    docs = await leggiTutti(bearer, letture);
  } catch (e) {
    console.error(`RIFIUTATO: ${String((e && e.message) || e)}`);
    return e && e.codice === 3 ? 3 : 4;
  }
  const soglia = sogliaDellaProva(docs, adesso);
  const { promossi, saltati } = candidatiAlRipasso(docs, soglia);
  const sessioni = promossi.filter((d) => /^local:/i.test(d.clientId)).length;
  console.log(`Nati prima della prova (${new Date(soglia).toISOString()}): ${promossi.length} feedback, ${sessioni} di sessioni locali e ${promossi.length - sessioni} dell'owner.`);
  for (const s of saltati) console.log(`  lasciati senza prova: ${s.n} (${s.motivo})`);
  if (promossi.length) console.log(`  ${promossi.map(num).join(' ')}`);
  if (dryRun || !promossi.length) {
    console.log(dryRun ? '(prova a vuoto: non ho scritto niente)' : 'Niente da ripassare.');
    console.log(letture.riga());
    return 0;
  }
  let scritti = 0;
  for (const d of promossi) {
    const res = await fetch(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(d.id)}?updateMask.fieldPaths=senderProof`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ fields: { senderProof: { stringValue: 'admin' } } }),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e && e.message) }));
    if (!res.ok) {
      const regole = res.status === 403 ? ' Le regole deployate non ammettono ancora il campo: deploya firestore.rules e rilancia.' : '';
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
