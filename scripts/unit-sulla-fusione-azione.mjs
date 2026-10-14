// Gli unit sul risultato della fusione, nell'azione di GitHub che il server avvia dopo i pass (#1207). Prova la coppia
// di sha ricevuta, mai il main di adesso; non fonde né spinge. Il verde per il server è la corsa riuscita: l'annotazione
// `prova-unit` dice solo che rosso è. Gira da una copia di main, sul ramo in --root. Sentinella: tests/unit/unitSullaFusione.test.mjs.

import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { campoPerIlServer, gitIn, provaUnitSullaFusione, testoProva } from './lib/unit-sulla-fusione.mjs';

const SHA = /^[0-9a-f]{40}$/;
export const TITOLO = 'prova-unit';
export const USCITA = Object.freeze({ fondibile: 0, riallineamento: 1, non_provata: 2 });

/** `--root <cartella> --ramo <sha> --main <sha>`. Un argomento sconosciuto è un errore, non un'opzione ignorata. PURA. */
export function leggiArgomenti(argv) {
  const out = { root: '', ramo: '', main: '', errori: [] };
  const chiavi = { '--root': 'root', '--ramo': 'ramo', '--main': 'main' };
  const a = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < a.length; i++) {
    const k = chiavi[a[i]];
    if (!k) { out.errori.push(`argomento sconosciuto: ${a[i]}`); continue; }
    const v = a[i + 1];
    if (typeof v !== 'string' || !v || v.startsWith('--')) { out.errori.push(`${a[i]} senza valore`); continue; }
    out[k] = k === 'root' ? v : v.toLowerCase();
    i++;
  }
  if (!out.root) out.errori.push('manca --root, la cartella col ramo da provare');
  for (const k of ['ramo', 'main']) {
    if (!SHA.test(out[k])) out.errori.push(`--${k} vuole uno sha intero (40 caratteri esadecimali)`);
  }
  return out;
}

/** 0 si può fondere, 1 rosso o conflitto (va al riallineamento), 2 prova non riuscita (si rilancia). PURA. */
export function uscitaPer(prova) {
  const p = prova || {};
  if (p.errore || p.saltata) return USCITA.non_provata;
  if (p.esito === 'verde' || p.esito === 'rosso_anche_su_main') return USCITA.fondibile;
  if (p.esito === 'rosso_sulla_fusione' || p.esito === 'conflitto') return USCITA.riallineamento;
  return USCITA.non_provata;
}

/** L'esito come annotazione di GitHub: il campo che il cancello mandava al server, con la coppia provata. PURA. */
export function annotazione(prova, ramo, main) {
  const p = prova || {};
  const campo = campoPerIlServer(p) || { esito: 'non_provata', motivo: String(p.motivo || 'prova saltata').slice(0, 300) };
  const json = JSON.stringify({ ...campo, ramoSha: String(ramo || ''), mainSha: String(main || '') });
  const livello = uscitaPer(p) === USCITA.fondibile ? 'notice' : 'error';
  return `::${livello} title=${TITOLO}::${json.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`;
}

/** La prova sulla cartella data, solo se è davvero sulla punta da provare. */
export function prova({ root, ramo, main, scrivi = (s) => console.log(s) }) {
  const testa = gitIn(root)(['rev-parse', 'HEAD']);
  const sha = testa.ok ? testa.out.trim() : '';
  if (sha !== ramo) return { errore: `la cartella non è sulla punta da provare (${sha ? sha.slice(0, 12) : 'git non risponde'})` };
  // Col main già dentro, il risultato della fusione è il ramo: si provano i suoi unit, non si salta.
  return provaUnitSullaFusione({ root, punta: ramo, mainSha: main, ancheContenuto: true, scrivi });
}

function main() {
  const a = leggiArgomenti(process.argv.slice(2));
  if (a.errori.length) {
    for (const e of a.errori) console.error(`[unit sulla fusione] ${e}`);
    process.exit(USCITA.non_provata);
  }
  // Fra i due segni l'uscita (anche la coda dei test del ramo) non dà comandi a GitHub: niente annotazioni finte.
  const segno = randomBytes(16).toString('hex');
  const azione = process.env.GITHUB_ACTIONS === 'true';
  if (azione) console.log(`::stop-commands::${segno}`);
  const p = prova({ root: resolve(a.root), ramo: a.ramo, main: a.main });
  console.log(testoProva(p));
  if (azione) console.log(`::${segno}::`);
  console.log(annotazione(p, a.ramo, a.main));
  process.exit(uscitaPer(p));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
