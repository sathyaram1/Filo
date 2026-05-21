// Smoke test: avvia Filo con FILO_SMOKE puntato a un file sentinel,
// l'app scrive lo stato e si chiude; lo script verifica il contenuto.
//
// Uso: node tests/smoke.mjs
//
// Niente Playwright per ora: il bootstrap CDP soffre con configurazioni
// custom di webPreferences. Il sentinel è deterministico e abbastanza.

import { spawn } from 'node:child_process';
import { readFileSync, unlinkSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const sentinel = path.join(mkdtempSync(path.join(tmpdir(), 'filo-smoke-')), 'sentinel.json');

// Usa il binario nativo (no .cmd shim) per evitare problemi di quoting su
// percorsi con spazi su Windows.
const electronModule = path.join(ROOT, 'node_modules', 'electron');
const electronExe = path.join(electronModule, 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

const proc = spawn(electronExe, ['.'], {
  cwd: ROOT,
  env: { ...process.env, FILO_SMOKE: sentinel, NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const stderrChunks = [];
proc.stderr.on('data', (d) => stderrChunks.push(d));

const startedAt = Date.now();
const TIMEOUT = 20_000;
const POLL = 250;

let result = null;
while (Date.now() - startedAt < TIMEOUT) {
  if (existsSync(sentinel)) {
    try {
      result = JSON.parse(readFileSync(sentinel, 'utf8'));
      break;
    } catch (_) { /* il main potrebbe star ancora scrivendo */ }
  }
  await new Promise((r) => setTimeout(r, POLL));
}

try { proc.kill('SIGTERM'); } catch (_) {}
try { unlinkSync(sentinel); } catch (_) {}

if (!result) {
  console.error('[smoke] FAIL: sentinel non scritto entro', TIMEOUT, 'ms');
  console.error('[smoke] stderr:', Buffer.concat(stderrChunks).toString().slice(-2000));
  process.exit(1);
}

const { tabs } = result;
const ok = tabs && tabs.tabs && tabs.tabs.length === 1
  && tabs.tabs[0].url === 'filo://newtab/'
  && tabs.tabs[0].isInternal
  && !tabs.tabs[0].loading;

if (!ok) {
  console.error('[smoke] FAIL: stato tabs inatteso', JSON.stringify(tabs, null, 2));
  process.exit(1);
}

console.log('[smoke] OK ✓');
console.log('  └─ tab url:', tabs.tabs[0].url);
console.log('  └─ tab title:', tabs.tabs[0].title);
console.log('  └─ favicon:', tabs.tabs[0].favicon);
