// #2390 giro 1 — prova esplorativa: timer che scade mentre la finestra normale sta ancora caricando.

import { test, expect } from '../../fixtures/electron.mjs';

test('timer scaduto con Filo non davanti e la finestra che sta caricando: la notifica del sistema arriva lo stesso', async ({ app, shell }) => {
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
  console.log('caricava', caricava);
  await shell.waitForTimeout(4000);
  const reg = await app.evaluate(() => globalThis.__filoAvvisoSistema.registroProva.map((r) => r.testo));
  console.log('registro', JSON.stringify(reg));
  expect(reg).toContain('Timer «Finestra nuova» scaduto');
});
