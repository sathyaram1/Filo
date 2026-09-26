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
import { contaDocumenti } from './lib/firestore-conta.mjs';
import { contatoreLetture } from './lib/letture.mjs';
import { scansione, dopoApplicazione } from './lib/scansione-secco.mjs';

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

// La data d'invio, qualunque forma abbia sul documento.
//
// Firestore non ha UN modo di dire "data": `createdAt` lo scrive l'app come
// `timestampValue`, ma i feedback più vecchi della migrazione ce l'hanno come
// `stringValue` ISO, e qualche riga importata come `integerValue` di
// millisecondi. Un lettore che ne guarda una sola torna vuoto sugli altri, e
// una stringa vuota non si lamenta: si mette in fila con le altre stringhe
// vuote e l'ordinamento diventa un nastro fermo. È quello che è successo
// quando l'ordine per data è passato dal database a qui (verifica #583, giro
// 7): tutti i confronti davano zero e i numeri uscivano nell'ordine interno
// del database, cioè a caso. Chi legge una data da un documento grezzo passa
// da qui.
export function dataDiArrivo(doc) {
  const v = doc?.fields?.createdAt;
  if (!v) return NaN;
  if (typeof v.timestampValue === 'string') return Date.parse(v.timestampValue);
  if (typeof v.stringValue === 'string') return Date.parse(v.stringValue);
  if (v.integerValue != null) return Number(v.integerValue);
  if (v.doubleValue != null) return Number(v.doubleValue);
  return NaN;
}

// I più vecchi davanti: è la promessa del comando, «i numeri più bassi alle
// segnalazioni arrivate prima». Una data che non si legge non deve scavalcare
// nessuno, quindi va in fondo invece di valere zero (che vorrebbe dire 1970);
// a parità di data decide il nome del documento, così due giri di fila danno
// lo stesso risultato.
export function ordinaPerArrivo(docs) {
  return (Array.isArray(docs) ? docs.slice() : []).sort((a, b) => {
    const ta = dataDiArrivo(a);
    const tb = dataDiArrivo(b);
    const va = Number.isFinite(ta);
    const vb = Number.isFinite(tb);
    if (va && vb && ta !== tb) return ta - tb;
    if (va !== vb) return va ? -1 : 1;
    return String(a?.name || '').localeCompare(String(b?.name || ''));
  });
}

// ── Cosa si scarica per NUMERARE ─────────────────────────────────────────────
// Quattro campi: la data d'arrivo (l'ordine dei numeri), il numero che c'è già,
// e il titolo per la riga che si stampa. Il testo della segnalazione — cifrato,
// qualche KB, più note e allegati — qui non serve a niente, e moltiplicato per
// la collezione intera era il conto di Firestore di settembre 2026 (#680).
export const CAMPI_NUMERAZIONE = ['name', 'createdAt', 'seq', 'subSeq'];

// Il nome con cui la lettura si mette da parte fra la prova a secco e
// l'applicazione (lib/scansione-secco).
const COPIA = 'backfill-feedback-numbers/segnalazioni';

/**
 * Quanti sono, e quanti hanno già un numero. Due conteggi chiesti al server
 * costano una lettura ogni mille documenti; scaricare la collezione per contarla
 * ne costa una a testa. Se i due numeri combaciano non c'è niente da numerare e
 * la scansione non si fa nemmeno.
 * `seq >= 1` e non `>= 0`: uno `seq` a zero, per questo comando, è un feedback
 * SENZA numero (`intField(d, 'seq') > 0`), e i due criteri devono coincidere.
 */
async function conteggi(bearer, fetchImpl = fetch) {
  const comune = { bearer, fetchImpl };
  const [totale, numerati] = await Promise.all([
    contaDocumenti(FIRESTORE_BASE, FIREBASE_API_KEY, 'feedback', comune),
    contaDocumenti(FIRESTORE_BASE, FIREBASE_API_KEY, 'feedback', {
      ...comune, filtro: { field: 'seq', op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: '1' } },
    }),
  ]);
  return { totale, numerati };
}

