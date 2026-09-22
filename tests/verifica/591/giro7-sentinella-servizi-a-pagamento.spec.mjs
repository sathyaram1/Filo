// Verifica #591 — giro 7. Il controllo automatico non vede i due servizi a
// pagamento che questo lavoro ha portato dentro il passaggio unico.
//
// La richiesta chiede un controllo che diventi rosso «se qualcuno chiama
// completeWithFallback (o i provider) senza passare da lì». Il lavoro ha
// allargato il passaggio unico a due fornitori che non sono modelli e che si
// pagano sulla stessa chiave di fabbrica dell'owner: la ricerca sul web (giro
// 5) e l'elenco dei siti di truffa (giro 6). Il controllo automatico non li
// guarda: né il nome con cui si raggiungono dentro Filo, né il loro indirizzo
// su internet. È la stessa porta del giro 2, un fornitore più in là.
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
  const file = join(REPO, 'src', 'main', 'services', `__prova-591-g7-${nome}.js`);
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

test('la sentinella vede chi si prende la ricerca sul web senza passare dal cancello', () => {
  const rossa = sentinellaVedeQuesto(
    'async function cerca(domanda, chiave) {\n'
    + '  const r = await globalThis.SN_WEB_SEARCH.search({ query: domanda, tavilyKey: chiave });\n'
    + '  return r.results;\n'
    + '}\n'
    + 'module.exports = { cerca };\n',
    'ricerca-per-nome',
  );
  expect(rossa,
    'la ricerca sul web si paga sulla chiave condivisa: chiamarla fuori dal cancello deve diventare rosso').toBe(true);
});

test('la sentinella vede chi scrive a mano la richiesta alla ricerca sul web', () => {
  const rossa = sentinellaVedeQuesto(
    'async function cerca(domanda, chiave) {\n'
    + '  const r = await fetch(\'https://api.tavily.com/search\', {\n'
    + '    method: \'POST\',\n'
    + '    body: JSON.stringify({ api_key: chiave, query: domanda }),\n'
    + '  });\n'
    + '  return (await r.json()).results;\n'
    + '}\n'
    + 'module.exports = { cerca };\n',
    'ricerca-http',
  );
  expect(rossa,
    'l\'indirizzo della ricerca sul web è una porta come quella del fornitore di modelli').toBe(true);
});

test('la sentinella vede chi interroga l\'elenco dei siti di truffa senza passare dal cancello', () => {
  const rossa = sentinellaVedeQuesto(
    'async function guarda(indirizzo, chiave) {\n'
    + '  const r = await fetch(\'https://safebrowsing.googleapis.com/v4/threatMatches:find?key=\' + chiave, {\n'
    + '    method: \'POST\',\n'
    + '    body: JSON.stringify({ threatInfo: { threatEntries: [{ url: indirizzo }] } }),\n'
    + '  });\n'
    + '  return (await r.json()).matches || [];\n'
    + '}\n'
    + 'module.exports = { guarda };\n',
    'elenco-http',
  );
  expect(rossa,
    'l\'elenco dei siti di truffa si paga sulla chiave di fabbrica dell\'owner: fuori dal cancello deve diventare rosso').toBe(true);
});
