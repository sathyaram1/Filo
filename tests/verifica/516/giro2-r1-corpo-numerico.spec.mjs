// Verifica #516 giro 2, rilievo 1: un `if` di sole letture il cui ramo restituisce un
// numero o un booleano (`else { 0 }`, `{ $true }`) deve valere come quello con una stringa.
import { test, expect } from '../../fixtures/electron.mjs';

const CTX = { win: true, maiuscole: true, home: 'C:\\Users\\agenti AI', cwd: 'C:\\Users\\agenti AI' };
const livello = (app, cmd) => app.evaluate((_e, { cmd, ctx }) =>
  globalThis.SN_CMD_CLASSIFY.classify(cmd, ctx), { cmd, ctx: CTX });

test('un if di sole letture con un numero o un booleano in un ramo esegue senza conferma', async ({ app }) => {
  // Riferimento: con una stringa nel ramo è già sola lettura.
  expect(await livello(app, 'if (Test-Path Downloads) { (Get-ChildItem Downloads).Count } else { "0" }')).toBe(1);
  for (const cmd of [
    'if (Test-Path Downloads) { (Get-ChildItem Downloads).Count } else { 0 }',
    'if (Test-Path x) { (gci x).Count } else { -1 }',
    'if (Test-Path Downloads) { 1 } else { 0 }',
    'if (Test-Path Downloads) { $true } else { $false }',
  ]) {
    expect(await livello(app, cmd), cmd).toBe(1);
  }
});
