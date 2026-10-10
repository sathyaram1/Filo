#!/usr/bin/env node
// Un comando che apre Electron, lanciato a mano come lo lancia finish:check: su Linux senza schermo con xvfb-run -a, la
// base di display del worker (#1157) e la sandbox spenta; altrove invariato. Regole in scripts/lib/schermo-virtuale.mjs.
//   node scripts/lancia-electron.mjs npx playwright test <percorso>

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { datiWorker } from './lib/dati-worker.mjs';
import { preparaLancioElectron } from './lib/schermo-virtuale.mjs';
import { pinnedRepoRoot } from './lib/tools-pin.mjs';

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('Uso: node scripts/lancia-electron.mjs <comando> [argomenti…]   es. npx playwright test tests/x.spec.mjs');
  process.exit(2);
}
// Il marcatore sta nel clone del worker: dagli strumenti fissati o da questo file, non da dove si è lanciato.
const radice = pinnedRepoRoot() || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const l = preparaLancioElectron(cmd, args, { worker: datiWorker({ root: radice }) });
if (!l.ok) { console.error(l.motivo); process.exit(1); }
if (l.nota) console.error(l.nota);
// Su Windows serve la shell per trovare npx.cmd, e la shell spezza agli spazi: «C:\Program Files\…» va fra virgolette.
const win = process.platform === 'win32';
const cita = (s) => (win && /[\s"]/.test(s) ? `"${String(s).replace(/"/g, '\\"')}"` : s);
const r = spawnSync(cita(l.cmd), l.args.map(cita), { stdio: 'inherit', env: l.env || process.env, shell: win });
process.exit(r.status === null ? 1 : r.status);
