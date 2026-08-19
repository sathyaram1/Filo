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
const { commandExists, existenceProbes } = require(
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
  assert.equal(await commandExists({ shell: SHELL, command: 'npm' }), true);
});

test('il probe veloce (where.exe) viene PRIMA di Get-Command — guard "firebase rosso"', () => {
  // Il guard sulla velocità era un assert col cronometro (<3s), ma su una
  // macchina carica (suite in parallelo, antivirus su node_modules fresco)
  // anche `where.exe` può metterci secondi: misurava il carico, non la
  // regressione. La regressione vera era l'ORDINE dei probe: Get-Command per
  // primo analizza gli shim .ps1 (~5s) e colorava di rosso comandi validi.
  // Qui si inchioda la struttura, che è ciò che il fix aveva cambiato.
  const probes = existenceProbes({ shell: 'powershell', cmd: 'npm' });
  assert.equal(probes[0].file, 'where.exe', 'where.exe deve essere il primo probe');
  assert.ok(
    probes.slice(1).every((p) => p.file !== 'where.exe'),
    'Get-Command resta solo come fallback',
  );
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

test('un token che sembra codice NON viene eseguito (niente RCE nel controllo)', async () => {
  // Il controllo "esiste questo comando?" gira a ogni battitura nella barra del
  // terminale, PRIMA di premere Invio: se esegue il token, digitare (non
  // lanciare) un comando lo esegue di nascosto. Il renderer inoltra un singolo
  // token senza spazi, quindi il payload qui è senza spazi.
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const sentinel = path.join(os.tmpdir(), `filo-which-rce-${process.pid}.txt`);
  try { fs.unlinkSync(sentinel); } catch (_) { /* non c'era */ }
  const payload = process.platform === 'win32'
    ? `node;[IO.File]::WriteAllText('${sentinel.replace(/\\/g, '/')}','x')`
    : `node;touch '${sentinel}'`;
  await commandExists({ shell: SHELL, command: payload });
  const executed = fs.existsSync(sentinel);
  try { fs.unlinkSync(sentinel); } catch (_) { /* ok */ }
  assert.equal(executed, false, 'il controllo di esistenza NON deve eseguire il token');
});
