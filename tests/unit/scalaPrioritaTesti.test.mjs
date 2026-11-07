// La scala delle priorità nei testi (SPEC-MANUTENTORE § 2): la 2 la mette solo il manutentore, quindi nessun testo fa
// nascere a 2 i difetti rimasti di una verifica; e il ruolo non manda l'owner a creare una routine che non parte mai.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leggi = (p) => readFileSync(join(REPO, p), 'utf8').replace(/\s+/g, ' ');

test('i difetti rimasti di una verifica non nascono a priorità 2 in nessun testo', () => {
  assert.doesNotMatch(leggi('src/pages/manage/manage.html'), /figli del lavoro, a priorità 2/);
  assert.doesNotMatch(leggi('routines/roles/_critica-e-livelli.md'), /con la priorità uguale al livello/);
  assert.doesNotMatch(leggi('src/shared/verifierRound.js'), /con priorità uguale al livello\./);
  assert.match(leggi('FEEDBACK-STATES.md'), /a priorità 1, salvo un esterno di livello 3 che nasce a 3/);
});

test('il ruolo del manutentore non chiede una routine sua', () => {
  const t = leggi('routines/roles/manutentore.md');
  assert.doesNotMatch(t, /routine su claude\.ai che il pacemaker accende per te/);
  assert.match(t, /Una routine tua su claude\.ai non c'è e non serve/);
});
