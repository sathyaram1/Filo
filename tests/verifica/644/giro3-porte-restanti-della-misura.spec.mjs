// Verifica #644, giro 3 — quel che resta aperto della misura dei commenti.
//
// I giri 1 e 2 hanno chiuso tre strade per tenersi un racconto lungo
// (intestazione per posizione, riga vuota che spezzava il muro, commento in
// coda a una riga). Qui stanno le altre, tutte insieme: una della stessa
// famiglia, e due in cui la misura non guarda proprio.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function corsa(albero) {
  const dir = cartellaTemporanea('filo-commenti-g3-');
  try {
    for (const [nome, testo] of Object.entries(albero)) {
      const dest = join(dir, nome);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, testo);
    }
    const env = { ...process.env, FILO_COMMENTI_ROOT: dir };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ['--test', 'tests/unit/commentiRegola.test.mjs'], {
      cwd: ROOT, encoding: 'utf8', timeout: 240000, env,
    });
    return `${r.stdout || ''}${r.stderr || ''}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rosso = (uscita, nome) => new RegExp(`not ok \\d+ - ${nome}`).test(uscita);
const BLOCCHI = 'un commento a sé non supera le due righe';

test('il commento in coda non azzera il muro che continua sotto', () => {
  const uscita = corsa({
    'coda-poi-blocco.css': ['.a { color: red; } /* riga uno del racconto',
      '   riga due del racconto */',
      '/* riga tre del racconto',
      '   riga quattro del racconto */',
      '.b { color: blue; }', ''].join('\n'),
  });
  expect(rosso(uscita, BLOCCHI),
    `quattro righe di commento di fila passano, perché quello in coda spezza il conto:\n${uscita}`).toBe(true);
});

test('un <script> scritto dentro un commento non spegne la misura sul resto della pagina', () => {
  const uscita = corsa({
    'spenta.html': ['<!doctype html>', '<html><body>',
      '<!-- qui si nomina un <script> e non lo si chiude mai -->',
      '<!-- riga uno del racconto',
      '     riga due del racconto',
      '     riga tre del racconto',
      '     riga quattro del racconto -->',
      '</body></html>', ''].join('\n'),
  });
  expect(rosso(uscita, BLOCCHI),
    `dopo un <script> nominato dentro un commento, i commenti sotto non vengono più guardati:\n${uscita}`).toBe(true);
});

test('i commenti dentro un modello o dentro un attributo di stile sono misurati come gli altri', () => {
  const modello = corsa({
    'modello.html': ['<!doctype html>', '<html><body>', '<script type="text/template">',
      '<!-- riga uno del racconto', '     riga due del racconto',
      '     riga tre del racconto', '     riga quattro del racconto -->',
      '</script>', '</body></html>', ''].join('\n'),
  });
  expect(rosso(modello, BLOCCHI),
    `un racconto dentro uno <script> non di codice non viene guardato da nessuna delle due parti:\n${modello}`).toBe(true);

  const attributo = corsa({
    'attributo.html': ['<!doctype html>', '<html><body>',
      '<div style="color: red; /* riga uno del racconto',
      '   riga due del racconto',
      '   riga tre del racconto',
      '   riga quattro del racconto */">x</div>',
      '</body></html>', ''].join('\n'),
  });
  expect(rosso(attributo, BLOCCHI),
    `un racconto dentro un attributo style non viene guardato:\n${attributo}`).toBe(true);
});

test('una data scritta a parole o con l’anno a due cifre è cronologia quanto le altre', () => {
  const uscita = corsa({
    'data.css': ['/* Deciso a settembre 2026, poi rivisto il 18/09/26. */', '.a { color: red; }', ''].join('\n'),
  });
  expect(rosso(uscita, 'nessuna data'),
    `una data a parole e una con l'anno a due cifre passano:\n${uscita}`).toBe(true);
});
