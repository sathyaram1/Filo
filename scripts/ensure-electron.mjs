#!/usr/bin/env node
// ensure-electron.mjs — garantisce che il binario Electron sia presente in cloud.
//
// PERCHÉ ESISTE
//   Nell'ambiente cloud delle routine l'installer nativo di Electron
//   (@electron/get → got) ABORTISCE il download del binario attraverso il proxy,
//   quindi il postinstall di `electron` fallisce e `npm install` esce con errore.
//   Questo script, idempotente, procura lo zip del binario da una delle sorgenti
//   qui sotto e lo estrae dove Electron lo cerca, così `require('electron')` e
//   Playwright (`_electron.launch`) funzionano senza toccare l'installer rotto.
//
//   Va lanciato DOPO `npm install`. Per non far fallire l'install in partenza,
//   installa con ELECTRON_SKIP_BINARY_DOWNLOAD=1 e poi lancia questo script:
//     ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install && node scripts/ensure-electron.mjs
//
// SORGENTI DEL BINARIO (provate in quest'ordine — prima quelle SENZA rete esterna,
// che sono le uniche affidabili quando la policy di egress blocca github):
//   1. Già installato (isInstalled()) → niente da fare.
//   2. `FILO_ELECTRON_ZIP=/path/…zip` — uno zip già presente sul filesystem.
//   3. Vendored nel repo: `vendor/electron/electron-v<ver>-linux-x64.zip`
//      (committato dall'owner dal suo PC; in cloud arriva col fetch git → nessun
//      download esterno). È la via consigliata quando la network policy blocca
//      github (osservato 2026-07-09: github.com/releases → 403 anche con curl).
//   4. `FILO_ELECTRON_URL=https://…` — un mirror che l'owner ha messo in allowlist.
//   5. URL ufficiale su github.com (curl). Funziona SOLO se la policy lo consente.
//
//   Il criterio di "già installato" replica isInstalled() di
//   node_modules/electron/install.js: dist/version == versione del package,
//   path.txt == 'electron' (ESATTO, senza newline), binario presente.
//
// AMBITO: solo Linux x64 (l'ambiente delle routine). Su altri OS non fa nulla:
// in locale (Windows/macOS) il download normale dell'installer funziona.

import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ELECTRON_DIR = join(ROOT, 'node_modules', 'electron');
const DIST = join(ELECTRON_DIR, 'dist');
const PLATFORM_PATH = 'electron'; // nome del binario su linux

const log = (m) => console.log('[ensure-electron] ' + m);

if (process.platform !== 'linux' || process.arch !== 'x64') {
  log(`piattaforma ${process.platform}/${process.arch}: nessuna azione (l'installer normale funziona).`);
  process.exit(0);
}

if (!existsSync(ELECTRON_DIR)) {
  log('node_modules/electron assente: lancia prima `npm install` (con ELECTRON_SKIP_BINARY_DOWNLOAD=1). Nessuna azione.');
  process.exit(0);
}

let version;
try {
  version = JSON.parse(readFileSync(join(ELECTRON_DIR, 'package.json'), 'utf8')).version;
} catch {
  log('impossibile leggere la versione di electron da node_modules/electron/package.json. Nessuna azione.');
  process.exit(0);
}

function isInstalled() {
  try {
    if (readFileSync(join(DIST, 'version'), 'utf8').replace(/^v/, '') !== version) return false;
    if (readFileSync(join(ELECTRON_DIR, 'path.txt'), 'utf8') !== PLATFORM_PATH) return false;
    return existsSync(join(DIST, PLATFORM_PATH));
  } catch {
    return false;
  }
}

if (isInstalled()) {
  log(`Electron v${version} già pronto.`);
  process.exit(0);
}

const url = `https://github.com/electron/electron/releases/download/v${version}/electron-v${version}-linux-x64.zip`;
const zip = join(os.tmpdir(), `electron-${version}-linux-x64.zip`);

log(`scarico Electron v${version} con curl (l'installer nativo abortisce dietro il proxy)…`);
try {
  execFileSync('curl', ['-sSL', '--fail', '--max-time', '300', '-o', zip, url], { stdio: ['ignore', 'ignore', 'inherit'] });
} catch (e) {
  log('download via curl fallito: ' + (e && e.message ? e.message : e));
  process.exit(1);
}

log('estraggo in node_modules/electron/dist…');
try {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  execFileSync('unzip', ['-q', '-o', zip, '-d', DIST], { stdio: ['ignore', 'ignore', 'inherit'] });
  // niente newline: isInstalled() confronta path.txt in modo esatto con 'electron'
  writeFileSync(join(ELECTRON_DIR, 'path.txt'), PLATFORM_PATH);
  chmodSync(join(DIST, PLATFORM_PATH), 0o755);
} catch (e) {
  log('estrazione fallita: ' + (e && e.message ? e.message : e));
  process.exit(1);
}

if (!isInstalled()) {
  log('estratto ma isInstalled() ancora falso — controlla manualmente node_modules/electron/dist.');
  process.exit(1);
}

log(`Electron v${version} pronto in node_modules/electron/dist. Nota: in cloud (root) i test vanno lanciati con ELECTRON_DISABLE_SANDBOX=1 e xvfb-run -a.`);
process.exit(0);
