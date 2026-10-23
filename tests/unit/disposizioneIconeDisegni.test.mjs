// #1343 — nella barra laterale un'icona spostabile non ha il disegno di una voce fissa in fondo: con «Altro…» aperto
// «Opzioni Filo» e «Impostazioni» stavano a poche icone di distanza con lo stesso ingranaggio, e fanno cose diverse.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(join(ROOT, 'src/shared/disposizioneIcone.js'));
const D = globalThis.SN_DISPOSIZIONE_ICONE;

test('nessuna icona della barra o di «Altro…» ha il disegno di una voce fissa in fondo alla barra', () => {
  const sorgente = readFileSync(join(ROOT, 'src/renderer/barra.js'), 'utf8');
  const fisse = [...sorgente.matchAll(/\{ comando: '([a-z]+)', icona: '([A-Za-z]+)'/g)].map((m) => [m[1], m[2]]);
  assert.ok(fisse.length >= 4, 'le voci fisse in fondo alla barra si leggono');
  const disegni = new Map(fisse.map(([comando, icona]) => [icona, comando]));
  for (const [id, d] of Object.entries(D.ICONE)) {
    assert.ok(!disegni.has(d.icona), `«${id}» ha lo stesso disegno della voce fissa «${disegni.get(d.icona)}»`);
  }
});
