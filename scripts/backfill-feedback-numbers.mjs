// Assegna il numero progressivo (#1, #2, …) ai feedback ESISTENTI che non ne
// hanno ancora uno. Da eseguire UNA VOLTA, in locale dall'owner, dopo
// l'introduzione della numerazione: i feedback nuovi si numerano da soli
// all'invio.
//
// Ordina per createdAt crescente, così i numeri rispecchiano l'ordine storico
// di arrivo. I documenti che hanno già `seq` restano intatti; la numerazione
// dei nuovi parte dal max esistente + 1.
//
// USO:
//   node scripts/backfill-feedback-numbers.mjs            applica
//   node scripts/backfill-feedback-numbers.mjs --dry-run  mostra cosa farebbe
//   npm run feedback:backfill                             lo stesso, dal manifesto
//
// Serve il token admin dell'owner (vedi scripts/admin-login.mjs), ed è l'unica
// strada rimasta: non c'è più modo di farlo eseguire da un'automazione.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { acquireBearer, FIRESTORE_BASE, FIREBASE_API_KEY } from './lib/firestore-auth.mjs';

// #583: i numeri nuovi escono da `counters/feedbackSeq`. Chi ne assegna a mano
// deve rimettere il contatore in pari, o i prossimi invii ripartirebbero da un
// numero già usato.
const require = createRequire(import.meta.url);
require(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'shared', 'feedback.js'));
const FB = globalThis.SN_FEEDBACK;

function intField(doc, name) {
  const v = doc?.fields?.[name];
  const n = v && 'integerValue' in v ? Number(v.integerValue) : NaN;
  return Number.isInteger(n) ? n : 0;
}

function strField(doc, name) {
  return doc?.fields?.[name]?.stringValue || '';
}

async function listAll(bearer) {
  // runQuery ordinato per createdAt ASC: i feedback più vecchi prendono i
  // numeri più bassi. 1000 è ben oltre il volume attuale dell'alpha.
  // La lettura della collezione vuole le credenziali dell'owner (#583)
  // (anche il giro a vuoto: leggere è già un'operazione con credenziali).
  const headers = { 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`${FIRESTORE_BASE}:runQuery?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'feedback' }],
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }],
        limit: 1000,
      },
    }),
  });
  if (!res.ok) throw new Error(`firestore query fallita (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const arr = await res.json();
  return arr.filter((r) => r.document).map((r) => r.document);
}

async function patchSeq(id, seq, bearer) {
  const qs = 'updateMask.fieldPaths=seq&updateMask.fieldPaths=subSeq';
  const res = await fetch(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(id)}?${qs}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ fields: { seq: { integerValue: String(seq) }, subSeq: { integerValue: '0' } } }),
  });
  return { ok: res.ok, status: res.status, body: res.ok ? '' : (await res.text()).slice(0, 200) };
}

// Esegue il backfill. `dry` = solo lettura, nessuna scrittura. Le credenziali
// servono in entrambi i casi: dal 2026-09 (#583) la collezione dei feedback non
// si legge senza (il vecchio dry-run senza bearer si prendeva un 403).
async function backfillNumbers(bearer, { dry = false } = {}) {
  const docs = await listAll(bearer || '');
  const withSeq = docs.filter((d) => intField(d, 'seq') > 0);
  const missing = docs.filter((d) => intField(d, 'seq') === 0);
  let next = withSeq.reduce((m, d) => Math.max(m, intField(d, 'seq')), 0) + 1;

  console.log(`${docs.length} feedback totali: ${withSeq.length} già numerati, ${missing.length} da numerare (si parte da #${next}).`);
  let failures = 0;
  for (const d of missing) {
    const id = d.name.split('/').pop();
    const label = strField(d, 'name') || strField(d, 'text').slice(0, 50).replace(/\s+/g, ' ');
    if (dry) {
      console.log(`  • #${next++} → ${id}  «${label}»`);
      continue;
    }
    const r = await patchSeq(id, next, bearer);
    if (r.ok) console.log(`  ✓ #${next++} → ${id}  «${label}»`);
    else { console.error(`  ✗ ${id}: HTTP ${r.status} ${r.body}`); failures++; }
  }
  // Il contatore da cui i feedback nuovi prendono il numero: se questo giro ha
  // assegnato numeri più alti, va allineato (#583).
  const maxSeq = Math.max(next - 1, withSeq.reduce((m, d) => Math.max(m, intField(d, 'seq')), 0));
  if (!dry && maxSeq > 0) {
    try {
      const v = await FB.ensureSeqCounter(maxSeq, { idToken: bearer });
      console.log(`Contatore dei numeri allineato a ${v}.`);
    } catch (e) {
      console.error(`  ! contatore dei numeri non allineato: ${e?.message || e}`);
    }
  }
  return { total: docs.length, numbered: missing.length - failures, failures, dry };
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  // Un'opzione che non riconosciamo non deve far partire il giro VERO: basta
  // un trattino o una lettera sbagliati in «--dry-run» perché quello che
  // doveva essere un giro a vuoto scriva davvero (feedback #565).
  if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
    console.log([
      'Uso: node scripts/backfill-feedback-numbers.mjs [--dry-run]',
      '  assegna i numeri ai feedback che non ce l\'hanno; --dry-run mostra solo cosa farebbe',
    ].join('\n'));
    process.exit(0);
  }
  const { controllaArgomenti, argomentiDaNpm, opzioneStorpiata } = await import('./lib/argomenti.mjs');
  // Vedi auto-archive: le opzioni mangiate da npm si riprendono dall'ambiente
  // (feedback #565).
  const storpiata = opzioneStorpiata(process.env, ['--dry-run']);
if (storpiata) { console.error(`RIFIUTATO: ${storpiata}`); process.exit(1); }
const daNpm = argomentiDaNpm(process.env, { opzioni: ['--dry-run'] });
  if (daNpm.nota) { console.error(daNpm.nota); process.argv.push(...daNpm.args); }
  const male = controllaArgomenti(process.argv.slice(2), { opzioni: ['--dry-run'], senzaParoleLibere: true });
  if (male) {
    console.error(`RIFIUTATO: ${male}`);
    process.exit(1);
  }
  const DRY = process.argv.includes('--dry-run');
  try {
    const bearer = await acquireBearer();
    const r = await backfillNumbers(bearer, { dry: DRY });
    console.log(DRY ? '\nDry-run: nessuna scrittura.' : `\nFatto${r.failures ? ` (${r.failures} falliti)` : ''}.`);
    if (r.failures) process.exit(1);
  } catch (e) {
    console.error('Errore:', e.message);
    process.exit(1);
  }
}
