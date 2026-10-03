// Prova del giro 1 (verifica locale #929), rilievo 4: il server controlla che main sia quello provato e POI fonde
// su main «com'è in quel momento». Se un'altra fusione atterra in mezzo, si fonde una combinazione mai provata.
// GitHub è finto: la sua fusione simula l'altra fusione arrivata fra il controllo e la fusione. Se la cura passa da
// un'altra chiamata a GitHub (fusione condizionata allo sha di main), il finto va esteso con quella, non l'attesa.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** functions/ del server sullo stesso ramo: il worktree omonimo di filo-security, se c'è. */
function cartellaServer() {
  const dati = [];
  let d = ROOT;
  for (let i = 0; i < 8; i += 1) {
    const sec = join(dirname(d), 'filo-security');
    dati.push(join(sec, '.claude', 'worktrees', basename(ROOT), 'functions'));
    if (existsSync(join(sec, 'functions'))) break;
    d = dirname(d);
  }
  return dati.find((p) => existsSync(join(p, 'src', 'routine', 'ownerMerge.js'))) || '';
}

const SHA = 'a'.repeat(40);
const PROVATO = 'c'.repeat(40);
const ALTRA_FUSIONE = 'd'.repeat(40);
const DIFF = ['diff --git a/src/pages/x.js b/src/pages/x.js', 'index 0..1 100644', '--- a/src/pages/x.js', '+++ b/src/pages/x.js', '@@ -1,1 +1,2 @@', ' a', '+const x = 1;'].join('\n');

test('se main si muove fra il controllo e la fusione, il server non fonde sul main non provato', async () => {
  const srv = cartellaServer();
  test.skip(!srv, 'manca il worktree del server per questo ramo');
  const require = createRequire(import.meta.url);
  const { runOwnerMerge } = require(join(srv, 'src', 'routine', 'ownerMerge.js'));

  let main = PROVATO;
  let fusaSu = '';
  const github = {
    async branchHead(b) { return { ok: true, sha: b === 'main' ? main : SHA }; },
    async compareDiff() { return { ok: true, diff: DIFF }; },
    async mergeDryRun() { return { ok: true, status: 'clean' }; },
    // L'API vera fonde su main com'è adesso: qui un'altra fusione è appena atterrata.
    async mergeSha() { main = ALTRA_FUSIONE; fusaSu = main; return { ok: true, status: 'merged', sha: 'e'.repeat(40) }; },
  };
  const orig = console.log;
  console.log = () => {};
  let r;
  try {
    r = await runOwnerMerge({ admin: true, who: 'owner', branch: 'claude/prova', sha: SHA, github, provaUnit: { esito: 'verde', mainSha: PROVATO } });
  } finally { console.log = orig; }
  const fusoSulNonProvato = r && r.result === 'merged' && fusaSu !== PROVATO;
  expect(fusoSulNonProvato, `esito ${JSON.stringify(r)}: fuso su ${fusaSu.slice(0, 8)}, provato ${PROVATO.slice(0, 8)}`).toBe(false);
});
