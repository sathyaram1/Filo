// radici-migra.mjs — la migrazione delle radici (SPEC-DOMANDE.md §1.7, #1918): regola e scritture le fa il server
// (ownerFiducia {op:'migraRadici'}), qui solo i lotti, collezione dopo collezione, con le credenziali dell'owner.
// Uso: npm run radici:migra (a secco) | npm run radici:migra -- --dal-vero. Il timbro su legacy si dà in Gestione.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { leggiArgomenti as argomentiFiducia, OWNER_FIDUCIA_URL } from './fiducia-migra.mjs';

// 300 per lotto (il server) su sette collezioni: 20.000 lotti sono sei milioni di documenti. Oltre ci si ferma e lo si dice.
export const TETTO_LOTTI = 20000;

export function leggiArgomenti(argv) {
  const a = argomentiFiducia(argv);
  return a.errore ? { errore: a.errore.replace('fiducia:migra', 'radici:migra') } : a;
}

/**
 * Tutti i lotti di tutte le collezioni: il server dice `prossimo` dentro una collezione e `prossimaCollezione` alla
 * fine. Un rifiuto o un errore ferma tutto coi conti fatti fin lì (rilanciata salta chi ha già le radici).
 * @returns {Promise<{ ok, dryRun, lotti, migrati, legacy, giaFatti, errori, erroriIds, perCollezione, motivo? }>}
 */
export async function migraTutto({ chiama, dalVero = false, tetto = TETTO_LOTTI, ogniLotto = () => {} } = {}) {
  const tot = { ok: true, dryRun: !dalVero, lotti: 0, migrati: 0, legacy: 0, giaFatti: 0, errori: 0, erroriIds: [], perCollezione: {} };
  let collezione = '';
  let dopo = '';
  for (;;) {
    if (tot.lotti >= tetto) return Object.assign(tot, { ok: false, motivo: `fermo dopo ${tot.lotti} lotti (il tetto): rilancia per continuare` });
    let r;
    try {
      r = await chiama(Object.assign({ op: 'migraRadici', dryRun: !dalVero }, collezione ? { collezione } : {}, dopo ? { dopo } : {}));
    } catch (e) {
      return Object.assign(tot, { ok: false, motivo: String((e && e.message) || e) });
    }
    if (!r || r.ok !== true) return Object.assign(tot, { ok: false, motivo: (r && (r.detail || r.reason)) || 'risposta senza esito' });
    tot.lotti += 1;
    for (const k of ['migrati', 'legacy', 'giaFatti', 'errori']) tot[k] += Number(r[k]) || 0;
    const nome = String(r.collezione || collezione || '?');
    tot.perCollezione[nome] = (tot.perCollezione[nome] || 0) + (Number(r.migrati) || 0);
    for (const id of Array.isArray(r.erroriIds) ? r.erroriIds : []) if (tot.erroriIds.length < 200) tot.erroriIds.push(`${nome}/${id}`);
    ogniLotto(tot, r);
    const prossimo = String(r.prossimo || '');
    if (prossimo && prossimo !== dopo) { collezione = nome; dopo = prossimo; continue; }
    const altra = String(r.prossimaCollezione || '');
    if (!altra || altra === nome) return tot;
    collezione = altra;
    dopo = '';
  }
}

/** Una riga col conto, per l'owner. PURA. */
export function rigaConto(t) {
  const come = t.dryRun ? 'A secco' : 'Scritte';
  const per = Object.entries(t.perCollezione).map(([k, v]) => `${k} ${v}`).join(', ');
  const errori = t.errori ? `, ${t.errori} non scritti${t.erroriIds.length ? ` (${t.erroriIds.slice(0, 10).join(', ')}${t.erroriIds.length > 10 ? ', …' : ''})` : ''}` : '';
  return `${come}: radici a ${t.migrati} documenti (${per || 'nessuno'}), ${t.legacy} con legacy, ${t.giaFatti} le avevano già${errori}. Lotti: ${t.lotti}.`;
}

async function chiamaServer(data, { fetchImpl = fetch, url = OWNER_FIDUCIA_URL } = {}) {
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
  if (res.status === 404) throw new Error('la funzione ownerFiducia non è ancora pubblicata sul server');
  if (!res.ok) throw new Error((body.error && body.error.message) || `errore ${res.status}`);
  return body.result || {};
}

async function main() {
  const args = leggiArgomenti(process.argv.slice(2));
  if (args.errore) { console.error(args.errore); return 2; }
  console.log(args.dalVero ? 'Migrazione delle radici, dal vero: scrivo solo dove mancano.' : 'Migrazione delle radici a secco: conto e basta (--dal-vero per scrivere).');
  const t = await migraTutto({
    chiama: (data) => chiamaServer(data),
    dalVero: args.dalVero,
    ogniLotto: (tot, r) => console.log(`  lotto ${tot.lotti} (${r.collezione || '?'}): ${tot.migrati} documenti finora`),
  });
  console.log(rigaConto(t));
  if (!t.ok) { console.error(`Interrotta: ${t.motivo}. Rilanciando riparte da capo e salta chi ha già le radici.`); return 1; }
  if (!t.dryRun) console.log('Fatto. Il timbro in blocco su «nato prima» (legacy) si dà in Gestione, accanto a «Segna fidato».');
  return t.errori ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(`radici-migra: ${String((e && e.message) || e)}`); process.exitCode = 1; });
}