async function listAll(bearer) {
  // TUTTI i feedback, paginati con un cursore sul nome del documento, poi
  // ordinati per data d'invio crescente (i più vecchi prendono i numeri più
  // bassi). Prima si chiedevano i primi mille e si trattavano come tutti: il
  // giorno che il tetto si tocca, i feedback oltre il millesimo non prendono un
  // numero e nessuno lo dice — e i numeri qui si assegnano contando quelli che
  // ci sono, quindi da un elenco parziale escono numeri già presi.
  // La lettura della collezione vuole le credenziali dell'owner (#583)
  // (anche il giro a vuoto: leggere è già un'operazione con credenziali).
  const headers = { 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const PAGINA = 500;
  const MAX_PAGINE = 40;
  const docs = [];
  const visti = new Set();
  let cursore = '';
  let completo = false;
  for (let i = 0; i < MAX_PAGINE; i += 1) {
    const structuredQuery = {
      from: [{ collectionId: 'feedback' }],
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: PAGINA,
    };
    if (cursore) structuredQuery.startAt = { before: false, values: [{ referenceValue: cursore }] };
    structuredQuery.select = { fields: CAMPI_NUMERAZIONE.map((f) => ({ fieldPath: f })) };
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(`${FIRESTORE_BASE}:runQuery?key=${FIREBASE_API_KEY}`, {
      method: 'POST', headers, body: JSON.stringify({ structuredQuery }),
    });
    // eslint-disable-next-line no-await-in-loop
    if (!res.ok) throw new Error(`firestore query fallita (${res.status}): ${(await res.text()).slice(0, 200)}`);
    // eslint-disable-next-line no-await-in-loop
    const arr = (await res.json()).filter((r) => r.document).map((r) => r.document);
    let nuovi = 0;
    for (const d of arr) {
      if (!d.name || visti.has(d.name)) continue;
      visti.add(d.name);
      docs.push(d);
      nuovi += 1;
    }
    const ultimo = arr.length ? arr[arr.length - 1].name : '';
    if (arr.length < PAGINA || nuovi === 0 || !ultimo || ultimo === cursore) { completo = true; break; }
    cursore = ultimo;
  }
  // Un elenco parziale qui produce numeri sbagliati: meglio fermarsi.
  if (!completo) {
    throw new Error(`non sono riuscito a leggere TUTTI i feedback (fermato a ${docs.length}): `
      + 'con un elenco parziale i numeri assegnati sarebbero già presi.');
  }
  return ordinaPerArrivo(docs);
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
export async function backfillNumbers(bearer, { dry = false, now = Date.now(), copiaDir = null, usaCopia = true } = {}) {
  const letture = contatoreLetture();

  // Prima si CHIEDE quanti sono, invece di scaricarli per contarli: se tutti
  // hanno già un numero questo comando non ha niente da fare, e scoprirlo
  // costava una lettura per segnalazione — la raffica del 18/09 (#680).
  const conto = await conteggi(bearer || '');
  if (Number.isFinite(conto.totale) && Number.isFinite(conto.numerati) && conto.totale === conto.numerati) {
    letture.aggiungi(2, 'conteggi');
    const max = await FB.maxSeq({ idToken: bearer || '' });
    letture.aggiungi(1, 'numero più alto');
    const maxSeq = Number.isInteger(max) ? max : 0;
    console.log(`${conto.totale} feedback totali: ${conto.numerati} già numerati, 0 da numerare (si parte da #${maxSeq + 1}).`);
    await allineaContatore(maxSeq, bearer, dry);
    console.log(letture.riga());
    return { total: conto.totale, numbered: 0, failures: 0, dry, letture: letture.totale };
  }
  if (!Number.isFinite(conto.totale) || !Number.isFinite(conto.numerati)) {
    console.warn('AVVISO: il server non ha saputo contare i feedback: scansiono la collezione (una lettura per segnalazione).');
  }

  const { dati: docs } = await scansione({
    nome: COPIA, dry, now, dir: copiaDir, usaCopia,
    scansiona: async () => {
      const letti = await listAll(bearer || '');
      letture.aggiungi(letti.length, 'segnalazioni');
      return letti;
    },
  });
  const withSeq = docs.filter((d) => intField(d, 'seq') > 0);
  const missing = docs.filter((d) => intField(d, 'seq') === 0);
  let next = withSeq.reduce((m, d) => Math.max(m, intField(d, 'seq')), 0) + 1;

  console.log(`${docs.length} feedback totali: ${withSeq.length} già numerati, ${missing.length} da numerare (si parte da #${next}).`);
  let failures = 0;
  for (const d of missing) {
    const id = d.name.split('/').pop();
    // Il titolo, se c'è: il testo della segnalazione non si scarica più (#680),
    // quindi il ripiego è l'id, che la riga stampa comunque.
    const label = strField(d, 'name') || '(senza titolo)';
    if (dry) {
      console.log(`  • #${next++} → ${id}  «${label}»`);
      continue;
    }
    const r = await patchSeq(id, next, bearer);
    if (r.ok) console.log(`  ✓ #${next++} → ${id}  «${label}»`);
    else { console.error(`  ✗ ${id}: HTTP ${r.status} ${r.body}`); failures++; }
  }
  const maxSeq = Math.max(next - 1, withSeq.reduce((m, d) => Math.max(m, intField(d, 'seq')), 0));
  await allineaContatore(maxSeq, bearer, dry);
  // Applicato: i numeri sul server non sono più quelli che la copia descrive.
  dopoApplicazione(COPIA, { dry, usaCopia, dir: copiaDir });
  console.log(letture.riga());
  return { total: docs.length, numbered: missing.length - failures, failures, dry, letture: letture.totale };
}

// Il contatore da cui i feedback nuovi prendono il numero: se un giro ha
// assegnato numeri più alti, va allineato o i prossimi invii ripartirebbero da
// un numero già usato (#583).
async function allineaContatore(maxSeq, bearer, dry) {
  if (dry || !(maxSeq > 0)) return;
  try {
    const v = await FB.ensureSeqCounter(maxSeq, { idToken: bearer });
    console.log(`Contatore dei numeri allineato a ${v}.`);
  } catch (e) {
    console.error(`  ! contatore dei numeri non allineato: ${e?.message || e}`);
  }
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
