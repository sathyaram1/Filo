// Le prove importanti (#2501): il tetto di durata fa rossa una corsa verde troppo lunga, e l'elenco gira su un avvio solo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  leggiArgomenti, verdettoImportanti, controllaElenco, TETTO_S, SPEC, CATENA_AGGIORNAMENTI, CAMMINI,
} from '../../scripts/test-importanti.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('lo spec ha esattamente i cammini dell\'elenco; uno tolto, aggiunto o saltato fa rossa la corsa', () => {
  const spec = readFileSync(resolve(ROOT, SPEC), 'utf8');
  assert.equal(CAMMINI.length, 7, 'l\'elenco di partenza dell\'owner: sette cammini');
  assert.deepEqual(controllaElenco(spec), { ok: true, testo: '' });
  const senzaMenu = spec.replace('test(\'il tasto destro apre il suo menu\'', 'test.skip(\'il tasto destro apre il suo menu\'');
  assert.match(controllaElenco(senzaMenu).testo, /mancano: «il tasto destro apre il suo menu».*saltato/);
  const tolto = spec.replace(/test\('la chat di Filo risponde'[\s\S]*?\n\}\);\n/, '');
  assert.match(controllaElenco(tolto).testo, /mancano: «la chat di Filo risponde»/);
  const inPiu = `${spec}\ntest('un cammino nuovo', async () => {});\n`;
  assert.match(controllaElenco(inPiu).testo, /in più: «un cammino nuovo»/);
  const saltatoDentro = spec.replace('const h = await home(app);', 'test.skip(true, \'per ora\');\n  const h = await home(app);');
  assert.equal(controllaElenco(saltatoDentro).ok, false, 'un salto dentro un cammino lo spegne lo stesso');
});

test('il controllo di fine lavoro lancia le prove importanti su ogni ramo, e rosse ferma', () => {
  const src = readFileSync(resolve(ROOT, 'scripts', 'finish-local.mjs'), 'utf8');
  const i = src.indexOf("join(albero.dir, 'scripts', 'test-importanti.mjs')");
  assert.ok(i > 0, 'il controllo di fine lavoro non lancia più le prove importanti');
  const passo = src.slice(i, src.indexOf('\n    }\n', i));
  assert.match(passo, /run\(process\.execPath, \[importanti\], 'Prove importanti'/);
  assert.match(passo, /process\.exit\(1\)/, 'prove importanti rosse devono fermare la consegna');
});

test('il tetto è di quattro minuti, e sopra la corsa è rossa anche con le prove verdi', () => {
  assert.equal(TETTO_S, 240);
  assert.equal(verdettoImportanti({ codice: 0, durataMs: 239_000 }).codice, 0);
  const lunga = verdettoImportanti({ codice: 0, durataMs: 241_000 });
  assert.equal(lunga.codice, 1);
  assert.match(lunga.testo, /DURATA SOPRA IL TETTO: 241 s contro 240 s/);
  assert.equal(verdettoImportanti({ codice: 1, durataMs: 1000 }).codice, 1);
});

test('--tetto si sceglie per provare il controllo; il resto va a Playwright', () => {
  assert.deepEqual(leggiArgomenti(['--tetto', '5', '--reporter=list']), { tettoS: 5, catena: false, chiavi: '', resto: ['--reporter=list'] });
  assert.ok(leggiArgomenti(['--tetto', 'x']).errore);
  assert.equal(verdettoImportanti({ codice: 0, durataMs: 6000, tettoS: 5 }).codice, 1);
});

test('le chiavi dell\'allarme dicono cosa è rosso: le prove, la durata, la catena', () => {
  assert.deepEqual(verdettoImportanti({ codice: 0, durataMs: 1000 }).chiavi, []);
  assert.deepEqual(verdettoImportanti({ codice: 1, durataMs: 300_000 }).chiavi, ['importanti:rosse', 'importanti:durata']);
  const catena = verdettoImportanti({ codice: 1, durataMs: 900_000, catena: true });
  assert.deepEqual(catena.chiavi, ['importanti:catena-aggiornamenti']);
  assert.equal(catena.sopra, false, 'la catena non ha tetto');
  assert.ok(CATENA_AGGIORNAMENTI.every((f) => existsSync(resolve(ROOT, f))), 'ogni spec della catena esiste');
});

test('npm run test:importanti lancia lo script, e lo spec avvia Filo una volta più il riavvio', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['test:importanti'], 'node scripts/test-importanti.mjs');
  const spec = readFileSync(resolve(ROOT, SPEC), 'utf8');
  assert.equal((spec.match(/electron\.launch\(/g) || []).length, 1, 'un solo punto che avvia Filo');
  assert.equal((spec.match(/await avvia\(\)/g) || []).length, 2, 'l\'avvio e il riavvio del cammino dell\'impostazione');
  assert.match(spec, /test\.describe\.configure\(\{ mode: 'serial' \}\)/);
});
