// Verifica #591 — giro 1. Le porte che la sentinella del cancello unico deve
// vedere.
//
// La richiesta dice: «Una sentinella negli unit test che diventa rossa se
// qualcuno chiama completeWithFallback (o i provider) senza passare da lì».
// Qui si mette alla prova PROPRIO QUELLA promessa: si scrive in un file di Filo
// una chiamata che raggiunge un fornitore saltando il cancello, si lancia la
// sentinella vera e si pretende che diventi rossa.
//
// Ogni caso pulisce il file che ha scritto, anche se fallisce.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SENTINELLA = 'tests/unit/modelGate.test.mjs';

// Scrive `codice` in un modulo temporaneo dentro src/, lancia la sentinella
// vera e dice se è diventata rossa. Il file sparisce sempre.
function sentinellaVedeQuesto(codice, nome) {
  const file = join(REPO, 'src', 'main', 'services', `__prova-591-${nome}.js`);
  writeFileSync(file, codice, 'utf8');
  try {
    execFileSync(process.execPath, ['--test', SENTINELLA], { cwd: REPO, stdio: 'pipe' });
    return false; // verde: la sentinella non ha visto niente
  } catch (_) {
    return true; // rossa: la sentinella ha visto la chiamata
  } finally {
    if (existsSync(file)) rmSync(file);
  }
}

test('la sentinella vede la porta che conosce già', () => {
  // Controllo: se questo fosse verde, tutto il resto del file non vorrebbe dire
  // niente (vorrebbe dire che la sentinella non gira affatto).
  const rossa = sentinellaVedeQuesto(
    'async function paga(messaggi) {\n'
    + '  return await globalThis.SN_PROVIDERS.completeWithFallback({ attempts: [], messages: messaggi });\n'
    + '}\n'
    + 'module.exports = { paga };\n',
    'porta-nota',
  );
  expect(rossa, 'una chiamata diretta al router deve far diventare rossa la sentinella').toBe(true);
});

test('la sentinella vede anche la porta del registro dei fornitori', () => {
  // È la porta VERA: il router stesso trova il fornitore così, prendendolo per
  // nome. Chi scrive questa riga paga con la chiave condivisa dell'owner senza
  // passare dal tetto di spesa e senza comparire in nessun conto — e in Filo
  // c'è già un file che prende un fornitore per nome in questo modo.
  const rossa = sentinellaVedeQuesto(
    'async function paga(messaggi) {\n'
    + '  const P = globalThis.SN_PROVIDER_OPENROUTER;\n'
    + '  return await P.complete({ apiKey: "k", model: "x", messages: messaggi });\n'
    + '}\n'
    + 'module.exports = { paga };\n',
    'porta-registro',
  );
  expect(rossa, 'prendere un fornitore per nome dal registro deve far diventare rossa la sentinella').toBe(true);
});

test('la sentinella non si acceca per una stringa che contiene due barre', () => {
  // La sentinella toglie i commenti prima di guardare. La riga qui sotto non ha
  // commenti: ha una stringa con due barre dentro, e da lì in poi la sentinella
  // non legge più niente — compresa la chiamata al fornitore che segue.
  const rossa = sentinellaVedeQuesto(
    'async function paga(messaggi) {\n'
    + '  const etichetta = "a//b";\n'
    + '  const t = "x//y"; return await globalThis.SN_PROVIDERS.completeWithFallback({ attempts: [], messages: messaggi, t, etichetta });\n'
    + '}\n'
    + 'module.exports = { paga };\n',
    'porta-barre',
  );
  expect(rossa, 'una stringa con due barre non deve nascondere il resto della riga').toBe(true);
});
