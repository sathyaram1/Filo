// Le novità riscritte dal redattore (SPEC-MANUTENTORE § 8) al posto delle righe dei worker, in locale nell'albero che
// si costruisce: niente commit, e la pubblicazione non si ferma mai (senza risposta restano le righe dei worker, con
// l'avviso). Gira con la parola della costruzione: patchNotes.js lo LEGGE come dato, mai eseguito. Prove: tests/unit/releaseNovita.test.mjs.
//
// USO   node scripts/release-novita.mjs <X.Y.Z | vX.Y.Z>   (nella cartella del progetto, con FILO_BUILD_PASSPHRASE)

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.FILO_ROUTINE_API || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';
export const RELEASE_NOVITA_URL = `${BASE}/releaseNovita`;
// Un server appeso non deve tenere ferma la costruzione: oltre si esce con le righe dei worker.
const ATTESA_MS = 60000;
const VERSIONE_RE = /^\d{1,4}\.\d{1,4}\.\d{1,5}$/;

/** L'impronta di una riga, la stessa di SN_PATCH_NOTES.impronta (FNV-1a sul testo). PURA. */
export function impronta(r) {
  const s = r && typeof r === 'object' ? String(r.testo || '') : String(r == null ? '' : r);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

// Il letterale di NOTES: liste, oggetti, stringhe, numeri, true/false/null, commenti e virgole finali. Qualunque altra
// cosa (un'espressione, un template con ${}) ferma la lettura: meglio le righe dei worker che un registro letto male.
function letterale(s, inizio) {
  let i = inizio;
  const guasto = (cosa) => { throw new Error(`${cosa} al carattere ${i}`); };
  const salta = () => {
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s.startsWith('//', i)) { const n = s.indexOf('\n', i); i = n < 0 ? s.length : n; } else if (s.startsWith('/*', i)) {
        const n = s.indexOf('*/', i + 2);
        if (n < 0) guasto('commento aperto');
        i = n + 2;
      } else return;
    }
  };
  const esadecimali = (n) => {
    const h = s.slice(i, i + n);
    if (!new RegExp(`^[0-9a-fA-F]{${n}}$`).test(h)) guasto('sequenza esadecimale');
    i += n;
    return parseInt(h, 16);
  };
  const SEMPLICI = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' };
  const stringa = () => {
    const q = s[i++];
    let out = '';
    while (i < s.length && s[i] !== q) {
      const c = s[i++];
      if (c === '$' && q === '`' && s[i] === '{') guasto('template con espressioni');
      if ((c === '\n' || c === '\r') && q !== '`') guasto('a capo in una stringa');
      if (c !== '\\') { out += c; continue; }
      const e = s[i++];
      if (e === 'x') out += String.fromCharCode(esadecimali(2));
      else if (e === 'u' && s[i] === '{') {
        const n = s.indexOf('}', i);
        const h = n < 0 ? '' : s.slice(i + 1, n);
        if (!/^[0-9a-fA-F]{1,6}$/.test(h) || parseInt(h, 16) > 0x10ffff) guasto('\\u{} malformato');
        out += String.fromCodePoint(parseInt(h, 16));
        i = n + 1;
      } else if (e === 'u') out += String.fromCharCode(esadecimali(4));
      else if (e === '0' && !/\d/.test(s[i] || '')) out += '\0';
      else if (/\d/.test(e)) guasto('sequenza ottale');
      else if (e === '\r') { if (s[i] === '\n') i++; } else if (e === '\n' || e === ' ' || e === ' ') { /* a capo continuato */ } else out += SEMPLICI[e] || e;
    }
    if (s[i] !== q) guasto('stringa aperta');
    i++;
    return out;
  };
  const valore = () => {
    salta();
    const c = s[i];
    if (c === '[') {
      i++;
      const v = [];
      const posti = [];
      for (;;) {
        salta();
        if (s[i] === ']') { i++; return { v, posti }; }
        const a = i;
        v.push(valore().v);
        posti.push([a, i]);
        salta();
        if (s[i] === ',') i++;
        else if (s[i] !== ']') guasto('lista');
      }
    }
    if (c === '{') {
      i++;
      const v = {};
      for (;;) {
        salta();
        if (s[i] === '}') { i++; return { v }; }
        let k;
        if (s[i] === "'" || s[i] === '"') k = stringa();
        else {
          const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i, i + 200));
          if (!m) guasto('chiave');
          k = m[0];
          i += k.length;
        }
        if (k === '__proto__') guasto('chiave __proto__');
        salta();
        if (s[i] !== ':') guasto('due punti');
        i++;
        v[k] = valore().v;
        salta();
        if (s[i] === ',') i++;
        else if (s[i] !== '}') guasto('oggetto');
      }
    }
    if (c === "'" || c === '"' || c === '`') return { v: stringa() };
    const m = /^(?:-?\d+(?:\.\d+)?|true|false|null)(?![\w$])/.exec(s.slice(i, i + 40));
    if (!m) guasto('valore');
    i += m[0].length;
    return { v: JSON.parse(m[0]) };
  };
  return valore();
}

