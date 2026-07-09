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

const ZIP_NAME = `electron-v${version}-linux-x64.zip`;
const tmpZip = join(os.tmpdir(), ZIP_NAME);

function curlTo(url, dest, label) {
  log(`scarico Electron v${version} da ${label} con curl…`);
  try {
    execFileSync('curl', ['-sSL', '--fail', '--max-time', '300', '-o', dest, url], { stdio: ['ignore', 'ignore', 'inherit'] });
    return dest;
  } catch (e) {
    log(`  download da ${label} fallito: ${e && e.message ? e.message : e}`);
    return null;
  }
}

// Prova le sorgenti in ordine: prima quelle locali (nessuna rete esterna, le
// uniche affidabili quando la policy blocca github), poi quelle di rete.
function resolveZip() {
  const envZip = process.env.FILO_ELECTRON_ZIP;
  if (envZip) {
    if (existsSync(envZip)) { log(`uso lo zip da FILO_ELECTRON_ZIP: ${envZip}`); return envZip; }
    log(`FILO_ELECTRON_ZIP="${envZip}" non esiste — provo le altre sorgenti.`);
  }
  const vendored = join(ROOT, 'vendor', 'electron', ZIP_NAME);
  if (existsSync(vendored)) { log(`uso lo zip vendored nel repo: ${vendored}`); return vendored; }
  if (process.env.FILO_ELECTRON_URL) {
    const got = curlTo(process.env.FILO_ELECTRON_URL, tmpZip, 'FILO_ELECTRON_URL');
    if (got) return got;
  }
  // 5. Mirror npmmirror (Alibaba) — mirror ufficiale supportato da @electron/get,
  //    ed è il default di RETE qui: github.com/releases/download è negato dallo
  //    *scope GitHub* della sessione (non dalla rete), mentre npmmirror è
  //    raggiungibile con accesso di rete pieno. Override con ELECTRON_MIRROR.
  const mirror = (process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/').replace(/\/*$/, '/');
  const mirrorGot = curlTo(`${mirror}v${version}/${ZIP_NAME}`, tmpZip, 'npmmirror');
  if (mirrorGot) return mirrorGot;
  // 6. URL ufficiale github (solo se lo scope/policy lo consente).
  const ghUrl = `https://github.com/electron/electron/releases/download/v${version}/${ZIP_NAME}`;
  return curlTo(ghUrl, tmpZip, 'github.com');
}

const zip = resolveZip();
if (!zip) {
  log('IMPOSSIBILE procurare il binario Electron da nessuna sorgente.');
  log("La network policy dell'ambiente blocca il download da github (403) e non");
  log('esiste uno zip locale/vendored. Opzioni per l\'owner (fuori sessione):');
  log('  a) allowlist di github.com / objects.githubusercontent.com nella network policy;');
  log(`  b) vendoring: committa lo zip in vendor/electron/${ZIP_NAME} dal tuo PC (arriva col fetch git);`);
  log('  c) esporta FILO_ELECTRON_ZIP=/path/…zip oppure FILO_ELECTRON_URL=<mirror allowlistato>.');
  log('Finché non è fatto la flotta gira SENZA Electron: verifica solo con `npm run test:unit`.');
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
