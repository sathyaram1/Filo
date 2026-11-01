// Le novità riscritte dal redattore (SPEC-MANUTENTORE § 8) al posto delle righe dei worker, in locale nell'albero che
// si costruisce, come il numero di versione: niente commit. Non ferma mai la pubblicazione: senza risposta restano le
// righe dei worker, con l'avviso. Autosufficiente (Mac e Linux lo copiano fuori dalla copia di lavoro). Prove: tests/unit/releaseNovita.test.mjs.
//
// USO   node scripts/release-novita.mjs <X.Y.Z | vX.Y.Z>   (nella cartella del progetto, con FILO_BUILD_PASSPHRASE)

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

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

/** Il registro NOTES di un testo di patchNotes.js, eseguito a parte. → array | null. */
export function leggiNote(sorgente) {
  try {
    const ctx = vm.createContext({});
    vm.runInContext(String(sorgente), ctx, { timeout: 5000 });
    const n = ctx.SN_PATCH_NOTES && ctx.SN_PATCH_NOTES.NOTES;
    return Array.isArray(n) ? JSON.parse(JSON.stringify(n)) : null;
  } catch (_) { return null; }
}

/** [inizio, fine) dell'oggetto letterale del blocco `versione`, dalla graffa aperta a quella chiusa; null se non c'è. PURA. */
export function intervalloDelBlocco(sorgente, versione) {
  const s = String(sorgente);
  const re = new RegExp(`version:\\s*['"]${String(versione).replace(/\./g, '\\.')}['"]`, 'g');
  const m = re.exec(s);
  if (!m || re.exec(s)) return null;
  let i = m.index - 1;
  while (i >= 0 && /\s/.test(s[i])) i--;
  if (s[i] !== '{') return null;
  let prof = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "'" || c === '"' || c === '`') {
      for (j++; j < s.length && s[j] !== c; j++) if (s[j] === '\\') j++;
      continue;
    }
    if (c === '/' && s[j + 1] === '/') { while (j < s.length && s[j] !== '\n') j++; continue; }
    if (c === '/' && s[j + 1] === '*') { j = s.indexOf('*/', j + 2); if (j < 0) return null; j++; continue; }
    if (c === '{') prof++;
    else if (c === '}' && --prof === 0) return [i, j + 1];
  }
  return null;
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
  const riga = (r) => (typeof r === 'string' ? JSON.stringify(r) : `{ testo: ${JSON.stringify(r.testo)}, segnalazione: ${r.segnalazione} }`);
  const lista = (nome, l) => (l.length ? `${r1}${nome}: [\n${l.map((r) => `${r2}${riga(r)},\n`).join('')}${r1}],\n` : `${r1}${nome}: [],\n`);
  const altre = Object.keys(blocco).filter((k) => !['version', 'features', 'fixes'].includes(k))
    .map((k) => `${k}: ${JSON.stringify(blocco[k])}`);
  return `{\n${r1}${[`version: ${JSON.stringify(blocco.version)}`, ...altre].join(', ')},\n${lista('features', blocco.features)}${lista('fixes', blocco.fixes)}${rientro}}`;
}

const canonico = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/**
 * Il testo di patchNotes.js con le riscritture `tutte` messe nei loro blocchi. Il risultato si rilegge: se il registro
 * non torna esattamente quello atteso, non si scrive niente. → { ok, testo, applicate, saltate } | { ok:false, reason }. PURA.
 */
export function applicaNovita(sorgente, tutte) {
  const prima = leggiNote(sorgente);
  if (!prima) return { ok: false, reason: 'il registro delle novità di questo albero non si legge' };
  const attese = prima.map((b) => ({ ...b }));
  let testo = String(sorgente);
  const applicate = [];
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
    const i = attese.findIndex((b) => b.version === versione);
    const dove = i < 0 ? null : intervalloDelBlocco(testo, versione);
    if (!dove) { saltate.push({ versione, perche: i < 0 ? 'il blocco non c’è in questo albero' : 'il blocco non si ritrova nel testo' }); continue; }
    const nuovo = { ...attese[i], ...righeDopo(attese[i], { features, fixes, originali: t.originali }) };
    const inizioRiga = testo.lastIndexOf('\n', dove[0]) + 1;
    const rientro = (/^[ \t]*/.exec(testo.slice(inizioRiga, dove[0])) || [''])[0];
    testo = testo.slice(0, dove[0]) + testoDelBlocco(nuovo, rientro) + testo.slice(dove[1]);
    attese[i] = nuovo;
    applicate.push(versione);
  }
  if (!applicate.length) return { ok: true, testo: String(sorgente), applicate, saltate };
  if (canonico(leggiNote(testo)) !== canonico(attese)) return { ok: false, reason: 'riscritto, il registro non torna quello atteso' };
  return { ok: true, testo, applicate, saltate };
}

/** La domanda al server, sempre con un esito e mai un'eccezione. */
export async function chiediNovita({ passphrase, versione, fetchImpl = fetch, url = RELEASE_NOVITA_URL, attesaMs = ATTESA_MS } = {}) {
  if (!passphrase) return { outcome: 'no_passphrase' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), attesaMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase, versione }),
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
  if (a.applicate.length) writeFileSync(file, a.testo);
  console.log(`[release-novita] ${versione}: ${r.novita ? 'riscritte dal redattore' : 'le righe dei worker (nessuna riscrittura)'}; blocchi riscritti in questo albero: ${a.applicate.length ? a.applicate.join(', ') : 'nessuno'} (niente commit).`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().then((c) => { process.exitCode = c; }, (e) => { avviso(`guasto (${(e && e.message) || e})`); process.exitCode = 0; });
}
