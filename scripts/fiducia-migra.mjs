// fiducia-migra.mjs — la migrazione della fiducia sui feedback che non ce l'hanno (SPEC-DOMANDE.md §1.7, #1148). Regola e
// scritture le fa il server (ownerFiducia {op:'migra'}), qui solo i lotti, con le credenziali dell'owner.
// Uso: npm run fiducia:migra (a secco, conta e basta) | npm run fiducia:migra -- --dal-vero. Prove: tests/unit/fiduciaMigra.test.mjs.

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { risultatoOwnerFiducia } from './lib/owner-fiducia.mjs';

// 500 per lotto (il server): 20.000 lotti sono dieci milioni di feedback. Oltre ci si ferma e lo si dice.
export const TETTO_LOTTI = 20000;

/** Le parole della riga di comando. PURA. @returns {{ dalVero: boolean } | { errore: string }} */
export function leggiArgomenti(argv) {
  const a = (Array.isArray(argv) ? argv : []).map(String);
  const altri = a.filter((x) => x !== '--dal-vero');
  if (altri.length) return { errore: `"${altri[0]}" non vale qui. Uso: npm run fiducia:migra [-- --dal-vero]` };
  return { dalVero: a.includes('--dal-vero') };
}

/**
 * Tutti i lotti, uno dopo l'altro, finché il server non smette di dare `prossimo`. `chiama(data)` → il risultato della
 * callable. Un rifiuto o un errore ferma tutto, con i conti fatti fin lì (si rilancia: chi ha già la fiducia si salta).
 * @returns {Promise<{ ok: boolean, dryRun: boolean, lotti: number, fidati: number, nonFidati: number, giaImpostati: number, errori: number, erroriIds: string[], motivo?: string }>}
 */
export async function migraTutto({ chiama, dalVero = false, tetto = TETTO_LOTTI, ogniLotto = () => {} } = {}) {
  const tot = { ok: true, dryRun: !dalVero, lotti: 0, fidati: 0, nonFidati: 0, giaImpostati: 0, errori: 0, erroriIds: [] };
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
    for (const k of ['fidati', 'nonFidati', 'giaImpostati', 'errori']) tot[k] += Number(r[k]) || 0;
    for (const id of Array.isArray(r.erroriIds) ? r.erroriIds : []) if (tot.erroriIds.length < 200) tot.erroriIds.push(String(id));
    ogniLotto(tot, r);
    const prossimo = String(r.prossimo || '');
    if (!prossimo || prossimo === dopo) return tot;
    dopo = prossimo;
  }
}

/** Una riga col conto, per l'owner. PURA. */
export function rigaConto(t) {
  const come = t.dryRun ? 'A secco' : 'Scritti';
  const errori = t.errori ? `, ${t.errori} non scritti${t.erroriIds.length ? ` (${t.erroriIds.slice(0, 10).join(', ')}${t.erroriIds.length > 10 ? ', …' : ''})` : ''}` : '';
  return `${come}: ${t.fidati} fidati, ${t.nonFidati} non fidati, ${t.giaImpostati} avevano già la fiducia${errori}. Lotti: ${t.lotti}.`;
}

// Un lotto scrive fino a 500 feedback: il tetto è quello della funzione sul server (nove minuti), non i 30 s di una richiesta.
const TEMPO_LOTTO_MS = 9 * 60 * 1000;

/** Un lotto al server, con la chiamata comune. rete: i suoi deps. → il `result`, o un Error col motivo a parole. */
export function chiamaLotto(data, rete = {}) {
  return risultatoOwnerFiducia(data, { tempoMs: TEMPO_LOTTO_MS, ...rete });
}

async function main() {
  const args = leggiArgomenti(process.argv.slice(2));
  if (args.errore) { console.error(args.errore); return 2; }
  console.log(args.dalVero ? 'Migrazione della fiducia, dal vero: scrivo solo dove manca.' : 'Migrazione della fiducia a secco: conto e basta (--dal-vero per scrivere).');
  const t = await migraTutto({
    chiama: (data) => chiamaLotto(data),
    dalVero: args.dalVero,
    ogniLotto: (tot) => console.log(`  lotto ${tot.lotti}: ${tot.fidati + tot.nonFidati + tot.giaImpostati} feedback visti finora`),
  });
  console.log(rigaConto(t));
  if (!t.ok) { console.error(`Interrotta: ${t.motivo}. Rilanciando riparte da capo e salta chi ha già la fiducia.`); return 1; }
  return t.errori ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(`fiducia-migra: ${String((e && e.message) || e)}`); process.exitCode = 1; });
}
