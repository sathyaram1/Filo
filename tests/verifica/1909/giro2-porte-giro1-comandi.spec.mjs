// Verifica #1909, giro 1, rilievo 1: un comando che cancella senza cestino vuole la parola anche quando il programma
// non sta in testa al pezzo (assegnazione, sudo con un'opzione, FOR … DO, forfiles, Start-Process, script di una riga).
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';

const execAction = (app, action, opts) =>
  app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

test('r1 i comandi che cancellano senza cestino, scritti in altre forme, vogliono la parola «conferma»', async ({ app }) => {
  const dir = cartellaInCasa('filo-1909-');
  const file = join(dir, 'a.txt');
  writeFileSync(file, 'x');
  await livelloAutonomia(app, 'normale');
  const comandi = [
    `$null = Remove-Item -LiteralPath "${file}"`,
    `sudo -u root rm "${file}"`,
    `FOR %f IN ("${file}") DO del %f`,
    `forfiles /p "${dir}" /m a.txt /c "cmd /c del @file"`,
    `Start-Process powershell -ArgumentList "Remove-Item '${file}'"`,
    `Get-Item "${file}" | ForEach-Object Delete`,
    `python -c "import os; os.remove('${file}')"`,
    `node -e "require('fs').rmSync('${file}')"`,
  ];
  const senzaParola = [];
  for (const comando of comandi) {
    const c = await execAction(app, { type: 'ESEGUI_COMANDO', comando }, {});
    if (c.executed || c.needsConfirm !== 3) senzaParola.push(comando);
  }
  expect(senzaParola).toEqual([]);
  expect(existsSync(file)).toBe(true);
});
