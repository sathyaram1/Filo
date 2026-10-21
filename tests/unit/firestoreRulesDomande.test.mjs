// Sentinella sulle regole Firestore delle domande all'owner (#1149): le legge solo l'admin e nessun client le
// scrive, nemmeno l'admin. Autore e fiducia dei turni li decide il server: una scrittura client fingerebbe l'owner.
// Il contatore delle domande non sta in `counters/`, che si legge senza credenziali.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');

function blocco(testo, percorso) {
  const apre = testo.indexOf(`match ${percorso} {`);
  if (apre < 0) return null;
  const i = testo.indexOf('{', apre + `match ${percorso}`.length);
  let livello = 0;
  for (let j = i; j < testo.length; j++) {
    if (testo[j] === '{') livello++;
    else if (testo[j] === '}') {
      livello--;
      if (livello === 0) return testo.slice(i + 1, j);
    }
  }
  return null;
}

function regole(corpo) {
  const senzaCommenti = corpo.replace(/\/\/[^\n]*/g, '');
  return [...senzaCommenti.matchAll(/allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g)]
    .map((m) => ({ verbi: m[1].split(',').map((v) => v.trim()), cond: m[2].replace(/\s+/g, ' ').trim() }));
}

test('domande: lettura solo admin, scrittura negata a tutti', () => {
  const corpo = blocco(RULES, '/domande/{id}');
  assert.ok(corpo, 'manca il blocco match /domande/{id}');
  const rs = regole(corpo);
  assert.deepEqual(rs, [
    { verbi: ['read'], cond: 'isAdmin()' },
    { verbi: ['write'], cond: 'false' },
  ]);
});

test('domande: nessun altro blocco le apre, e il loro contatore non sta fra i contatori pubblici', () => {
  const aperture = [...RULES.matchAll(/match\s+\/domande\b/g)];
  assert.equal(aperture.length, 1, 'un solo blocco per le domande');
  assert.ok(!/match\s+\/\{[^}]+=\*\*\}/.test(RULES), 'un jolly ricorsivo aprirebbe anche le domande');
  assert.ok(!/contatore-domande|domande-counter/.test(blocco(RULES, '/counters/{name}') || ''), 'il numero delle domande è server-only');
});
