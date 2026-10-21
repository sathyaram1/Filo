// biglietto.mjs — il biglietto della sessione locale (SPEC-DOMANDE.md §1.2). Lo prende l'hook di avvio; da qui ci si
// dichiara sporchi, si legge lo stato, si chiude. Nessuna strada per tornare puliti né per «segna fidato» (§1.4).
// Le op stanno in scripts/lib/biglietto-locale.mjs; `gancio`/`consegna`, `fine`/`chiusura` e `scadenze` sono dei ganci.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import * as B from './lib/biglietto-locale.mjs';
import { gancio } from './lib/letture-esterne.mjs';

export const USO = 'Uso: node scripts/biglietto.mjs prendi [--sporco "<motivo>"] | sporca "<motivo>" | stato | chiudi';

/** Le parole della riga di comando. PURA. @returns {{ cmd, motivo?, sporco? } | { errore }} */
export function leggiArgomenti(argv) {
  const a = (Array.isArray(argv) ? argv : []).map(String);
  const cmd = a[0] || '';
  if (['stato', 'chiudi', 'avvio', 'gancio', 'fine', 'scadenze'].includes(cmd)) return a.length === 1 ? { cmd } : { errore: `${cmd} non vuole altro. ${USO}` };
  if (cmd === 'consegna') return { cmd, motivo: a.slice(1).join(' ').trim() };
  if (cmd === 'chiusura') return a.length === 2 && a[1].trim() ? { cmd, sessione: a[1].trim() } : { errore: `chiusura vuole il nome della sessione. ${USO}` };
  if (cmd === 'sporca') {
    const motivo = a.slice(1).join(' ').trim();
    return motivo ? { cmd, motivo } : { errore: `sporca vuole il motivo: cosa hai letto che il server non vede. ${USO}` };
  }
  if (cmd === 'prendi') {
    if (a.length === 1) return { cmd, sporco: false };
    if (a[1] === '--sporco') {
      const motivo = a.slice(2).join(' ').trim();
      return motivo ? { cmd, sporco: true, motivo } : { errore: `--sporco vuole il motivo. ${USO}` };
    }
    return { errore: `"${a[1]}" non vale qui. ${USO}` };
  }
  return { errore: USO };
}

async function leggiStdin() {
  if (process.stdin.isTTY) return {};
  const pezzi = [];
  for await (const p of process.stdin) pezzi.push(p);
  try { return JSON.parse(Buffer.concat(pezzi).toString('utf8') || '{}'); } catch (_) { return {}; }
}

