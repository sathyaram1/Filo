// #2390 giro 1, rilievo 3 — un timer che scade mentre la finestra normale sta caricando (riaperta per farsi
// sentire, o ricaricata) deve avvisare lo stesso: con Filo non davanti, la notifica del sistema.

import { test, expect } from '../../fixtures/electron.mjs';

test('r3 timer scaduto con Filo non davanti e la finestra che sta caricando: la notifica del sistema arriva', async ({ app, shell }) => {
  await app.evaluate(() => globalThis.__filoAvvisoSistema.impostaPerProva(false));
  const tipo = await shell.evaluate(() => window.SN_MSG.MSG.FILO_ADD_TIMER);
  await shell.evaluate(([t]) => window.filoShell.message({ type: t, label: 'Finestra nuova', seconds: 1 }), [tipo]);
  await shell.waitForTimeout(1300);
  const caricava = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.webContents.reload();
    const l = w.webContents.isLoading();
    await globalThis.__filoAlarmWatcher._tick();
    return l;
  });
  expect(caricava).toBe(true);
  await expect.poll(() => app.evaluate(() => globalThis.__filoAvvisoSistema.registroProva.map((r) => r.testo)), { timeout: 10_000 })
    .toContain('Timer «Finestra nuova» scaduto');
});
