// Verifica #1909, giro 2, rilievo 1: un comando che cancella senza cestino vuole la parola anche quando chi lo lancia
// ha opzioni con un valore (powershell -ExecutionPolicy Bypass), o è un lanciatore non in elenco (timeout, busybox, perl).
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';

const execAction = (app, action, opts) =>
  app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

test('r1 i comandi che cancellano senza cestino, lanciati con opzioni o da un altro programma, vogliono la parola', async ({ app }) => {
  const dir = cartellaInCasa('filo-1909-');
  const file = join(dir, 'a.txt');
  writeFileSync(file, 'x');
  await livelloAutonomia(app, 'default');
  const comandi = [
    `pwsh -NoProfile -ExecutionPolicy Bypass -Command "Remove-Item '${file}'"`,
    `powershell.exe -ExecutionPolicy Bypass -c "del '${file}'"`,
    `timeout 5 rm "${file}"`,
    `busybox rm "${file}"`,
    `perl -e 'unlink "${file}"'`,
  ];
  const senzaParola = [];
  for (const comando of comandi) {
    const c = await execAction(app, { type: 'ESEGUI_COMANDO', comando }, {});
    if (c.executed || c.needsConfirm !== 3) senzaParola.push(comando);
  }
  expect(senzaParola).toEqual([]);
  expect(existsSync(file)).toBe(true);
});
