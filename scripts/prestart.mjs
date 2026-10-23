// Pre-avvio di `npm start` e `npm run dev`: allinea il ramo a origin/main, poi installa i pacchetti che il lock chiede e
// mancano (#1572). Esce SEMPRE 0, così Filo parte comunque. È un file Node perché in cmd.exe (lo shell di npm su
// Windows) le catene && || scritte in package.json saltavano dei passi.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allineaPacchetti } from './lib/pacchetti.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });

const pull = run('git', [
  '-c', 'user.email=claude@local', '-c', 'user.name=claude-local',
  'pull', '--rebase', '--autostash', 'origin', 'main',
]);
if (!pull || pull.status !== 0) {
  run('git', ['rebase', '--abort']); // no-op se non c'è un rebase in corso
  console.log('[prestart] git pull saltato (offline o conflitto) — avvio con codice locale');
}

// Dopo il pull, e anche quando non riesce: il lock di adesso è quello che il codice di adesso si aspetta.
allineaPacchetti(ROOT, { prefisso: '[prestart]' });

process.exit(0);
