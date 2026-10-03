// Verifica #530 giro 11: a Normale, conversazione pulita, un comando che scrive SOPRA un file che c'è già
// (spostare, copiare, estrarre un archivio) lo cancella senza chiedere niente: prima chiedeva un OK.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';
import { cartellaInCasa } from '../../helpers/percorsi.mjs';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const execAction = (app, action, opts) =>
  app.evaluate((_e, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

for (const [nome, comando] of [
  ['spostare sopra', (a, b) => `mv "${a}" "${b}"`],
  ['copiare sopra', (a, b) => `cp "${a}" "${b}"`],
]) {
  test(`Normale, conversazione pulita: ${nome} un file che c'è già chiede prima di cancellarlo`, async ({ app }) => {
    const casa = cartellaInCasa('filo-530-g11-');
    const a = join(casa, 'bozza.txt');
    const b = join(casa, 'tesi-finale.txt');
    writeFileSync(a, 'bozza di due righe\n', 'utf8');
    writeFileSync(b, 'TRE ANNI DI LAVORO\n', 'utf8');
    try {
      await home(app);
      await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
      const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando: comando(a, b) });
      expect(readFileSync(b, 'utf8'), 'il file che c\'era è ancora lì finché l\'utente non dice sì').toContain('TRE ANNI DI LAVORO');
      expect(r.needsConfirm, 'sovrascrivere un file non si disfa: chiede come prima').toBeTruthy();
    } finally {
      rmSync(casa, { recursive: true, force: true });
    }
  });
}
