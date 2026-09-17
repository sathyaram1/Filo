// Prove del giro 1 (verifica locale) sul lavoro «seguito del giro»,
// punto E: nel lavoro di release, quando la pubblicazione si ferma perché
// main si è mosso, il riassunto del job (GITHUB_STEP_SUMMARY) lo dice con lo
// sha provato e quello attuale, in tutti e due i punti di controllo, e la
// sentinella lo pretende. Il workflow non si può eseguire qui: si legge com'è
// e si prova la sentinella per mutazione (una copia del repo senza l'uno o
// l'altro riassunto deve farla diventare rossa).

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const YML = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
const senzaCommenti = (s) => s.split(/\r?\n/).filter((r) => !/^\s*#/.test(r)).join('\n');

/** Il blocco `if … fi` che comincia alla riga data. */
function bloccoIf(testo, apertura) {
  const i = testo.indexOf(apertura);
  expect(i, `manca «${apertura}»`).toBeGreaterThanOrEqual(0);
  const resto = testo.slice(i);
  const fine = resto.search(/^\s*fi\s*$/m);
  expect(fine).toBeGreaterThan(0);
  return resto.slice(0, fine);
}

test.describe('lavoro di release — main si è mosso: il riassunto del job lo dice, in tutti e due i fermi', () => {
  test('primo fermo (dopo la suite): dentro l\'if, con lo sha provato e quello attuale', () => {
    const b = bloccoIf(senzaCommenti(YML), 'if [ "$QUI" != "$PROVATO" ]');
    expect(b).toMatch(/should_release=false/);
    expect(b).toMatch(/>>\s*"\$GITHUB_STEP_SUMMARY"/);
    const riassunto = b.slice(b.indexOf('{'), b.indexOf('GITHUB_STEP_SUMMARY'));
    expect(riassunto).toMatch(/\$\{PROVATO/);
    expect(riassunto).toMatch(/\$QUI/);
    expect(riassunto).toMatch(/main si e' mosso/);
  });

  test('secondo fermo (dopo il numero di versione): dentro l\'if, prima dell\'uscita, con lo sha provato e quello sotto la release', () => {
    const b = bloccoIf(senzaCommenti(YML), 'if [ "$SOTTO" != "$PROVATO" ]');
    expect(b).toMatch(/>>\s*"\$GITHUB_STEP_SUMMARY"/);
    expect(b.indexOf('GITHUB_STEP_SUMMARY')).toBeLessThan(b.indexOf('exit 1'));
    const riassunto = b.slice(b.indexOf('{'), b.indexOf('GITHUB_STEP_SUMMARY'));
    expect(riassunto).toMatch(/\$\{PROVATO/);
    expect(riassunto).toMatch(/\$SOTTO/);
    expect(riassunto).toMatch(/main si e' mosso/);
  });

  test('la sentinella (unit test) diventa rossa se uno dei due riassunti sparisce', () => {
    const base = cartellaTemporanea('giro1-release-sentinella-');
    const copia = (rel) => {
      mkdirSync(dirname(join(base, rel)), { recursive: true });
      cpSync(join(ROOT, rel), join(base, rel), { recursive: true });
    };
    for (const rel of ['tests/unit/releaseSuite.test.mjs', 'tests/rossi-noti.json', 'CLAUDE.md', 'routines/roles', '.github/workflows/release.yml']) copia(rel);
    const lancia = () => spawnSync(process.execPath, ['--test', 'tests/unit/releaseSuite.test.mjs'], { cwd: base, encoding: 'utf8' });
    expect(lancia().status, 'la copia intatta deve essere verde').toBe(0);
    const yml = join(base, '.github', 'workflows', 'release.yml');
    const senza = (quale) => {
      let n = 0;
      writeFileSync(yml, YML.split('\n').filter((r) => !(/GITHUB_STEP_SUMMARY/.test(r) && ++n === quale)).join('\n'));
    };
    senza(1);
    let r = lancia();
    expect(r.status, 'senza il primo riassunto').not.toBe(0);
    expect(r.stdout).toMatch(/riassunto/);
    senza(2);
    r = lancia();
    expect(r.status, 'senza il secondo riassunto').not.toBe(0);
    expect(r.stdout).toMatch(/riassunto/);
  });
});
