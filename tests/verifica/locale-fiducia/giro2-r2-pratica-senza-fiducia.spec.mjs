// Verifica locale «fiducia» (#1148), giro 2, rilievo 2: decisione dell'owner dell'11/10, una pratica locale ancora
// senza il campo fiducia (migrazione non fatta) segue la regola di prima, mittente provato; un non_fidato scritto no.
import { test, expect } from './../../fixtures/electron.mjs';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const RADICE = join(import.meta.dirname, '..', '..', '..');
function funzioniDelServer() {
  let ramo = '';
  try { ramo = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: RADICE, encoding: 'utf8' }).trim(); } catch (_) {}
  const slug = ramo.replace(/^claude\//, '');
  let d = RADICE;
  for (let i = 0; i < 8; i++) {
    const srv = join(dirname(d), 'filo-security');
    for (const c of [join(srv, '.claude', 'worktrees', slug, 'functions'), join(srv, 'functions')]) {
      if (slug && existsSync(join(c, 'src', 'routine', 'ownerMerge.js'))) return c;
    }
    d = dirname(d);
  }
  return '';
}

const SRV = funzioniDelServer();
const SHA = 'b'.repeat(40);
// Una pratica locale aperta dall'owner prima di questo lavoro: mittente provato, solo locale, in lavorazione.
const PRATICA = { status: 'working', senderProof: 'admin', clientId: 'local:sessione', localOnly: { by: 'owner', at: '2026-10-10' } };

function pratica(doc) {
  const require = createRequire(join(SRV, 'index.js'));
  const { localPractice } = require(join(SRV, 'src', 'routine', 'ownerMerge'));
  return localPractice('fb1', async () => doc, Date.now(), 'claude/prima', { readRamo: async () => null, sha: SHA });
}

test('r2 una pratica locale col mittente provato e senza il campo fiducia si fonde con la regola di prima', async () => {
  test.skip(!SRV, 'checkout del server non trovato accanto al repo');
  const r = await pratica(Object.assign({}, PRATICA));
  expect(r.eligible, `${r.reason || ''}: ${r.detail || ''}`).toBe(true);
});

test('r2 la stessa pratica con non_fidato scritto resta un rifiuto', async () => {
  test.skip(!SRV, 'checkout del server non trovato accanto al repo');
  const r = await pratica(Object.assign({}, PRATICA, { fiducia: 'non_fidato' }));
  expect(r.eligible).toBe(false);
});
