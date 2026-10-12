// Verifica #1072.1 giro 1: con cmd l'apice singolo è testo, non virgolette; il classificatore non deve leggerlo come PowerShell.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
require(resolve(APP_ROOT, 'src', 'shared', 'cmdClassify.js'));
const C = globalThis.SN_CMD_CLASSIFY;
const WIN_CMD = { win: true, maiuscole: true, home: 'C:\\Users\\nome', cwd: 'C:\\Users\\nome\\Documenti', reti: [], shell: 'cmd' };

test('r1 con cmd gli apici non nascondono la chiave SSH né un computer di rete', () => {
  const casi = [
    // cmd passa a findstr `'`, `x`, il percorso della chiave, `'`: con /v stampa la chiave intera.
    ["findstr /v ' x C:\\Users\\nome\\.ssh\\id_rsa '", /nascosto/],
    // dir riceve `'`, `\\host\x`, `'`: elenca la cartella dell'altro computer.
    ["dir ' \\\\host\\x '", /rete/],
  ];
  for (const [cmd, motivo] of casi) {
    const d = C.classifyDetail(cmd, WIN_CMD);
    expect(d.level, cmd).toBeGreaterThanOrEqual(2);
    if (d.level === 2) expect(d.motivo, cmd).toMatch(motivo);
  }
});
