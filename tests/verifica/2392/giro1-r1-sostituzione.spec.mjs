// Verifica #2392 giro 1, rilievo 1: in bash e zsh `$(…)` in testa alla riga esegue come comando quello che stampa,
// quindi non è una lettura: un comando scritto così non deve partire senza «conferma».
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import path from 'node:path';
import fs from 'node:fs';

const NEWTAB = 'filo://newtab/';
const DOPO_UNA_RICERCA = { contesto: [{ type: 'CERCA_WEB', query: 'x', _output: { results: [{ url: 'https://esempio.test/' }] } }] };
const execAction = (app, action) =>
  app.evaluate((_electron, { action, opts }) => globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts: DOPO_UNA_RICERCA });
const enableTerminal = (page) => page.evaluate(async () =>
  chrome.runtime.sendMessage({ type: 'filo_confirm_action', action: { type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' } }));

test.skip(process.platform === 'win32', 'la forma vale per le shell posix: su Windows la shell di serie è PowerShell');

test('r1 un comando nascosto in una sostituzione $(…) non parte senza «conferma» e il file resta', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await enableTerminal(page);
  const dir = cartellaTemporanea('filo2392-');
  const forme = [
    (f) => `$(echo rm ${f})`,
    (f) => `($(echo rm ${f}))`,
    (f) => `$(echo rm ${f}) | wc -l`,
    (f) => `ls; $(echo rm ${f})`,
  ];
  try {
    for (const [i, forma] of forme.entries()) {
      const file = path.join(dir, `vittima-${i}.txt`);
      fs.writeFileSync(file, 'dati');
      const comando = forma(file);
      const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando });
      expect.soft(r.executed, comando).toBe(false);
      expect.soft(r.needsConfirm, comando).toBe(3);
      expect.soft(fs.existsSync(file), `${comando}: il file è stato cancellato`).toBe(true);
    }
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});
