// #2292 giro 3 — con la shell cmd un programma chiamato per nome si cerca prima nella cartella corrente:
// dopo un cd in una cartella estratta, `git status` o `where node` avvierebbero il git.exe o il where.exe dell'archivio.
// L'ambiente dei comandi su Windows deve dire a cmd di non guardare lì.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const T = require('../../../src/main/services/terminal.js');

function comeWindows(fn) {
  const prima = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', prima); }
}

test('r2 su Windows cmd non avvia i programmi della cartella corrente', () => {
  const env = comeWindows(() => T.ambienteComandi({ PATH: 'C:\\Windows\\System32', SystemRoot: 'C:\\Windows' }));
  expect(env).toHaveProperty('NoDefaultCurrentDirectoryInExePath');
});
