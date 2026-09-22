// Verifica #591 — giro 10. Il controllo automatico legge solo due delle tre
// estensioni con cui in questo progetto si scrive un modulo.
//
// La segnalazione chiede un controllo che diventi rosso «se qualcuno chiama i
// provider senza passare da lì». Il controllo apre ogni file del programma che
// finisce in punto js o punto mjs; un modulo scritto con l'altra estensione di
// Node, quella dei moduli a richiesta esplicita, non lo apre nessuno. Dentro
// c'è la stessa riga che altrove lo fa diventare rosso: arriva al modello,
// spende sulla chiave condivisa, non passa dal tetto mensile, non compare in
// nessun conto — e il controllo resta verde.
//
// Ogni caso pulisce il file che ha scritto, anche se fallisce.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SENTINELLA = 'tests/unit/modelGate.test.mjs';

const CHIAMATA = 'async function paga(messaggi) {\n'
  + '  return await globalThis.SN_PROVIDERS.completeWithFallback({ attempts: [], messages: messaggi });\n'
  + '}\n'
  + 'module.exports = { paga };\n';

function sentinellaVedeQuesto(estensione) {
  const file = join(REPO, 'src', 'main', 'services', `__prova-591-g10-estensione.${estensione}`);
  writeFileSync(file, CHIAMATA, 'utf8');
  try {
    execFileSync(process.execPath, ['--test', SENTINELLA], { cwd: REPO, stdio: 'pipe' });
    return false; // verde
  } catch (_) {
    return true; // rossa
  } finally {
    if (existsSync(file)) rmSync(file);
  }
}

test('caso di riscontro: con l\'estensione di sempre il controllo diventa rosso', () => {
  expect(sentinellaVedeQuesto('js')).toBe(true);
});

test('la stessa chiamata con l\'altra estensione di Node deve essere vista', () => {
  expect(
    sentinellaVedeQuesto('cjs'),
    'stessa riga, stessa cartella, stessa spesa sulla chiave condivisa: cambia solo l\'estensione '
    + 'del file, e il controllo automatico non la guarda',
  ).toBe(true);
});
