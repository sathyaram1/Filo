// Verifica #1623, giro 2: le righe nuove delle novità stanno sopra l'ultima versione uscita su main, o chi aggiorna non le vede.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
const registro = (src) => { const s = {}; vm.runInNewContext(src, s); return s.SN_PATCH_NOTES; };
const righe = (n) => [...(n.features || []), ...(n.fixes || [])];

test('r1 le righe aggiunte dal ramo non stanno sotto una versione già uscita su main', () => {
  try { git('fetch', '-q', 'origin', 'main'); } catch (_) {}
  const uscita = JSON.parse(git('show', 'origin/main:package.json')).version;
  const suMain = registro(git('show', 'origin/main:src/shared/patchNotes.js'));
  const qui = registro(readFileSync(join(ROOT, 'src', 'shared', 'patchNotes.js'), 'utf8'));
  const vecchie = new Map(suMain.NOTES.map((n) => [n.version, righe(n)]));
  const sbagliate = [];
  for (const n of qui.NOTES) {
    if (qui.cmpVersion(n.version, uscita) > 0) continue;
    for (const r of righe(n)) if (!(vecchie.get(n.version) || []).includes(r)) sbagliate.push(`${n.version}: ${r.slice(0, 60)}`);
  }
  expect(sbagliate).toEqual([]);
});
