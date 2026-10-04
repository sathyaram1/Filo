// Verifica #516 giro 1, rilievo 1: un cambio di cartella scritto con le virgolette
// in mezzo (PowerShell esegue `c""d` come `cd`) dentro un gruppo o un `if` deve
// spostare il perimetro come il `cd` nudo: la lettura dopo non resta al livello 1.
import { test, expect } from '../../fixtures/electron.mjs';

const CTX = { win: true, maiuscole: true, home: 'C:\\Users\\agenti AI', cwd: 'C:\\Users\\agenti AI' };
const livello = (app, cmd) => app.evaluate((_e, { cmd, ctx }) =>
  globalThis.SN_CMD_CLASSIFY.classify(cmd, ctx), { cmd, ctx: CTX });

test('un cd fra virgolette dentro un gruppo o un if non abbassa la lettura che segue', async ({ app }) => {
  // Riferimento: lo stesso spostamento scritto nudo chiede un OK.
  expect(await livello(app, 'cd ~\\.ssh; Get-Content id_rsa')).toBeGreaterThanOrEqual(2);
  for (const cmd of [
    '(c""d ~\\.ssh); Get-Content id_rsa',
    "(c''d ~\\.ssh); Get-Content id_rsa",
    '(c""d C:\\Windows); Get-Content win.ini',
    '(s""l ~\\.ssh); gc id_rsa',
    '(Set-Loc""ation ~\\.ssh); gc id_rsa',
    'if (Test-Path x) { ch""dir ~\\.ssh }; cat id_rsa',
  ]) {
    expect(await livello(app, cmd), cmd).toBeGreaterThanOrEqual(2);
  }
});
