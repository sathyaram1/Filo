// Verifica locale «fiducia» (#1148), giro 1, rilievi 3 e 4: la migrazione dei feedback esistenti ha una strada per
// partire; il documento pubblico sulla sicurezza racconta le strade che saltano il clic dell'owner come sono adesso.
import { test, expect } from './../../fixtures/electron.mjs';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const RADICE = join(import.meta.dirname, '..', '..', '..');
function cartellaServer() {
  let ramo = '';
  try { ramo = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: RADICE, encoding: 'utf8' }).trim(); } catch (_) {}
  const slug = ramo.replace(/^claude\//, '');
  let d = RADICE;
  for (let i = 0; i < 8; i++) {
    const srv = join(dirname(d), 'filo-security');
    for (const c of [join(srv, '.claude', 'worktrees', slug), srv]) {
      if (slug && existsSync(join(c, 'functions', 'src', 'fiduciaMigrazione.js'))) return c;
    }
    d = dirname(d);
  }
  return '';
}
function file(cartella, estensioni) {
  if (!existsSync(cartella)) return [];
  return readdirSync(cartella, { recursive: true }).map(String)
    .filter((f) => estensioni.some((e) => f.endsWith(e)) && !/node_modules|[\\/]test[\\/]|\.test\./.test(f))
    .map((f) => join(cartella, f));
}

test('r3 c’è un comando che lancia la migrazione della fiducia (a secco e dal vero, a lotti)', async () => {
  const srv = cartellaServer();
  const candidati = [
    ...file(join(RADICE, 'scripts'), ['.mjs', '.js']),
    ...(srv ? file(join(srv, 'functions', 'tools'), ['.js', '.mjs']) : []),
  ];
  const lancia = candidati.filter((f) => {
    const t = readFileSync(f, 'utf8');
    return /ownerFiducia|migraLotto/.test(t) && /['"]migra['"]/.test(t);
  });
  expect(lancia, 'nessuno strumento chiama ownerFiducia con op «migra»').not.toEqual([]);
});

test('r4 il documento sulla sicurezza non parla più di «fondi senza chiedermelo» e dice del lavoro fidato', async () => {
  const md = readFileSync(join(RADICE, 'transparency', 'security.md'), 'utf8');
  expect(md).not.toMatch(/segno «fondi senza chiedermelo»/i);
  expect(md).toMatch(/fidat/i);
});
