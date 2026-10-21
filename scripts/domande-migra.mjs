// domande-migra.mjs — le attese aperte prima del #1358 ricevono la loro domanda (SPEC-DOMANDE.md §3.8). Regola e
// scritture le fa il server (ownerDomande {op:'migra'}), qui solo i lotti, con le credenziali dell'owner.
// Uso: npm run domande:migra (a secco, conta e basta) | npm run domande:migra -- --dal-vero. Prove: tests/unit/domandeMigra.test.mjs.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const BASE = process.env.FILO_FUNCTIONS_BASE || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';
export const OWNER_DOMANDE_URL = `${BASE}/ownerDomande`;
// 300 feedback aperti per lotto (il server): 20.000 lotti sono sei milioni. Oltre ci si ferma e lo si dice.
export const TETTO_LOTTI = 20000;

/** Le parole della riga di comando. PURA. @returns {{ dalVero: boolean } | { errore: string }} */
export function leggiArgomenti(argv) {
  const a = (Array.isArray(argv) ? argv : []).map(String);
  const altri = a.filter((x) => x !== '--dal-vero');
  if (altri.length) return { errore: `"${altri[0]}" non vale qui. Uso: npm run domande:migra [-- --dal-vero]` };
  return { dalVero: a.includes('--dal-vero') };
}

/**
 * Tutti i lotti, uno dopo l'altro, finché il server dà `prossimo`. `chiama(data)` → il risultato della callable. Un
 * rifiuto o un errore ferma tutto coi conti fatti fin lì: rilanciando, chi ha già la domanda si salta.
 * @returns {Promise<{ ok: boolean, dryRun: boolean, lotti: number, create: number, gia: number, fuori: number, errori: number, erroriIds: string[], motivo?: string }>}
 */
export async function migraTutto({ chiama, dalVero = false, tetto = TETTO_LOTTI, ogniLotto = () => {} } = {}) {
  const tot = { ok: true, dryRun: !dalVero, lotti: 0, create: 0, gia: 0, fuori: 0, errori: 0, erroriIds: [] };
  let dopo = '';
  for (;;) {
    if (tot.lotti >= tetto) return Object.assign(tot, { ok: false, motivo: `fermo dopo ${tot.lotti} lotti (il tetto): rilancia per continuare` });
    let r;
    try {
      r = await chiama(Object.assign({ op: 'migra', dryRun: !dalVero }, dopo ? { dopo } : {}));
    } catch (e) {
      return Object.assign(tot, { ok: false, motivo: String((e && e.message) || e) });
    }
    if (!r || r.ok !== true) return Object.assign(tot, { ok: false, motivo: (r && (r.dettaglio || r.errore)) || 'risposta senza esito' });
    tot.lotti += 1;
    for (const k of ['create', 'gia', 'fuori', 'errori']) tot[k] += Number(r[k]) || 0;
    for (const id of Array.isArray(r.erroriIds) ? r.erroriIds : []) if (tot.erroriIds.length < 200) tot.erroriIds.push(String(id));
    ogniLotto(tot, r);
    const prossimo = String(r.prossimo || '');
    if (!prossimo || prossimo === dopo) return tot;
    dopo = prossimo;
  }
}

/** Una riga col conto, per l'owner. PURA. */
export function rigaConto(t) {
  const come = t.dryRun ? 'A secco' : 'Scritte';
  const errori = t.errori ? `, ${t.errori} non riuscite${t.erroriIds.length ? ` (${t.erroriIds.slice(0, 10).join(', ')}${t.erroriIds.length > 10 ? ', …' : ''})` : ''}` : '';
  return `${come}: ${t.create} domande ${t.dryRun ? 'da creare' : 'create'}, ${t.gia} attese l'avevano già, ${t.fuori} feedback aperti senza attesa${errori}. Lotti: ${t.lotti}.`;
}

async function chiamaServer(data, { fetchImpl = fetch, url = OWNER_DOMANDE_URL } = {}) {
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
  if (res.status === 404) throw new Error('la funzione ownerDomande non è ancora pubblicata sul server');
  if (!res.ok) throw new Error((body.error && body.error.message) || `errore ${res.status}`);
  return body.result || {};
}

async function main() {
  const args = leggiArgomenti(process.argv.slice(2));
  if (args.errore) { console.error(args.errore); return 2; }
  console.log(args.dalVero ? 'Migrazione delle attese, dal vero: creo le domande che mancano.' : 'Migrazione delle attese a secco: conto e basta (--dal-vero per creare).');
  const t = await migraTutto({
    chiama: (data) => chiamaServer(data),
    dalVero: args.dalVero,
    ogniLotto: (tot) => console.log(`  lotto ${tot.lotti}: ${tot.create + tot.gia + tot.fuori} feedback aperti visti finora`),
  });
  console.log(rigaConto(t));
  if (!t.ok) { console.error(`Interrotta: ${t.motivo}. Rilanciando riparte da capo e salta chi ha già la domanda.`); return 1; }
  return t.errori ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(`domande-migra: ${String((e && e.message) || e)}`); process.exitCode = 1; });
}
