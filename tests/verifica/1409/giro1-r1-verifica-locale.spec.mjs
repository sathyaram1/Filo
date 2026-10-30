// Verifica #1409 giro 1, rilievo 1: una cartella di lavoro fusa, pulita e ferma da giorni, chiusa col flusso locale
// (che lascia il marcatore della verifica locale, gitignorato, mai tolto), deve andarsene con la pulizia.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, collegaCartella } from '../../helpers/percorsi.mjs';
import { main } from '../../../scripts/pulisci-disco.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ORA = 60 * 60 * 1000;
const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const scrivi = (p, t = 'x') => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, t); return p; };

test('r1 la cartella di un lavoro locale già fuso, pulita e ferma, se ne va con --togli', async () => {
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
  // Il .gitignore vero del repo: decide lui cosa git vede come file fuori da git.
  scrivi(join(filo, '.gitignore'), readFileSync(join(ROOT, '.gitignore'), 'utf8'));
  scrivi(join(filo, 'a.txt'), 'a');
  scrivi(join(filo, 'node_modules', 'segno.txt'));
  g(filo, 'add', '-A');
  g(filo, 'commit', '-q', '-m', 'primo');
  g(filo, 'push', '-q', 'origin', 'main');

  const wt = join(filo, '.claude', 'worktrees', 'crediti-598');
  g(filo, 'worktree', 'add', '-q', '-b', 'claude/crediti-598', wt, 'origin/main');
  collegaCartella(join(filo, 'node_modules'), join(wt, 'node_modules'));
  // Quello che lascia «verify-local start» di ogni lavoro locale chiuso con npm run finish.
  scrivi(join(wt, '.claude', 'verify-local.json'), JSON.stringify({ 'claude/crediti-598': { verdict: 'pass', sha: 'x' } }));

  const righe = [];
  const P = { radice: filo, serverRadice: '', note: join(base, 'orchestratore'), wt: (s) => join(filo, '.claude', 'worktrees', s) };
  const codice = await main(['--togli'], {
    percorsi: P, claude: join(base, 'claude'), temp: join(base, 'tmp'), casa: join(base, 'casa'),
    adesso: Date.now() + 10 * 24 * ORA, statfs: () => ({ bavail: 200, bsize: 1024 ** 3, blocks: 476 }), log: (r) => righe.push(r),
  });
  expect(codice, righe.join('\n')).toBe(0);
  expect(existsSync(wt), `la cartella fusa e ferma è rimasta:\n${righe.join('\n')}`).toBe(false);
  expect(existsSync(join(filo, 'node_modules', 'segno.txt')), 'svuotato il node_modules di Filo').toBe(true);
});
