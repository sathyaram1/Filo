// #1909.3 giro 1, rilievo 1: un comando che cancella senza cestino, lanciato da git o da PowerShell con le opzioni
// scritte in un'altra forma valida, a Normale vuole la parola «conferma» come quello scritto nella forma solita.
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

test('r1 git clean con -C o -c davanti e pwsh -EncodedCommand abbreviato vogliono la parola a Normale', async ({ app }) => {
  const dir = cartellaInCasa('filo-rm-opzioni-');
  const file = join(dir, 'a.txt');
  writeFileSync(file, 'x');
  await livelloAutonomia(app, 'default');
  // Base: le forme solite chiedono già la parola.
  for (const comando of [`git clean -fdx "${dir}"`, 'pwsh -enc UgBlAG0AbwB2AGUA']) {
    const c = await execAction(app, { type: 'ESEGUI_COMANDO', comando, spiegazione: 'Pulisco' }, {});
    expect(c.needsConfirm, comando).toBe(3);
  }
  const comandi = [
    `git -C "${dir}" clean -fdx`,
    `git -c core.quotepath=off clean -fdx "${dir}"`,
    'pwsh -enco UgBlAG0AbwB2AGUA',
    'powershell -NoProfile -encoded UgBlAG0AbwB2AGUA',
  ];
  const senzaParola = [];
  for (const comando of comandi) {
    const c = await execAction(app, { type: 'ESEGUI_COMANDO', comando, spiegazione: 'Pulisco' }, {});
    if (c.executed || c.needsConfirm !== 3) senzaParola.push(`${comando} → ${c.executed ? 'eseguito' : `riquadro ${c.needsConfirm}`}`);
  }
  expect(senzaParola).toEqual([]);
  expect(existsSync(file)).toBe(true);
});

test('esplorazione rsync', async ({ app }) => {
  await livelloAutonomia(app, 'default');
  for (const comando of ['rsync -a --delete vuota/ ~/Documenti/', 'robocopy vuota C:\\x /MIR']) {
    const c = await execAction(app, { type: 'ESEGUI_COMANDO', comando, spiegazione: 'Allineo' }, {});
    console.log('ESPLORA', comando, c.executed, c.needsConfirm);
  }
});
