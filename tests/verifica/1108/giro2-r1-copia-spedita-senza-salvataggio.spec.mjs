// Verifica #1108 giro 2, rilievo 1: il controllo della forma sta solo nel commit dell'hook. Le altre strade con cui il
// lavoro parte per origin (il commit del rilascio di una routine, un commit a mano spedito dal salvataggio dopo) spediscono la copia.

import { test, expect } from '@playwright/test';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, scene, togliScene, runHookRaw, stdinEdit, git } from '../../helpers/scenaHook.mjs';
import { commitRestante, pushRamoCorrente } from '../../../scripts/routine-channel.mjs';

const COPIA = {
  documents: [{
    name: 'projects/filo/databases/(default)/documents/feedback/abc123',
    fields: { text: { stringValue: 'il tasto non va' }, userAgent: { stringValue: 'Mozilla/5.0' }, clientId: { stringValue: 'c-1' } },
  }],
};

function preparaRamo() {
  const s = scene();
  git(s.work, ['checkout', '-q', '-b', 'claude/prova']);
  mkdirSync(join(s.work, 'scripts', 'lib'), { recursive: true });
  for (const f of ['scripts/copie-in-scena.mjs', 'scripts/lib/copie-di-dati.mjs']) copyFileSync(join(ROOT, f), join(s.work, f));
  git(s.work, ['add', '-A']);
  git(s.work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'strumenti']);
  git(s.work, ['push', '-q', 'origin', 'claude/prova']);
  return s;
}

const suOrigin = (origin) => git(origin, ['ls-tree', '-r', '--name-only', 'claude/prova']).split('\n');

test.afterAll(togliScene);

test('r1 una copia nata da shell dopo l\'ultimo Edit non parte col rilascio della routine', () => {
  const s = preparaRamo();
  writeFileSync(join(s.work, 'scripts', 'feedback.json'), JSON.stringify(COPIA, null, 2));
  writeFileSync(join(s.work, 'note.txt'), 'lavoro\n');
  const c = commitRestante(s.work, { env: { FILO_ROUTINE: '1' } });
  expect(c.ok).toBe(true);
  expect(pushRamoCorrente(s.work).ok).toBe(true);
  const spediti = suOrigin(s.origin);
  expect(spediti).toContain('note.txt');
  expect(spediti).not.toContain('scripts/feedback.json');
});

test('r1 una copia entrata in un commit a mano non parte col salvataggio automatico successivo', () => {
  const s = preparaRamo();
  writeFileSync(join(s.work, 'scripts', 'feedback.json'), JSON.stringify(COPIA, null, 2));
  git(s.work, ['add', '-A']);
  git(s.work, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'verifica: prove']);
  writeFileSync(join(s.work, 'README.md'), 'lavoro\n');
  const r = runHookRaw(s.work, stdinEdit(join(s.work, 'README.md')), { FILO_ROUTINE: '1' });
  expect(r.status).toBe(0);
  const spediti = suOrigin(s.origin);
  expect(git(s.origin, ['show', 'claude/prova:README.md'])).toBe('lavoro');
  expect(spediti).not.toContain('scripts/feedback.json');
});
