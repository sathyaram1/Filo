// Pre-avvio di `npm start`. Due passi, entrambi NON fatali: questo script esce
// SEMPRE 0, così `electron .` parte comunque.
//
// 1) Sync con origin/main: git pull --rebase --autostash (come il vecchio
//    prestart inline). Su conflitto/offline annulla il rebase e prosegue.
// 2) Svuota la coda di triage: se in `feedback-triage/` ci sono decisioni
//    accodate dalle routine, le applica a Firestore con le credenziali admin
//    dell'owner (scripts/apply-triage.mjs). Best-effort: se manca il token, la
//    coda è vuota o si è offline, NON blocca l'avvio.
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

// 2) Applica la coda di triage, solo se c'è qualcosa (così su avvio "pulito"
//    non stampa nulla e non tocca la rete).
const SPOOL = resolve(ROOT, 'feedback-triage');
const pending = existsSync(SPOOL) ? readdirSync(SPOOL).filter((f) => f.endsWith('.json')) : [];
if (pending.length) {
  const apply = run(process.execPath, [resolve(ROOT, 'scripts', 'apply-triage.mjs')]);
  if (!apply || apply.status !== 0) {
    console.log('[prestart] feedback:apply saltato (token mancante o offline) — coda invariata');
  }
}

process.exit(0);
