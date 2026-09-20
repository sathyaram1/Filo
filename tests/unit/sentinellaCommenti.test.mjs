// La prova della sentinella dei commenti: una misura che non diventa mai rossa
// non tiene niente. Qui la si fa girare su un albero finto, pieno di violazioni,
// e si pretende che le nomini tutte.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function corsa(albero) {
  const dir = cartellaTemporanea('filo-commenti-');
  try {
    for (const [nome, testo] of Object.entries(albero)) {
      const dest = join(dir, nome);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, testo);
    }
    // Senza togliere NODE_TEST_CONTEXT il figlio si crede una sotto-prova di
    // questa e risponde in binario invece che in TAP: nessuna riga da leggere.
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

test('un albero pulito passa: la sentinella non è rossa da sola', () => {
  const uscita = corsa({
    'a.css': '/* Intestazione del foglio. */\n\n/* Il perché di questa regola, in una riga. */\n.a { color: red; }\n',
    'b.html': '<!doctype html>\n<html><body>\n<!-- Il perché, in una riga. -->\n<div id="x"></div>\n</body></html>\n',
    'coda-breve.css': '.a { color: red; } /* il perché, in coda */\n.b { margin: 0; } /* due righe in coda:\n   la seconda */\n',
  });
  assert.doesNotMatch(uscita, /not ok \d+ -/, `la sentinella è rossa su un albero in regola:\n${uscita}`);
});

test('le quattro misure diventano rosse quando la regola è violata', () => {
  const uscita = corsa({
    'lungo.css': `/* ${'misura '.repeat(20)}fine */\n.a { color: red; }\n`,
    'data.css': '.a { color: red; }\n/* Deciso il 2026-01-02. */\n.b { color: red; }\n',
    'etichetta.css': '.a { color: red; }\n/* prova-etichetta */\n.prova-etichetta { color: teal; }\n',
    'blocco.css': ['.a { color: red; }', '.b { color: red; }', '.c { color: red; }', '.d { color: red; }',
      '/* riga uno del racconto', '   riga due del racconto', '   riga tre del racconto */', '.e { color: blue; }', ''].join('\n'),
  });
  assert.ok(rosso(uscita, 'nessuna data'), `una data in un commento passa:\n${uscita}`);
  assert.ok(rosso(uscita, 'una riga di commento resta una riga'), `una riga oltre i 120 caratteri passa:\n${uscita}`);
  assert.ok(rosso(uscita, 'un commento a sé non supera le due righe'), `un blocco di tre righe passa:\n${uscita}`);
  assert.ok(rosso(uscita, 'nessuna etichetta che ripete il nome'), `un'etichetta che ripete il selettore passa:\n${uscita}`);
});

// Gli stili e gli script scritti dentro una pagina sono commenti quanto gli
// altri: se la sentinella li salta, metà dei commenti di una pagina resta fuori.
test('anche gli stili e gli script dentro le pagine sono misurati', () => {
  const uscita = corsa({
    'pagina.html': ['<!doctype html>', '<html><body>', '<div>uno</div>', '<style>',
      '/* riga uno', '   riga due', '   riga tre */', '.q { color: red; }', '</style>', '<script>',
      '// riga uno del racconto', '// riga due del racconto', '// riga tre del racconto',
      "const z = '/* non è un commento */';", '</script>', '</body></html>', ''].join('\n'),
  });
  assert.ok(uscita.includes('pagina.html:5'), `lo <style> incorporato non viene guardato:\n${uscita}`);
  assert.ok(uscita.includes('pagina.html:11'), `lo <script> incorporato non viene guardato:\n${uscita}`);
});

// Le due porte trovate dalla verifica del #644: l'esenzione dell'intestazione
// guardava la posizione invece dell'intestazione vera, e una riga vuota
// spezzava in due un muro di commento che il lettore attraversa tutto insieme.
test('tre righe di commento in mezzo al file non passano per intestazione', () => {
  const uscita = corsa({
    'coda.css': ['.a { color: red; }', '/* riga uno del racconto', '   riga due del racconto',
      '   riga tre del racconto */', '.b { color: blue; }', ''].join('\n'),
  });
  assert.ok(rosso(uscita, 'un commento a sé non supera le due righe'),
    `un commento di tre righe alla riga 2 passa per intestazione:\n${uscita}`);
});

test('una riga vuota non spezza il muro: due commenti di fila contano insieme', () => {
  const uscita = corsa({
    'muro.css': ['.a { color: red; }', '/* primo pezzo di racconto', '   secondo pezzo di racconto */', '',
      '/* terzo pezzo di racconto */', '.b { color: blue; }', ''].join('\n'),
  });
  assert.ok(rosso(uscita, 'un commento a sé non supera le due righe'),
    `tre righe di commento separate da una riga vuota passano:\n${uscita}`);
});

// La terza porta della stessa famiglia: chi attacca il commento in coda a una
// riga di codice se lo faceva scendere quanto voleva, fuori da ogni misura.
test('un racconto attaccato in coda a una riga di codice non sfugge alla misura', () => {
  const uscita = corsa({
    'coda.css': ['.a { color: red; } /* riga uno del racconto', '   riga due del racconto',
      '   riga tre del racconto', '   riga quattro del racconto */', '.b { color: blue; }', ''].join('\n'),
  });
  assert.ok(rosso(uscita, 'un commento a sé non supera le due righe'),
    `quattro righe attaccate in coda a una regola passano:\n${uscita}`);

  const inPagina = corsa({
    'coda.html': ['<!doctype html>', '<html><body>', '<div>x</div> <!-- riga uno del racconto',
      '  riga due del racconto', '  riga tre del racconto -->', '<p>y</p>', '</body></html>', ''].join('\n'),
  });
  assert.ok(rosso(inPagina, 'un commento a sé non supera le due righe'),
    `tre righe attaccate in coda a un tag passano:\n${inPagina}`);
});

// La sentinella legge i commenti col lexer di TypeScript: se il progetto non lo
// dichiara fra le sue dipendenze, un giorno sparisce e con lui TUTTI i controlli
// veloci, con un errore che parla di un modulo mancante e non di commenti.
test('gli strumenti che servono alla sentinella sono dichiarati dal progetto', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const dichiarate = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  assert.ok(dichiarate.typescript, 'typescript non è dichiarato in package.json: oggi arriva solo di rimbalzo');
});
