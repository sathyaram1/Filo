// L'invio Red Team non ha più un prezzo (#2296): il saldo lo scriveva il client, il freno sono i tetti del server.
// Nessuna frase che legge l'utente (riquadro dell'attacco, capacità, regole della pagina) promette un costo a tentativo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (f) => readFileSync(join(ROOT, f), 'utf8');

const PREZZO = /(costa|costo)\s+\d+\s*(crediti|cr)\b|\d+\s*(crediti|cr)\s+per\s+tentativo|·\s*\$\{?COST|const COST\b|insufficient_credits/i;

test('il riquadro dell’attacco non chiede crediti e non li legge', () => {
  const src = leggi('src/content/redteamAttack.js');
  assert.doesNotMatch(src, PREZZO);
  assert.doesNotMatch(src, /GET_CREDITS/, 'il saldo non decide più se si può inviare');
});

test('la capacità Red Team non promette un prezzo a tentativo', () => {
  require(join(ROOT, 'src', 'shared', 'capabilities.js'));
  const voce = globalThis.SN_CAPABILITIES.CAPABILITIES.find((c) => c.id === 'red-team');
  assert.ok(voce, 'voce red-team non trovata');
  assert.doesNotMatch(`${voce.desc} ${voce.invoke} ${voce.doesNot || ''}`, PREZZO);
});

test('le regole della pagina Red Team non promettono un prezzo a tentativo', () => {
  assert.doesNotMatch(leggi('src/pages/redteam/redteam.js'), PREZZO);
});
