// Verifica #1409 giro 2, rilievo 1: lo spazio libero che la pulizia riporta è quello del disco dove stanno Filo e le sue
// cartelle di lavoro, anche quando la cartella temporanea sta su un altro disco (/tmp in RAM su Linux, Filo su D: su Windows).
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { main } from '../../../scripts/pulisci-disco.mjs';

const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const scrivi = (p, t = 'x') => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, t); return p; };

test('r1 col disco di Filo quasi pieno e la temporanea su un altro disco, la pulizia dice che il disco di Filo è sotto il 5%', async () => {
  const base = cartellaTemporanea('filo-v1409-');
  const origine = join(base, 'Filo.git');
  const filo = join(base, 'Filo');
  mkdirSync(origine);
  g(origine, 'init', '-q', '--bare');
  g(origine, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  g(base, 'clone', '-q', origine, filo);
  g(filo, 'config', 'user.email', 't@t');
  g(filo, 'config', 'user.name', 't');
  g(filo, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  scrivi(join(filo, 'a.txt'), 'a');
  g(filo, 'add', '-A');
  g(filo, 'commit', '-q', '-m', 'primo');
  g(filo, 'push', '-q', 'origin', 'main');

  const temp = join(base, 'altro-disco', 'tmp');
  mkdirSync(temp, { recursive: true });
  // Il disco di Filo: 9 GB liberi su 476, come nella segnalazione. L'altro disco è largo.
  const statfs = (p) => (p.startsWith(join(base, 'altro-disco'))
    ? { bavail: 300, bsize: 1024 ** 3, blocks: 476 }
    : { bavail: 9, bsize: 1024 ** 3, blocks: 476 });
  const righe = [];
  const P = { radice: filo, serverRadice: '', note: join(base, 'orchestratore'), wt: (s) => join(filo, '.claude', 'worktrees', s) };
  const codice = await main(['--togli'], {
    percorsi: P, claude: join(base, 'claude'), temp, casa: join(base, 'casa'), adesso: Date.now(), statfs, log: (r) => righe.push(r),
  });
  const testo = righe.join('\n');
  expect(codice, testo).toBe(0);
  expect(testo, 'lo spazio riportato non è quello del disco di Filo').toMatch(/Libero alla fine: 9 GB su 476 GB/);
  expect(testo, 'manca l\'avviso del disco di Filo sotto il 5%').toMatch(/Sotto il 5%/);
});
