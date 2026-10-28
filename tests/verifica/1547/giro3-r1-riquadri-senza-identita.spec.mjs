// Verifica #1547 giro 3: i contatori dei riquadri, arrivati da main col riallineamento, non sono allineati all'identità
// anonima: le regole li accettano senza, e le prove del loro invio chiedono un'identità vera al server di Google.
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('r1 la collezione dei contatori dei riquadri si crea solo con un’identità', () => {
  const regole = readFileSync(join(RADICE, 'firestore.rules'), 'utf8');
  const blocco = /match \/contatori-riquadri\/\{docId\}[\s\S]*?allow create: if ([^;]+);/.exec(regole);
  expect(blocco, 'blocco delle regole dei riquadri').toBeTruthy();
  expect(blocco[1]).toMatch(/^request\.auth != null && /);
});

test('r1 le prove dell’invio dei riquadri passano senza rete e senza creare identità vere', () => {
  const cartella = cartellaTemporanea('filo-1547-');
  const registro = join(cartella, 'chiamate.log');
  const spia = join(cartella, 'spia.cjs');
  writeFileSync(spia, `const f = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  if (/identitytoolkit|securetoken/.test(String(u))) {
    require('fs').appendFileSync(${JSON.stringify(registro)}, String(u).split('?')[0] + '\\n');
    throw new TypeError('fetch failed');
  }
  return f(u, o);
};
`);
  const r = spawnSync(process.execPath, ['--require', spia, '--test', 'tests/unit/contatoriRiquadri.test.mjs'],
    { cwd: RADICE, encoding: 'utf8', timeout: 120000 });
  let chiamate = '';
  try { chiamate = readFileSync(registro, 'utf8'); } catch (_) { /* nessuna chiamata */ }
  expect(chiamate, 'richieste di identità al server vero').toBe('');
  expect(r.status, (r.stdout || '').split('\n').filter((l) => l.startsWith('not ok')).join('\n')).toBe(0);
});
