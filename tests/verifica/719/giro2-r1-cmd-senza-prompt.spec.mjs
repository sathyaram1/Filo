// Verifica #719, giro 2, rilievo 1: con /q cmd non mostra il prompt, e la riga di «pronto» affidata al prompt non arriva.
// Su Windows gira cmd vero; altrove un cmd finto che segue la regola documentata (echo spento = niente prompt,
// la stessa che si vede col cmd di Wine). Senza la riga di pronto la sessione non parte e il comando scade.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const T = require(join(ROOT, 'src', 'main', 'services', 'terminal.js'));
const WIN = process.platform === 'win32';

// Un cmd minimo: prompt ed eco dei comandi solo con l'eco acceso, `echo` con `>` e le variabili dell'esito.
const CMD_FINTO = `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
let eco = !process.argv.slice(2).some((a) => a.toLowerCase() === '/q');
let prompt = '$P$G'; let livello = 0; let resto = '';
const cwd = () => process.cwd();
const mostraPrompt = () => { if (eco) process.stdout.write('\\r\\n' + prompt.replace(/\\$_/g, '\\r\\n').replace(/\\$P/g, cwd()).replace(/\\$G/g, '>')); };
const espandi = (s) => s.replace(/%errorlevel%/gi, String(livello)).replace(/%cd%/gi, cwd());
function esegui(riga) {
  if (eco) process.stdout.write(riga + '\\r\\n');
  const r = riga.trim();
  if (!r) return;
  if (/^chcp\\b/i.test(r)) { livello = 0; return; }
  if (/^prompt\\s/i.test(r)) { prompt = r.slice(7); return; }
  if (/^echo off$/i.test(r)) { eco = false; return; }
  if (/^echo on$/i.test(r)) { eco = true; return; }
  if (/^echo[\\s.]/i.test(r)) {
    const testo = espandi(r.slice(5));
    const i = testo.indexOf('>');
    if (i === -1) process.stdout.write(testo + '\\r\\n');
    else fs.writeFileSync(path.resolve(cwd(), testo.slice(i + 1).trim().replace(/^"|"$/g, '')), testo.slice(0, i) + '\\r\\n');
    livello = 0; return;
  }
  process.stderr.write("'" + r.split(/\\s/)[0] + "' non è riconosciuto come comando interno o esterno.\\r\\n");
  livello = 9009;
}
mostraPrompt();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  resto += c; let n;
  while ((n = resto.indexOf('\\n')) !== -1) { const riga = resto.slice(0, n).replace(/\\r$/, ''); resto = resto.slice(n + 1); esegui(riga); mostraPrompt(); }
});
process.stdin.on('end', () => process.exit(livello));
`;

async function conCmd(fn) {
  if (WIN) return fn();
  const dir = cartellaTemporanea('filo-719-cmd-');
  const finto = join(dir, 'cmd-finto.js');
  writeFileSync(finto, CMD_FINTO);
  chmodSync(finto, 0o755);
  // Allo scadere la sessione chiude l'albero con taskkill: qui ne fa le veci un kill.
  writeFileSync(join(dir, 'taskkill'), '#!/bin/sh\nkill -9 "$2" 2>/dev/null\nexit 0\n');
  chmodSync(join(dir, 'taskkill'), 0o755);
  const percorso = process.env.PATH;
  process.env.PATH = dir + ':' + percorso;
  const piattaforma = Object.getOwnPropertyDescriptor(process, 'platform');
  const comSpec = process.env.ComSpec;
  process.env.ComSpec = finto;
  Object.defineProperty(process, 'platform', { ...piattaforma, value: 'win32' });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', piattaforma);
    process.env.PATH = percorso;
    if (comSpec === undefined) delete process.env.ComSpec; else process.env.ComSpec = comSpec;
  }
}

test('con cmd nelle Preferenze, «echo x > prova.txt» chiesto a Filo crea il file', async () => {
  test.setTimeout(60_000);
  const qui = cartellaTemporanea('filo-719-');
  const out = await conCmd(() => T.runCommand('echo x> prova.txt', { shell: 'cmd', cwd: qui, trackCwd: true, timeoutMs: 15_000 }));
  expect(out.timedOut, 'la sessione di cmd non è mai partita: il comando è scaduto').toBe(false);
  expect(out.code).toBe(0);
  expect(existsSync(join(qui, 'prova.txt')), 'il file non c\'è').toBe(true);
  expect(readFileSync(join(qui, 'prova.txt'), 'utf8').trim()).toBe('x');
});
