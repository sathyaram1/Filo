// Smoke test: avvia Filo con FILO_SMOKE puntato a un file sentinel,
// l'app scrive lo stato e si chiude; lo script verifica il contenuto.
//
// Uso: node tests/smoke.mjs
//
// Niente Playwright per ora: il bootstrap CDP soffre con configurazioni
// custom di webPreferences. Il sentinel è deterministico e abbastanza.

import { spawn } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// Cartella di output stabile dentro tests/ così posso ispezionare gli
// screenshot. Pulisce e ricrea ogni run.
const outDir = path.join(__dirname, '.smoke');
try { (await import('node:fs')).rmSync(outDir, { recursive: true, force: true }); } catch (_) {}
(await import('node:fs')).mkdirSync(outDir, { recursive: true });
const sentinel = path.join(outDir, 'sentinel.json');

// Usa il binario nativo (no .cmd shim) per evitare problemi di quoting su
// percorsi con spazi su Windows.
const electronModule = path.join(ROOT, 'node_modules', 'electron');
const electronExe = path.join(electronModule, 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

// Chromium si rifiuta di partire come root senza --no-sandbox (crbug.com/638180),
// cosa che rompe questo smoke in ogni container/routine cloud che gira come root.
// Playwright (`_electron.launch`) passa già --no-sandbox in automatico: allineiamoci.
// Lo smoke è solo un harness di boot (scrive un sentinel e chiude), quindi il
// sandbox non serve mai: lo passiamo sempre, così gira identico in locale e in cloud.
const electronArgs = ['--no-sandbox', '.'];

const proc = spawn(electronExe, electronArgs, {
  cwd: ROOT,
  env: { ...process.env, FILO_SMOKE: sentinel, NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const stderrChunks = [];
const stdoutChunks = [];
proc.stderr.on('data', (d) => stderrChunks.push(d));
proc.stdout.on('data', (d) => stdoutChunks.push(d));

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
console.log('  └─ screenshots in:', outDir);
const stdout = Buffer.concat(stdoutChunks).toString();
// Dump tutto lo stdout in un file per ispezione e mostra le righe rilevanti.
const logFile = path.join(outDir, 'main.log');
const fs = await import('node:fs');
fs.writeFileSync(logFile, stdout);
console.log('  └─ main log:', logFile);
const interesting = stdout.split('\n').filter((l) =>
  /\[(smoke|layout|tab:|main|filo)\]/i.test(l) || /Error|Uncaught|fail/i.test(l)
);
if (interesting.length) {
  console.log('--- main process log (filtered) ---');
  for (const l of interesting) console.log('  ' + l);
}