/** Il registro NOTES di un testo di patchNotes.js, letto senza eseguirlo: { note, posti } | null. PURA. */
export function leggiNote(sorgente) {
  const s = String(sorgente);
  const m = /\bconst\s+NOTES\s*=\s*\[/.exec(s);
  if (!m) return null;
  try {
    const r = letterale(s, m.index + m[0].length - 1);
    return Array.isArray(r.v) ? { note: r.v, posti: r.posti } : null;
  } catch (_) { return null; }
}

/** Una riga del server com'è nel registro: testo, o { testo, segnalazione }; null se non è nessuna delle due. PURA. */
function rigaValida(r) {
  if (typeof r === 'string') return r.trim() ? r : null;
  if (!r || typeof r !== 'object' || typeof r.testo !== 'string' || !r.testo.trim()) return null;
  return Number.isInteger(r.segnalazione) && r.segnalazione > 0 ? { testo: r.testo, segnalazione: r.segnalazione } : null;
}

/** Le righe di un blocco dopo la riscrittura: le riscritte, poi quelle che il redattore non ha visto (fuse dopo). PURA. */
export function righeDopo(blocco, riscrittura) {
  const viste = new Set(Array.isArray(riscrittura.originali) ? riscrittura.originali : []);
  // Senza impronte la riscrittura copre tutto il blocco.
  const restano = (l) => (viste.size ? (l || []).filter((r) => !viste.has(impronta(r))) : []);
  return {
    features: [...riscrittura.features, ...restano(blocco.features)],
    fixes: [...riscrittura.fixes, ...restano(blocco.fixes)],
  };
}

function testoDelBlocco(blocco, rientro) {
  const r1 = `${rientro}  `;
  const r2 = `${rientro}    `;
  const chiave = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
  const riga = (r) => (typeof r === 'string' ? JSON.stringify(r) : `{ testo: ${JSON.stringify(r.testo)}, segnalazione: ${r.segnalazione} }`);
  const lista = (nome, l) => (l.length ? `${r1}${nome}: [\n${l.map((r) => `${r2}${riga(r)},\n`).join('')}${r1}],\n` : `${r1}${nome}: [],\n`);
  const altre = Object.keys(blocco).filter((k) => !['version', 'features', 'fixes'].includes(k))
    .map((k) => `${chiave(k)}: ${JSON.stringify(blocco[k])}`);
  return `{\n${r1}${[`version: ${JSON.stringify(blocco.version)}`, ...altre].join(', ')},\n${lista('features', blocco.features)}${lista('fixes', blocco.fixes)}${rientro}}`;
}

const canonico = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/**
 * Il testo di patchNotes.js con le riscritture `tutte` messe nei loro blocchi. Il risultato si rilegge: se il registro
 * non torna esattamente quello atteso, non si scrive niente. → { ok, testo, applicate, saltate } | { ok:false, reason }. PURA.
 */
export function applicaNovita(sorgente, tutte) {
  const s = String(sorgente);
  const letto = leggiNote(s);
  if (!letto) return { ok: false, reason: 'il registro delle novità di questo albero non si legge' };
  const attese = letto.note.slice();
  const cambi = [];
  const saltate = [];
  for (const t of Array.isArray(tutte) ? tutte : []) {
    const versione = String((t && t.versione) || '');
    const righe = (k) => (t && t[k] === undefined ? [] : Array.isArray(t && t[k]) ? t[k].map(rigaValida) : [null]);
    const features = righe('features');
    const fixes = righe('fixes');
    if (!VERSIONE_RE.test(versione) || features.includes(null) || fixes.includes(null) || !(features.length + fixes.length)) {
      saltate.push({ versione, perche: 'riscrittura malformata' });
      continue;
    }
    const i = attese.findIndex((b) => b && b.version === versione);
    if (i < 0) { saltate.push({ versione, perche: 'il blocco non c’è in questo albero' }); continue; }
    if (cambi.some((c) => c.i === i)) { saltate.push({ versione, perche: 'due riscritture per lo stesso blocco' }); continue; }
    // Il redattore ha letto righe che qui non ci sono (fuse dopo il commit che si costruisce): racconterebbe cose che
    // questa versione non ha.
    const qui = new Set([...(attese[i].features || []), ...(attese[i].fixes || [])].map(impronta));
    const mancanti = (Array.isArray(t.originali) ? t.originali : []).filter((h) => !qui.has(h));
    if (mancanti.length) { saltate.push({ versione, perche: `copre ${mancanti.length} righe che questo albero non ha`, copreAltro: true }); continue; }
    attese[i] = { ...attese[i], ...righeDopo(attese[i], { features, fixes, originali: t.originali }) };
    cambi.push({ i, versione });
  }
  if (!cambi.length) return { ok: true, testo: s, applicate: [], saltate };
  let testo = s;
  for (const { i } of cambi.slice().sort((a, b) => letto.posti[b.i][0] - letto.posti[a.i][0])) {
    const [da, a] = letto.posti[i];
    const rientro = (/[ \t]*$/.exec(s.slice(s.lastIndexOf('\n', da - 1) + 1, da)) || [''])[0];
    testo = testo.slice(0, da) + testoDelBlocco(attese[i], rientro) + testo.slice(a);
  }
  const riletto = leggiNote(testo);
  if (!riletto || canonico(riletto.note) !== canonico(attese)) return { ok: false, reason: 'riscritto, il registro non torna quello atteso' };
  return { ok: true, testo, applicate: cambi.map((c) => c.versione), saltate };
}

/** La domanda al server, sempre con un esito e mai un'eccezione. */
export async function chiediNovita({ passphrase, versione, scarta = false, fetchImpl = fetch, url = RELEASE_NOVITA_URL, attesaMs = ATTESA_MS } = {}) {
  if (!passphrase) return { outcome: 'no_passphrase' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), attesaMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase, versione, ...(scarta ? { scarta: true } : {}) }),
      signal: ac.signal,
    });
    let body = {};
    try { body = await res.json(); } catch (_) { body = {}; }
    if (res.status === 200 && body && body.ok === true) {
      return { outcome: 'done', novita: body.novita || null, tutte: Array.isArray(body.tutte) ? body.tutte : (body.novita ? [body.novita] : []), troncato: body.troncato || 0 };
    }
    const reason = String((body && body.reason) || '') || `http_${res.status}`;
    if (res.status === 404) return { outcome: 'not_deployed', reason };
    if (res.status === 401 || res.status === 403 || reason === 'bad_passphrase') return { outcome: 'denied', reason };
    return { outcome: 'unreachable', reason };
  } catch (e) {
    return { outcome: 'unreachable', reason: ac.signal.aborted ? `nessuna risposta in ${Math.round(attesaMs / 1000)} s` : String((e && e.message) || e) };
  } finally { clearTimeout(timer); }
}

