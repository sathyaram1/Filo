// Verifica #2021 giro 1: la sanatoria di un registro bucato esiste sul server (ownerFiducia, op `sana`), ma l'owner
// non ha una strada per chiederla: né un comando fra gli script né un pulsante nell'app che la mandi.
import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function sorgenti(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...sorgenti(p));
    else if (/\.(m?js)$/.test(n)) out.push(p);
  }
  return out;
}

test('r1 l\'owner ha un comando o un pulsante che chiede al server di sanare il registro di un ramo', () => {
  const chiamanti = [...sorgenti(join(ROOT, 'scripts')), ...sorgenti(join(ROOT, 'src'))].filter((f) => {
    const t = readFileSync(f, 'utf8');
    return /ownerFiducia/.test(t) && /op\s*:\s*['"]sana['"]/.test(t);
  });
  expect(chiamanti, 'nessuno script o pagina dell\'app manda { op: \'sana\' } a ownerFiducia').not.toEqual([]);
});
