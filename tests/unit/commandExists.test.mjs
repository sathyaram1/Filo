// Unit test per commandExists (src/main/services/shell.js) — il resolver che
// la dashboard usa in modalità terminale per colorare di rosso un "/comando"
// inesistente. NON è logica pura (spawna il resolver di sistema), ma è
// deterministico abbastanza: usa comandi che esistono sempre in un ambiente di
// sviluppo (node, npm) e nomi palesemente inventati.
//
// REGRESSIONE (#feedback "firebase è rosso ma è valido"): su Windows il vecchio
// resolver passava da `Get-Command`, che per gli shim .ps1/.cmd di npm (firebase,
// e anche `npm` stesso) o ci mette ~5s — oltre il timeout, quindi torna false —
// o sbaglia e torna false comunque. Risultato: comandi validi colorati di rosso.
// Ora si parte da `where.exe` (≈100ms, affidabile per gli eseguibili nel PATH).
// L'assert `commandExists('npm') === true` FALLISCE sul vecchio codice e PASSA
// su quello nuovo (su Windows; su Linux usa `command -v`, valido in entrambi).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const { commandExists } = require(
  join(__dirname, '..', '..', 'src', 'main', 'services', 'shell.js'),
);

const SHELL = process.platform === 'win32' ? 'powershell' : undefined;

test('riconosce un eseguibile sempre presente (node)', async () => {
  assert.equal(await commandExists({ shell: SHELL, command: 'node' }), true);
});

test('riconosce uno shim npm (npm) — guard regressione "firebase rosso"', async () => {
  // npm è sempre installato (serve a far girare l'app). Sul vecchio resolver
  // PowerShell via Get-Command tornava false per questo shim: questo assert è
  // proprio ciò che diventa rosso senza il fix.
  const t = Date.now();
  const exists = await commandExists({ shell: SHELL, command: 'npm' });
  assert.equal(exists, true);
  // E deve essere veloce: il vecchio camminio andava in timeout (~4s) sugli
  // shim pesanti. `where` risolve in ~100ms.
  assert.ok(Date.now() - t < 3000, 'la verifica deve risolvere ben sotto il timeout');
});

test('NON riconosce un nome palesemente inventato', async () => {
  assert.equal(
    await commandExists({ shell: SHELL, command: 'questocomandononesistedavvero_xyz123' }),
    false,
  );
});

test('input vuoto o solo spazi → non esiste', async () => {
  assert.equal(await commandExists({ shell: SHELL, command: '' }), false);
  assert.equal(await commandExists({ shell: SHELL, command: '   ' }), false);
  assert.equal(await commandExists({ shell: SHELL, command: undefined }), false);
});

test('un nome con newline/null (tentativo di iniezione) → non esiste', async () => {
  assert.equal(await commandExists({ shell: SHELL, command: 'node\necho hacked' }), false);
  assert.equal(await commandExists({ shell: SHELL, command: 'node\0' }), false);
});
