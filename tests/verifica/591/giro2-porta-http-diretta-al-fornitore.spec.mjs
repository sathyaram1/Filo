// Verifica #591 — giro 2. Un'altra porta che il controllo automatico non vede:
// parlare con il fornitore direttamente in HTTP.
//
// La richiesta dice: «Una sentinella negli unit test che diventa rossa se
// qualcuno chiama completeWithFallback (o i provider) senza passare da lì».
// La sentinella guarda i NOMI con cui il fornitore si raggiunge dentro Filo.
// Non guarda l'indirizzo del fornitore: chi scrive la richiesta HTTP a mano
// arriva allo stesso modello, paga sulla stessa chiave, non passa dal tetto
// mensile e non compare in nessun conto — e la sentinella resta verde.
//
// Non è una strada inventata: in Filo ci sono già due punti che parlano in
// HTTP con quell'indirizzo senza passare dal cancello (l'elenco dei modelli,
// che non costa niente) — è il modello da copiare già scritto, ed è
// esattamente il motivo per cui «quanto resta su una chiave», che pure non
// costa niente, è stato portato dentro il cancello.
//
// Ogni caso pulisce il file che ha scritto, anche se fallisce.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SENTINELLA = 'tests/unit/modelGate.test.mjs';

function sentinellaVedeQuesto(codice, nome) {
  const file = join(REPO, 'src', 'main', 'services', `__prova-591-g2-${nome}.js`);
  writeFileSync(file, codice, 'utf8');
  try {
    execFileSync(process.execPath, ['--test', SENTINELLA], { cwd: REPO, stdio: 'pipe' });
    return false; // verde
  } catch (_) {
    return true; // rossa
  } finally {
    if (existsSync(file)) rmSync(file);
  }
}

test('la sentinella gira davvero (caso di riscontro)', () => {
  const rossa = sentinellaVedeQuesto(
    'async function paga(messaggi) {\n'
    + '  return await globalThis.SN_PROVIDERS.completeWithFallback({ attempts: [], messages: messaggi });\n'
    + '}\n'
    + 'module.exports = { paga };\n',
    'riscontro',
  );
  expect(rossa).toBe(true);
});

test('la sentinella vede anche chi parla col fornitore direttamente in HTTP', () => {
  const rossa = sentinellaVedeQuesto(
    'async function paga(messaggi, chiave) {\n'
    + '  const r = await fetch(\'https://openrouter.ai/api/v1/chat/completions\', {\n'
    + '    method: \'POST\',\n'
    + '    headers: { Authorization: \'Bearer \' + chiave, \'Content-Type\': \'application/json\' },\n'
    + '    body: JSON.stringify({ model: \'un-modello\', messages: messaggi }),\n'
    + '  });\n'
    + '  return (await r.json()).choices[0].message.content;\n'
    + '}\n'
    + 'module.exports = { paga };\n',
    'http-diretto',
  );
  expect(rossa,
    'una richiesta HTTP scritta a mano al fornitore deve far diventare rossa la sentinella').toBe(true);
});
