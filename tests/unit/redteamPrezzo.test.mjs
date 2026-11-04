// Il prezzo di un tentativo Red Team vive nel riquadro dell'attacco (COST): le frasi che lo ripetono a mano (la
// descrizione che Filo usa per dire cosa sa fare, le regole della pagina) devono dire lo stesso numero (#991).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (f) => readFileSync(join(ROOT, f), 'utf8');

const prezzo = Number(leggi('src/content/redteamAttack.js').match(/const COST = (\d+);/)?.[1]);
const numeri = (testo) => [...String(testo).matchAll(/(\d+)\s+crediti/g)].map((m) => Number(m[1]));

test('il prezzo del tentativo si legge dal riquadro dell’attacco', () => {
  assert.ok(Number.isFinite(prezzo) && prezzo > 0, 'COST non trovato nel riquadro dell’attacco');
});

test('la capacità Red Team dice lo stesso prezzo del riquadro', () => {
  require(join(ROOT, 'src', 'shared', 'capabilities.js'));
  const voce = globalThis.SN_CAPABILITIES.CAPABILITIES.find((c) => c.id === 'red-team');
  assert.ok(voce, 'voce red-team non trovata');
  const detti = numeri(`${voce.desc} ${voce.invoke} ${voce.doesNot || ''}`);
  assert.ok(detti.length > 0, 'la capacità non dice più il prezzo: togli questa prova o rimettilo');
  for (const n of detti) assert.equal(n, prezzo, `la capacità Red Team dice ${n} crediti, il riquadro ${prezzo}`);
});

test('le regole della pagina Red Team dicono lo stesso prezzo del riquadro', () => {
  const detti = numeri(leggi('src/pages/redteam/redteam.js'));
  assert.ok(detti.length > 0);
  for (const n of detti) assert.equal(n, prezzo, `la pagina Red Team dice ${n} crediti, il riquadro ${prezzo}`);
});
