#!/usr/bin/env node
// Comando dei clone per worker (#1157): la logica e le sue regole stanno in scripts/lib/clone-worker.mjs.
//   node scripts/clone-worker.mjs prepara <n> [--paralleli <K>] [--dest <cartella>] [--push-url <url>]
//   node scripts/clone-worker.mjs pacchetti <n>      (dopo che il clone è sul ramo del lavoro)
//   node scripts/clone-worker.mjs togli <n>
//   node scripts/clone-worker.mjs elenco
// Stampa una riga JSON; uscita 0 = fatto, 1 = no (col motivo), 2 = uso sbagliato.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allineaPacchetti, elencoCloni, preparaClone, togliClone } from './lib/clone-worker.mjs';
import { pinnedRepoRoot } from './lib/tools-pin.mjs';

const PRINCIPALE = process.env.FILO_REPO_ROOT
  ? resolve(process.env.FILO_REPO_ROOT)
  : (pinnedRepoRoot() || resolve(fileURLToPath(new URL('..', import.meta.url))));

function opzione(args, nome) {
  const i = args.indexOf(nome);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : '';
}

function esci(r) {
  process.stdout.write(`${JSON.stringify(r)}\n`, () => { process.exitCode = r.ok ? 0 : 1; });
}

const [cmd, n, ...resto] = process.argv.slice(2);
if (cmd === 'elenco') {
  esci({ ok: true, principale: PRINCIPALE, cloni: elencoCloni(PRINCIPALE) });
} else if (cmd === 'prepara' && n) {
  esci(preparaClone(PRINCIPALE, n, {
    paralleli: Number(opzione(resto, '--paralleli')) || 0,
    dest: opzione(resto, '--dest'),
    pushUrl: opzione(resto, '--push-url'),
  }));
} else if (cmd === 'pacchetti' && n) {
  const voce = elencoCloni(PRINCIPALE).find((c) => c.indice === Number(n));
  esci(voce && voce.esiste ? allineaPacchetti(voce.cartella, PRINCIPALE) : { ok: false, why: `nessun clone registrato per il worker ${n}` });
} else if (cmd === 'togli' && n) {
  esci(togliClone(PRINCIPALE, n));
} else {
  console.error('Uso: node scripts/clone-worker.mjs <prepara|pacchetti|togli> <n> [--paralleli K] [--dest D] [--push-url U] | elenco');
  process.exitCode = 2;
}
