// Il cancello di pubblicazione prova l'ultimo commit di main con la suite verde, a volte giorni indietro: qui i suoi
// rossi si rifanno sulla punta di main, da cui questo file gira. Esce 0 solo se ogni rosso è un file di test che lì
// passa: allora il feedback chiederebbe un lavoro già fatto, e si riaprirebbe a ogni chiusura (#1185).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chiaviDelRegistroUnit } from './build-alarm.mjs';

const PUNTA = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Un file rosso ripreso sulla punta può metterci quanto un gruppo intero del cancello. */
export const TETTO_FILE_MS = 15 * 60 * 1000;

/**
 * Le chiavi `unit:<file>` dell'allarme divise in file di test da rifare e chiavi che non si possono rifare: `unit`
 * (rosso senza file), un file che non è un test (rifatto, passerebbe senza provare niente), un percorso che esce. PURA.
 */
export function fileDaRifare(chiavi) {
  const file = [];
  const nonRifacibili = [];
  for (const c of chiavi || []) {
    const f = String(c).startsWith('unit:') ? String(c).slice(5) : '';
    if (/\.test\.mjs$/.test(f) && !f.split('/').includes('..')) file.push(f);
    else nonRifacibili.push(String(c));
  }
  return { file, nonRifacibili };
}

/** Tutti già verdi sulla punta solo con almeno un file, nessun rosso che non si è potuto rifare e ogni file verde. PURA. */
export function tuttiGiaVerdi({ file, nonRifacibili, verdi }) {
  return file.length > 0 && nonRifacibili.length === 0 && file.every((f) => verdi.includes(f));
}

/** Lancia un file col lanciatore della punta; la sua uscita va su stderr, così stdout resta l'elenco dei verdi. */
function lanciaSullaPunta(file) {
  // Ereditata da un `node --test`, farebbe saltare i file al lanciatore: uscita 0 senza aver provato niente.
  const { NODE_TEST_CONTEXT: _figlio, ...env } = process.env;
  const r = spawnSync(process.execPath, [join(PUNTA, 'scripts', 'run-unit-tests.mjs'), '--solo', file], {
    cwd: PUNTA,
    env,
    stdio: ['ignore', 2, 2],
    timeout: TETTO_FILE_MS,
    windowsHide: true,
  });
  return r.error ? 1 : r.status;
}

/**
 * `registro`: il TAP del cancello; `radice`: la cartella del commit provato (da lì il cancello ha girato). Restituisce
 * i file già verdi sulla punta e se lo sono tutti.
 */
export function rifaiSullaPunta(registro, { radice = process.cwd(), punta = PUNTA, lancia = lanciaSullaPunta } = {}) {
  const { file, nonRifacibili } = fileDaRifare(chiaviDelRegistroUnit(registro, radice));
  const verdi = [];
  for (const f of file) {
    if (!existsSync(join(punta, f))) { nonRifacibili.push(`unit:${f}`); continue; }
    if (lancia(f) === 0) verdi.push(f);
  }
  return { verdi, tutti: tuttiGiaVerdi({ file, nonRifacibili, verdi }) };
}

const eseguitoDirettamente = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (eseguitoDirettamente) {
  const registro = process.argv[2];
  if (!registro) {
    console.error('Uso: node <punta>/scripts/rossi-sulla-punta.mjs <registro TAP del cancello>');
    process.exitCode = 2;
  } else {
    const { verdi, tutti } = rifaiSullaPunta(readFileSync(registro, 'utf8'));
    if (verdi.length) process.stdout.write(`${verdi.join('\n')}\n`);
    process.exitCode = tutti ? 0 : 1;
  }
}
