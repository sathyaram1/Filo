// Copia nella pagina delle approvazioni da browser (site/approvazioni) i pezzi condivisi con l'app: le card
// delle fusioni, le icone e il tema si scrivono in un posto solo. `--controlla` esce 3 se una copia è vecchia
// (è il predeploy di firebase.json). Regole: tests/unit/approvazioniWeb.test.mjs.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CARTELLA = 'site/approvazioni';

export const COPIE = Object.freeze([
  ['src/shared/mergeApprovals.js', 'filo/mergeApprovals.js'],
  ['src/shared/icons.js', 'filo/icons.js'],
  ['src/styles/theme.css', 'filo/theme.css'],
  ['src/styles/mergeApprovals.css', 'filo/mergeApprovals.css'],
]);

/** La copia di una sorgente: la riga in testa dice da dove viene, il resto è identico. PURA. */
export function contenutoCopia(sorgente, testo) {
  const corpo = String(testo).replace(/\r\n/g, '\n');
  return `/* Copia di ${sorgente}, scritta da scripts/build-approvazioni.mjs: si cambia la sorgente, non questa. */\n${corpo}`;
}

/** Le copie da riscrivere: [{ da, a, testo }] di quelle che mancano o non combaciano. */
export function copieVecchie(radice = ROOT) {
  const out = [];
  for (const [da, a] of COPIE) {
    const testo = contenutoCopia(da, readFileSync(join(radice, da), 'utf8'));
    const dove = join(radice, CARTELLA, a);
    const ora = existsSync(dove) ? readFileSync(dove, 'utf8').replace(/\r\n/g, '\n') : null;
    if (ora !== testo) out.push({ da, a: `${CARTELLA}/${a}`, testo, dove });
  }
  return out;
}

export function main(argv, { log = console.log, err = console.error, radice = ROOT } = {}) {
  const vecchie = copieVecchie(radice);
  if (argv.includes('--controlla')) {
    if (!vecchie.length) { log('Pagina delle approvazioni: copie allineate.'); return 0; }
    err(`RIFIUTATO: copie della pagina delle approvazioni vecchie (${vecchie.map((v) => v.a).join(', ')}): node scripts/build-approvazioni.mjs, poi fondi.`);
    return 3;
  }
  for (const v of vecchie) {
    mkdirSync(dirname(v.dove), { recursive: true });
    writeFileSync(v.dove, v.testo, 'utf8');
    log(`  ✓ ${v.a}`);
  }
  if (!vecchie.length) log('Niente da copiare: già allineate.');
  return 0;
}

if (resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
