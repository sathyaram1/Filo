// Gli unit sul risultato della fusione dentro l'azione chiesta dal server (.github/workflows/unit-fusione.yml, #1207):
// prova la coppia (ramo, main) nominata dal server e stampa l'esito nella riga che il server legge dal registro della corsa.
// Gira dagli strumenti di main, mai da quelli del ramo provato. Sentinella: tests/unit/unitFusioneAzione.test.mjs.

import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provaUnitSullaFusione, campoPerIlServer, testoProva } from './lib/unit-sulla-fusione.mjs';

// Il server cerca la riga che COMINCIA così, l'ultima del registro: l'uscita dei test provati è rientrata, mai in colonna.
export const MARCA = 'FILO-UNIT-FUSIONE';
const SHA = /^[0-9a-f]{40}$/;
// Gli esiti con cui il server porta il lavoro alla fusione: la corsa verde li dice anche a chi guarda Actions.
const SI_FONDE = new Set(['verde', 'main_contenuto', 'rosso_anche_su_main']);
const NON_SI_FONDE = new Set(['rosso_sulla_fusione', 'conflitto']);

/** --root <cartella> --ramo <sha> --main <sha>. PURA. */
export function leggiArgomenti(argv) {
  const out = { root: '', ramo: '', main: '', errori: [] };
  const a = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < a.length; i++) {
    const k = String(a[i]);
    if (!['--root', '--ramo', '--main'].includes(k)) { out.errori.push(`argomento sconosciuto: ${k.slice(0, 60)}`); continue; }
    out[k.slice(2)] = String(a[i + 1] ?? '');
    i++;
  }
  if (!out.root) out.errori.push('manca --root');
  for (const k of ['ramo', 'main']) {
    out[k] = out[k].toLowerCase();
    if (!SHA.test(out[k])) out.errori.push(`--${k} dev'essere uno sha intero`);
  }
  return out;
}

/** Il campo dell'esito per il server: quello della richiesta di fusione (#929), più la coppia provata. PURA. */
export function campoEsito({ ramo, main, prova }) {
  const p = prova || {};
  const campo = campoPerIlServer(p) || { esito: 'non_provata', motivo: String(p.motivo || 'prova non fatta').slice(0, 300) };
  return { ramo, main, ...campo };
}

/** La riga che il server legge. PURA. Una riga sola: niente a capo nel JSON. */
export function rigaEsito(campo) {
  return `${MARCA} ${JSON.stringify(campo)}`;
}

/** 0 = si fonde, 1 = non si fonde (rossi o conflitto), 2 = prova non fatta. PURA. */
export function codiceUscita(campo) {
  const e = String((campo && campo.esito) || '');
  if (SI_FONDE.has(e)) return 0;
  if (NON_SI_FONDE.has(e)) return 1;
  return 2;
}

function riassunto(testo, riga) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  try { appendFileSync(file, `## Unit sulla fusione\n\n\`\`\`\n${testo}\n\`\`\`\n\n\`${riga}\`\n`, 'utf8'); } catch (_) { /* il riassunto è per chi guarda, l'esito è nel registro */ }
}

function main() {
  const a = leggiArgomenti(process.argv.slice(2));
  if (a.errori.length) {
    console.error(`unit-fusione-azione: ${a.errori.join('; ')}`);
    process.exit(2);
  }
  const prova = provaUnitSullaFusione({ root: resolve(a.root), punta: a.ramo, mainSha: a.main, scrivi: (s) => console.log(s) });
  const testo = testoProva(prova);
  console.log(testo);
  const campo = campoEsito({ ramo: a.ramo, main: a.main, prova });
  const riga = rigaEsito(campo);
  riassunto(testo, riga);
  console.log(riga);
  process.exit(codiceUscita(campo));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
