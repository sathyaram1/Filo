// #587 giro 10, rilievo 2: leggere i propri file con un jolly («i miei .txt») non chiede un OK.
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

test('«mostrami i miei txt» e «le prime righe dei csv» partono senza conferma', async ({ app, openTab }) => {
  await openTab('filo://newtab/');
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } });
  });
  const dir = cartellaInCasa('filo-v587-jolly-');
  writeFileSync(join(dir, 'spesa.txt'), 'latte uova pane\n', 'utf8');
  writeFileSync(join(dir, 'idee.txt'), 'regalo per Anna\n', 'utf8');
  writeFileSync(join(dir, 'conti.csv'), 'mese,importo\ngennaio,120\n', 'utf8');
  try {
    const casi = [
      [`cd "${dir}" && cat *.txt`, ['latte uova pane', 'regalo per Anna']],
      [`head -3 "${dir}"/*.csv`, ['gennaio,120']],
    ];
    for (const [comando, attesi] of casi) {
      const r = await app.evaluate((_e, a) => globalThis.SN_EXECUTE_FILO_ACTION(a, {}), { type: 'ESEGUI_COMANDO', comando });
      expect(r.needsConfirm, `"${comando}": ${String(r.describe || '')}`).toBeFalsy();
      expect(r.executed).toBe(true);
      for (const t of attesi) expect(r.output.stdout).toContain(t);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
