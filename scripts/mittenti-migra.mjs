// mittenti-migra.mjs — la classe del mittente sui feedback che non ce l'hanno (SPEC-DOMANDE.md §10, #1162). La regola
// e le scritture le fa il server (ownerMittenti {op:'migra'}), qui solo i lotti, con le credenziali dell'owner.
// Uso: npm run mittenti:migra (a secco, conta e basta) | npm run mittenti:migra -- --dal-vero. Prove: tests/unit/mittentiMigra.test.mjs.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const BASE = process.env.FILO_FUNCTIONS_BASE || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';
export const OWNER_MITTENTI_URL = `${BASE}/ownerMittenti`;
// 500 per lotto (il server): 20.000 lotti sono dieci milioni di feedback. Oltre ci si ferma e lo si dice.
export const TETTO_LOTTI = 20000;
const ELENCATI = 200;

/** Le parole della riga di comando. PURA. @returns {{ dalVero: boolean } | { errore: string }} */
export function leggiArgomenti(argv) {
  const a = (Array.isArray(argv) ? argv : []).map(String);
  const altri = a.filter((x) => x !== '--dal-vero');
  if (altri.length) return { errore: `"${altri[0]}" non vale qui. Uso: npm run mittenti:migra [-- --dal-vero]` };
  return { dalVero: a.includes('--dal-vero') };
}

/**
 * Tutti i lotti, finché il server non smette di dare `prossimo`. `chiama(data)` → il risultato della callable. Un
 * rifiuto o un errore ferma tutto, coi conti fatti fin lì (si rilancia: chi ha già la classe si salta).
 */
export async function migraTutto({ chiama, dalVero = false, tetto = TETTO_LOTTI, ogniLotto = () => {} } = {}) {
  const tot = { ok: true, dryRun: !dalVero, lotti: 0, perClasse: {}, giaImpostati: 0, illeggibili: 0, illeggibiliIds: [], errori: 0, erroriIds: [] };
  let dopo = '';
  for (;;) {
    if (tot.lotti >= tetto) return Object.assign(tot, { ok: false, motivo: `fermo dopo ${tot.lotti} lotti (il tetto): rilancia per continuare` });
    let r;
    try {
      r = await chiama(Object.assign({ op: 'migra', dryRun: !dalVero }, dopo ? { dopo } : {}));
    } catch (e) {
      return Object.assign(tot, { ok: false, motivo: String((e && e.message) || e) });
    }
    if (!r || r.ok !== true) return Object.assign(tot, { ok: false, motivo: (r && (r.detail || r.reason)) || 'risposta senza esito' });
    tot.lotti += 1;
    for (const [classe, n] of Object.entries(r.perClasse || {})) tot.perClasse[classe] = (tot.perClasse[classe] || 0) + (Number(n) || 0);
    for (const k of ['giaImpostati', 'illeggibili', 'errori']) tot[k] += Number(r[k]) || 0;
    for (const [da, a] of [['illeggibiliIds', 'illeggibiliIds'], ['erroriIds', 'erroriIds']]) {
      for (const id of Array.isArray(r[da]) ? r[da] : []) if (tot[a].length < ELENCATI) tot[a].push(String(id));
    }
    ogniLotto(tot, r);
    const prossimo = String(r.prossimo || '');
    if (!prossimo || prossimo === dopo) return tot;
    dopo = prossimo;
  }
}

/** Una riga col conto, per l'owner. PURA. */
export function rigaConto(t) {
  const come = t.dryRun ? 'A secco' : 'Scritti';
  const classi = Object.entries(t.perClasse).filter(([, n]) => n > 0).map(([c, n]) => `${n} ${c}`).join(', ') || 'nessuno da classificare';
  const elenco = (ids) => (ids.length ? ` (${ids.slice(0, 10).join(', ')}${ids.length > 10 ? ', …' : ''})` : '');
  const illeggibili = t.illeggibili ? `, ${t.illeggibili} con un mittente che non si apre${elenco(t.illeggibiliIds)}` : '';
  const errori = t.errori ? `, ${t.errori} non scritti${elenco(t.erroriIds)}` : '';
  return `${come}: ${classi}; ${t.giaImpostati} avevano già la classe${illeggibili}${errori}. Lotti: ${t.lotti}.`;
}

async function chiamaServer(data, { fetchImpl = fetch, url = OWNER_MITTENTI_URL } = {}) {
  const { findAdminRefreshToken, mintIdToken } = await import('./lib/firestore-auth.mjs');
  const refresh = findAdminRefreshToken();
  if (!refresh) throw new Error('nessuna credenziale admin su questa macchina: node scripts/admin-login.mjs');
  const idToken = await mintIdToken(refresh);
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  let body = {};
  try { body = await res.json(); } catch (_) { body = {}; }
  if (res.status === 404) throw new Error('la funzione ownerMittenti non è ancora pubblicata sul server');
  if (!res.ok) throw new Error((body.error && body.error.message) || `errore ${res.status}`);
  return body.result || {};
}

async function main() {
  const args = leggiArgomenti(process.argv.slice(2));
  if (args.errore) { console.error(args.errore); return 2; }
  console.log(args.dalVero ? 'Classe dei mittenti, dal vero: scrivo solo dove manca.' : 'Classe dei mittenti a secco: conto e basta (--dal-vero per scrivere).');
  const t = await migraTutto({
    chiama: (data) => chiamaServer(data),
    dalVero: args.dalVero,
    ogniLotto: (tot) => console.log(`  lotto ${tot.lotti} fatto`),
  });
  console.log(rigaConto(t));
  if (!t.ok) { console.error(`Interrotta: ${t.motivo}. Rilanciando riparte da capo e salta chi ha già la classe.`); return 1; }
  return t.errori ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(`mittenti-migra: ${String((e && e.message) || e)}`); process.exitCode = 1; });
}
