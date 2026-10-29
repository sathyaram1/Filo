// Verifica #1792 giro 1, rilievo 1: la prova «5.000 link resta reattiva» deve accorgersi di un main che esamina i link in
// un blocco solo. Si rilancia quella prova vera con l'esame reso un blocco unico (il primo lotto ferma il main quanto
// l'esame di tutti i link in un colpo): la prova deve diventare rossa sul main fermo.
import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ORIGINE = join(ROOT, 'tests', 'safebrowse-link-prima-del-clic.spec.mjs');
// Il nome «_audit…» è fuori dal repo per .gitignore: la copia non finisce mai in un commit.
const COPIA = join(ROOT, 'tests', '_audit-1792-r1-main-fermo.spec.mjs');

const BLOCCO = `
  await app.evaluate(() => {
    const SB = globalThis.SN_SAFEBROWSE;
    const urls = [];
    for (let i = 0; i < N_TUTTI; i++) urls.push('https://blocco-' + i + '.prova-' + (i % 997) + '.org/p/' + i);
    let primo = true;
    SB.checkLinks = async (lotto) => {
      if (primo) { primo = false; SB.links.esaminaLotto(urls, { checkSync: SB.checkSync }); }
      const r = SB.links.esaminaLotto(lotto, { checkSync: SB.checkSync });
      return { esaminati: r.fatti, fette: 1, segnalati: r.segnalati };
    };
  });
`;

test('r1 la prova dei 5.000 link diventa rossa se il main esamina in un blocco solo', async () => {
  test.setTimeout(300_000);
  const src = readFileSync(ORIGINE, 'utf8');
  const punto = 'const N = 5000;';
  expect(src.split(punto).length, 'il punto in cui si inietta il blocco c\'è, una volta').toBe(2);
  writeFileSync(COPIA, src.replace(punto, punto + BLOCCO.replace('N_TUTTI', 'N')));
  // Lo schermo virtuale di questa corsa non è del figlio: senza, se ne accende uno suo.
  const env = { ...process.env };
  for (const k of ['DISPLAY', 'XAUTHORITY', 'ELECTRON_DISABLE_SANDBOX', 'TEST_WORKER_INDEX', 'TEST_PARALLEL_INDEX']) delete env[k];
  try {
    const r = spawnSync(process.execPath, [join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', COPIA,
      '-g', '5.000 link', '--retries=0', '--workers=1', '--reporter=line'], { cwd: ROOT, env, encoding: 'utf8', timeout: 280_000 });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    expect(out, 'la prova è partita').toMatch(/Running 1 test/);
    expect(out, 'il main fermo in un blocco unico rende rossa la prova').toMatch(/main fermo al più/);
  } finally {
    rmSync(COPIA, { force: true });
  }
});
