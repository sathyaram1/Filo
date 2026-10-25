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
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const { commandExists, existenceProbes, esitoDeiProbe } = require(
  join(__dirname, '..', '..', 'src', 'main', 'services', 'shell.js'),
);

const SHELL = process.platform === 'win32' ? 'powershell' : undefined;
// La risposta vera del sistema, non i dieci secondi del prodotto: con la macchina carica non bastano (#1063).
const SISTEMA = { shell: SHELL, attesaMs: TETTO_ATTESA_MS };

test('riconosce un eseguibile sempre presente (node)', async () => {
  assert.equal(await commandExists({ ...SISTEMA, command: 'node' }), true);
});

test('riconosce uno shim npm (npm) — guard regressione "firebase rosso"', async () => {
  // npm è sempre installato (serve a far girare l'app). Sul vecchio resolver
  // PowerShell via Get-Command tornava false per questo shim: questo assert è
  // proprio ciò che diventa rosso senza il fix.
  assert.equal(await commandExists({ ...SISTEMA, command: 'npm' }), true);
});

// `where.exe` e Get-Command sono programmi di Windows: fuori da lì il resolver
// usa `command -v` e questo assert non ha niente da dire (misurerebbe solo su
// che macchina gira la suite). Prima non era condizionato e diventava rosso su
// Mac e Linux — un rosso che non segnala nessuna regressione.
test('il probe veloce (where.exe) viene PRIMA di Get-Command — guard "firebase rosso"', { skip: process.platform !== 'win32' ? 'vale solo su Windows' : false }, () => {
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
    await commandExists({ ...SISTEMA, command: 'questocomandononesistedavvero_xyz123' }),
    false,
  );
});

test('input vuoto o solo spazi → non esiste', async () => {
  assert.equal(await commandExists({ ...SISTEMA, command: '' }), false);
  assert.equal(await commandExists({ ...SISTEMA, command: '   ' }), false);
  assert.equal(await commandExists({ ...SISTEMA, command: undefined }), false);
});

test('un nome con newline/null (tentativo di iniezione) → non esiste', async () => {
  assert.equal(await commandExists({ ...SISTEMA, command: 'node\necho hacked' }), false);
  assert.equal(await commandExists({ ...SISTEMA, command: 'node\0' }), false);
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
  await commandExists({ ...SISTEMA, command: payload });
  const executed = fs.existsSync(sentinel);
  try { fs.unlinkSync(sentinel); } catch (_) { /* ok */ }
  assert.equal(executed, false, 'il controllo di esistenza NON deve eseguire il token');
});

// #1176 — con la macchina carica il controllo scade, e uno scaduto finiva come «non esiste»: rosso su un comando valido.
// Qui i probe sono processi veri con un esito noto, così la regola si prova senza dipendere dal carico.
const esce = (codice) => ({ file: process.execPath, args: ['-e', `process.exit(${codice})`] });
const restaAppeso = { file: process.execPath, args: ['-e', 'setInterval(() => {}, 1 << 30)'] };
const nonParte = { file: 'filo-programma-che-non-esiste-1176', args: [] };
// Il probe appeso lo fa scadere la prova stessa: è il tempo dato al codice, non una guardia contro l'appeso.
const SCADE_SUBITO_MS = 300;

test('#1176: un probe scaduto non è un «non esiste»', async () => {
  assert.equal(await esitoDeiProbe([restaAppeso], undefined, SCADE_SUBITO_MS), null);
});

test('#1176: un probe che non parte non è un «non esiste»', async () => {
  assert.equal(await esitoDeiProbe([nonParte], undefined, TETTO_ATTESA_MS), null);
});

test('#1176: il «no» del secondo probe non basta se il primo non ha risposto', async () => {
  // È il caso di PowerShell: `where.exe` scaduto, poi Get-Command che sbaglia sugli shim npm.
  assert.equal(await esitoDeiProbe([nonParte, esce(1)], undefined, TETTO_ATTESA_MS), null);
  assert.equal(await esitoDeiProbe([esce(1), restaAppeso], undefined, SCADE_SUBITO_MS), null);
});

test('#1176: un probe che conferma basta anche dopo uno incerto, e solo tutti «no» fanno un «non esiste»', async () => {
  assert.equal(await esitoDeiProbe([nonParte, esce(0)], undefined, TETTO_ATTESA_MS), true);
  assert.equal(await esitoDeiProbe([esce(1), esce(1)], undefined, TETTO_ATTESA_MS), false);
  assert.equal(await esitoDeiProbe([esce(2)], undefined, TETTO_ATTESA_MS), false);
});

// #892.1 — su Windows una / seguita dal percorso di un documento che esiste è un messaggio per Filo, non un programma:
// conta solo un'estensione che Windows esegue, scritta o sottintesa. Il ramo di Windows si prova fingendo la piattaforma.
test('#892.1: su Windows un documento al percorso non è un programma, un eseguibile sì', async () => {
  const { writeFileSync } = await import('node:fs');
  const { cartellaTemporanea } = await import('../helpers/percorsi.mjs');
  const dir = cartellaTemporanea('filo-892-1-');
  for (const f of ['lettera.docx', 'foto.jpg', 'setup.exe', 'avvia.cmd', 'build.ps1']) writeFileSync(join(dir, f), 'x');
  const vera = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    const c = (command, shell = 'powershell') => commandExists({ shell, cwd: dir, command, attesaMs: 2000 });
    assert.equal(await c(join(dir, 'lettera.docx')), false);
    assert.equal(await c(join(dir, 'foto.jpg')), false);
    assert.equal(await c(dir), false, 'una cartella non è un programma');
    assert.equal(await c(join(dir, 'setup.exe')), true);
    assert.equal(await c(join(dir, 'avvia')), true, 'l\'estensione sottintesa vale come in Windows');
    assert.equal(await c('./build.ps1'), true);
    assert.equal(await c(join(dir, 'foto.jpg'), 'bash'), true, 'in WSL decide il bit d\'esecuzione, che da qui non si vede');
  } finally {
    Object.defineProperty(process, 'platform', vera);
  }
});