const avviso = (t) => console.log(`::warning::novità: ${t}. Escono le righe dei worker.`);

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), env = process.env, fetchImpl = fetch, url = RELEASE_NOVITA_URL } = {}) {
  const versione = String(argv[0] || '').trim().replace(/^v/, '');
  if (!VERSIONE_RE.test(versione)) { avviso(`numero di versione malformato («${argv[0] || ''}»)`); return 0; }
  const file = resolve(cwd, 'src', 'shared', 'patchNotes.js');
  let sorgente;
  try { sorgente = readFileSync(file, 'utf8'); } catch (e) { avviso(`il registro delle novità non si legge (${e.message})`); return 0; }
  const r = await chiediNovita({ passphrase: env.FILO_BUILD_PASSPHRASE, versione, fetchImpl, url });
  if (r.outcome !== 'done') {
    const perche = { no_passphrase: 'manca FILO_BUILD_PASSPHRASE', denied: 'il server non riconosce la parola d’ordine della costruzione', not_deployed: 'il server non espone ancora le novità del redattore' }[r.outcome];
    avviso(perche || `il server non ha risposto (${r.reason})`);
    return 0;
  }
  if (r.troncato) console.log(`::warning::novità: il server ne ha ${r.troncato}, ne ha mandate ${r.tutte.length}: le versioni più vecchie restano con le righe dei worker.`);
  const a = applicaNovita(sorgente, r.tutte);
  if (!a.ok) { avviso(a.reason); return 0; }
  for (const s of a.saltate) console.log(`::warning::novità della ${s.versione || '?'} non messe: ${s.perche}.`);
  // Quella di questa versione, non messa, non deve uscire dopo: chi aggiorna adesso legge le righe dei worker.
  if (a.saltate.some((s) => s.copreAltro && s.versione === versione)) {
    const sc = await chiediNovita({ passphrase: env.FILO_BUILD_PASSPHRASE, versione, scarta: true, fetchImpl, url });
    if (sc.outcome !== 'done') console.log(`::warning::novità della ${versione}: il server non ha saputo che non sono uscite (${sc.reason || sc.outcome}); una costruzione dopo le metterebbe.`);
  }
  if (a.applicate.length) writeFileSync(file, a.testo);
  console.log(`[release-novita] ${versione}: ${r.novita ? 'riscritte dal redattore' : 'le righe dei worker (nessuna riscrittura)'}; blocchi riscritti in questo albero: ${a.applicate.length ? a.applicate.join(', ') : 'nessuno'} (niente commit).`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then((c) => { process.exitCode = c; }, (e) => { avviso(`guasto (${(e && e.message) || e})`); process.exitCode = 0; });
}
