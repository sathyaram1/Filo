// La lettura del diff che la verifica piena fa prima di registrare la critica (#1363), per le prove che registrano una
// critica senza essere prove della lettura. Le sue regole: tests/unit/letturaDiff.test.mjs.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'lettura-diff.mjs');

export function faiLaLettura(root, { base = 'main', env = process.env } = {}) {
  const pulito = Object.fromEntries(Object.entries(env).filter(([k]) => k !== 'FILO_TOOLS_ROOT'));
  return spawnSync(process.execPath, [SCRIPT, '--base', base], { cwd: root, env: { ...pulito, FILO_REPO_ROOT: root }, encoding: 'utf8' });
}
