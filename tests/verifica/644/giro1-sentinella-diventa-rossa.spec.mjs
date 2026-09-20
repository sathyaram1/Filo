// Verifica #644, giro 1 — la sentinella dei commenti serve solo se diventa
// rossa quando la regola viene violata, e anche dentro gli stili e gli script
// incorporati nelle pagine.
//
// La prova sporca src/ con due file inventati, lancia la sentinella e pretende
// che ciascuna delle quattro misure li nomini; poi ripulisce.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CARTELLA = join(ROOT, 'src', 'zz-prova-commenti-644');

const CSS_LUNGO = `/* ${'misura '.repeat(20)}fine */\n.a { color: red; }\n`;
const CSS_BLOCCO = ['.a { color: red; }', '.b { color: red; }', '.c { color: red; }', '.d { color: red; }', '.e { color: red; }',
  '/* riga uno del racconto', '   riga due del racconto', '   riga tre del racconto */', '.f { color: blue; }', ''].join('\n');
const CSS_DATA = '.a { color: red; }\n/* Deciso il 2026-01-02. */\n.b { color: red; }\n';
const CSS_ETICHETTA = '.a { color: red; }\n/* prova-etichetta */\n.prova-etichetta { color: teal; }\n';
const HTML = `<!doctype html>
<html><body>
<div>uno</div>
<style>
/* riga uno
   riga due
   riga tre */
.q { color: red; }
</style>
<script>
// riga uno del racconto
// riga due del racconto
// riga tre del racconto
const z = '/* non è un commento */';
</script>
</body></html>
`;

function sentinella() {
  const r = spawnSync(process.execPath, ['--test', 'tests/unit/commentiRegola.test.mjs'],
    { cwd: ROOT, encoding: 'utf8', timeout: 240000 });
  return `${r.stdout || ''}${r.stderr || ''}`;
}

test('la sentinella dei commenti nomina ogni violazione, anche dentro le pagine', () => {
  let uscita = '';
  try {
    mkdirSync(CARTELLA, { recursive: true });
    writeFileSync(join(CARTELLA, 'lungo.css'), CSS_LUNGO);
    writeFileSync(join(CARTELLA, 'blocco.css'), CSS_BLOCCO);
    writeFileSync(join(CARTELLA, 'data.css'), CSS_DATA);
    writeFileSync(join(CARTELLA, 'etichetta.css'), CSS_ETICHETTA);
    writeFileSync(join(CARTELLA, 'pagina.html'), HTML);
    uscita = sentinella();
  } finally {
    rmSync(CARTELLA, { recursive: true, force: true });
  }

  const rosso = (nome) => new RegExp(`not ok \\d+ - ${nome}`).test(uscita);
  expect(rosso('nessuna data'), 'una data in un commento passa').toBe(true);
  expect(rosso('una riga di commento resta una riga'), 'una riga oltre i 120 caratteri passa').toBe(true);
  expect(rosso('un commento a sé non supera le due righe'), 'un blocco di tre righe passa').toBe(true);
  expect(rosso('nessuna etichetta che ripete il nome'), "un'etichetta che ripete il selettore passa").toBe(true);

  // Gli stili e gli script incorporati nelle pagine sono in regola quanto i
  // file a sé: se la sentinella li salta, la metà dei commenti resta fuori.
  expect(uscita, 'lo <style> incorporato non viene guardato').toContain('zz-prova-commenti-644/pagina.html:5');
  expect(uscita, 'lo <script> incorporato non viene guardato').toContain('zz-prova-commenti-644/pagina.html:11');
});

test('senza violazioni la sentinella è verde: il repo di oggi è in regola', () => {
  const uscita = sentinella();
  expect(uscita, 'la sentinella è rossa sul ramo così com’è').not.toMatch(/not ok \d+ -/);
});
