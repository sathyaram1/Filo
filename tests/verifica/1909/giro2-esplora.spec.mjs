// Verifica #1909, giro 2: esplorazione (percorsi scritti male, livelli di autonomia).
import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';

const execAction = (app, action, opts) =>
  app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

test('esplora', async ({ app }) => {
  const dir = cartellaInCasa('filo-1909-');
  const file = join(dir, 'Bolletta Enel.pdf');
  writeFileSync(file, 'x');
  const out = {};
  for (const lv of ['conservativo', 'default', 'automatico', 'yolo']) {
    await livelloAutonomia(app, lv);
    const r = await execAction(app, { type: 'ELIMINA_FILE', percorsi: [file] }, {});
    const p = await execAction(app, { type: 'ELIMINA_FILE', percorsi: [file], per_sempre: true }, {});
    const c = await execAction(app, { type: 'ESEGUI_COMANDO', comando: `rm "${file}"` }, {});
    out[lv] = { trash: [r.executed, r.needsConfirm], sempre: [p.executed, p.needsConfirm], rm: [c.executed, c.needsConfirm] };
  }
  await livelloAutonomia(app, 'default');
  for (const x of [`~/${basename(dir)}/bolletta enel.pdf`, `~/${basename(dir)}/boletta enel.pdf`, `~/${basename(dir)}/Bolletta Enel`, `"${file}"`, `${dir}/`]) {
    const r = await execAction(app, { type: 'ELIMINA_FILE', percorsi: [x] }, {});
    out[x] = { ex: r.executed, nc: r.needsConfirm, file: r.action && r.action._file, describe: r.describe, out: r.output };
  }
  console.log(JSON.stringify(out, null, 1));
  expect(existsSync(file)).toBe(true);
});