async function main() {
  const args = leggiArgomenti(process.argv.slice(2));
  if (args.errore) { console.error(args.errore); return 2; }

  if (args.cmd === 'gancio') {
    // PostToolUse: annota e lancia la consegna in sottofondo, senza aspettarla. Sempre uscita 0, niente da dire.
    gancio({ input: await leggiStdin() });
    return 0;
  }
  if (args.cmd === 'consegna') {
    // In sottofondo, lanciata dal gancio: oltre il tetto dell'avvio si lascia lo sporco annotato alla prossima occasione.
    setTimeout(() => process.exit(0), B.TETTO_AVVIO_MS).unref();
    for (const b of B.trovaBiglietti()) await B.consegnaSporchi(b, { aggiunta: args.motivo });
    return 0;
  }
  if (args.cmd === 'avvio') {
    // L'hook di avvio: una riga, sempre uscita 0, anche col server giù. Poi, senza aspettarla, la scadenza dei rimasti.
    const r = await B.avvio({ input: await leggiStdin() });
    if (r.riga) console.log(r.riga);
    if (r.path) B.avviaInSottofondo(['scadenze'], { env: { ...process.env, [B.ENV_FILE]: r.path } });
    return 0;
  }
  if (args.cmd === 'fine') {
    B.avviaFine({ input: await leggiStdin() });
    return 0;
  }
  if (args.cmd === 'chiusura' || args.cmd === 'scadenze') {
    setTimeout(() => process.exit(0), B.TETTO_SOTTOFONDO_MS).unref();
    if (args.cmd === 'chiusura') await B.fineSessione({ input: { session_id: args.sessione } });
    else await B.chiudiScaduti();
    return 0;
  }
  if (args.cmd === 'prendi') {
    // Un biglietto vivo non si sostituisce con uno pulito: da sporco non si torna (§1.2). Regola, non muro.
    const vivo = B.trovaBiglietti().length ? await B.trovaBiglietto() : null;
    if (vivo && !vivo.errore && !(vivo.stato && vivo.stato.chiuso)) {
      console.error(`Questa sessione ha già un biglietto (${vivo.fiducia === 'fidato' ? 'pulito' : 'sporco'}): ${vivo.path}. Uno nuovo non pulisce niente.`);
      return 1;
    }
    const p = await B.prendi({ sporco: args.sporco, motivo: args.motivo, sessionId: process.env.CLAUDE_CODE_SESSION_ID || '' });
    console.log(`Biglietto ${p.fiducia === 'fidato' ? 'pulito' : 'sporco'}: ${p.path}`);
    console.log(`Perché lo vedano gli strumenti di questa sessione: export ${B.ENV_FILE}='${p.path}'`);
    return 0;
  }
  if (args.cmd === 'sporca') {
    const r = await B.sporca(args.motivo);
    if (r.senzaBiglietto) {
      console.error('Nessun biglietto trovato da qui, quindi niente sporcato: ciò che scrivi da questo repo nasce non fidato, ma se la sessione ne ha uno in un altro repo dichiaralo da lì.');
      return 1;
    }
    if (r.sporcati) console.log(`Biglietto sporcato (${r.sporcati}): da qui ciò che scrivi nasce non fidato.`);
    if (r.inAttesa) console.log(`Server non raggiunto (${r.errori.join('; ')}): lo sporco è annotato in locale e parte alla prossima occasione; intanto ciò che scrivi nasce non fidato.`);
    else if (r.errori.length) console.error(`Non sporcati: ${r.errori.join('; ')}`);
    return r.sporcati || r.inAttesa ? 0 : 1;
  }
  if (args.cmd === 'stato') {
    const trovati = B.trovaBiglietti();
    if (!trovati.length) { console.log('Nessun biglietto trovato da qui: ciò che la sessione scrive da questo repo vale non fidato.'); return 0; }
    const b = await B.trovaBiglietto();
    console.log(`${b.fiducia === 'fidato' ? 'Pulito' : 'Sporco'}: ${b.path}`);
    if (b.errore) console.log(`Stato non letto: ${b.errore}`);
    if (b.inAttesa) console.log(`Letture esterne annotate solo in locale, non ancora ricevute dal server: ${b.inAttesa}.`);
    const motivi = (b.stato && Array.isArray(b.stato.sporcatoDa)) ? b.stato.sporcatoDa : [];
    for (const m of motivi) console.log(`  - ${new Date(Number(m.at) || 0).toISOString()} ${String(m.motivo || '').replace(/[\u0000-\u001f\u007f]/g, ' ')}`);
    return 0;
  }
  // chiudi
  const r = await B.chiudi();
  if (r.errori.length) console.error(`Non chiusi sul server: ${r.errori.join('; ')}`);
  console.log(r.chiusi ? `Biglietti chiusi: ${r.chiusi}.` : 'Nessun biglietto da chiudere.');
  return 0;
}

// Col percorso vero, come node risolve il modulo principale: lanciato da un collegamento l'hook, se no, non farebbe niente.
const lanciato = (() => { try { return realpathSync(process.argv[1]); } catch (_) { return resolve(process.argv[1] || ''); } })();
if (process.argv[1] && lanciato === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    console.error(`biglietto: ${String((e && e.message) || e)}`);
    process.exitCode = ['avvio', 'gancio', 'consegna', 'fine', 'chiusura', 'scadenze'].includes(process.argv[2]) ? 0 : 1;
  });
}
