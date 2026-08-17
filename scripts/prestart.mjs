// Pre-avvio di `npm start`. Un passo, NON fatale: questo script esce
// SEMPRE 0, così `electron .` parte comunque.
//
// 1) Sync con origin/main: git pull --rebase --autostash (come il vecchio
//    prestart inline). Su conflitto/offline annulla il rebase e prosegue.
//
// È in un file Node perché il concatenamento &&/|| inline è inaffidabile in
// cmd.exe (lo shell di default di npm su Windows): il passo apply finiva per
// non eseguirsi quando i rami precedenti venivano saltati.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });

// 1) Sync con origin/main.
const pull = run('git', [
  '-c', 'user.email=claude@local', '-c', 'user.name=claude-local',
  'pull', '--rebase', '--autostash', 'origin', 'main',
]);
if (!pull || pull.status !== 0) {
  run('git', ['rebase', '--abort']); // no-op se non c'è un rebase in corso
  console.log('[prestart] git pull saltato (offline o conflitto) — avvio con codice locale');
}

// (Qui viveva lo svuotamento della coda di triage. La coda non esiste piu':
// le decisioni delle routine le scrive il server, le tue le scrivi tu con
// `npm run feedback`.)

process.exit(0);
