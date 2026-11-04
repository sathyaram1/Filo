// Verifica #1732 giro 2, rilievo 1: il freno sulle scansioni decide sulla grafia della richiesta, non su quello che
// Firestore esegue. Due forme che Firestore accetta (provate sul server vero, scheda pubblica, una riga): i nomi dei
// campi in snake_case nel corpo della domanda, e il metodo dichiarato con X-HTTP-Method-Override. Nessuna rete qui.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
const { conFreno } = require(resolve(ROOT, 'scripts', 'lib', 'freno-letture.cjs'));
const B = 'https://firestore.googleapis.com/v1/projects/filo-8b9cb/databases/(default)/documents';

async function passa(input, init) {
  let partita = false;
  const f = conFreno(async () => { partita = true; return { ok: true, status: 200, json: async () => [] }; });
  try { await f(input, init); } catch (e) { if (e && e.code === 'FILO_SCANSIONE_SENZA_CAMPI') return false; throw e; }
  return partita;
}

test('r1 la domanda al database coi nomi in snake_case, senza scelta dei campi, si ferma come quella in camelCase', async () => {
  const camel = { structuredQuery: { from: [{ collectionId: 'feedback' }] } };
  const snake = { structured_query: { from: [{ collection_id: 'feedback' }] } };
  expect(await passa(`${B}:runQuery`, { method: 'POST', body: JSON.stringify(camel) }), 'la forma solita si ferma').toBe(false);
  expect(await passa(`${B}:runQuery`, { method: 'POST', body: JSON.stringify(snake) }), 'la stessa scansione in snake_case').toBe(false);
});

test('r1 la lista REST mandata in POST col metodo GET dichiarato nell\'intestazione si ferma come la GET', async () => {
  const url = `${B}/feedback?pageSize=300`;
  expect(await passa(url, { method: 'GET' }), 'la GET si ferma').toBe(false);
  expect(await passa(url, { method: 'POST', headers: { 'X-HTTP-Method-Override': 'GET' } }), 'la stessa lista in POST').toBe(false);
});
