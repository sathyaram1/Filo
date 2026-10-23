// #1606 verifica giro 1, rilievo 1 — su Mac la riapertura di Filo già acceso arriva come `activate`, non come seconda copia:
// con la principale chiusa e un'altra finestra di Filo aperta, il clic sul Dock deve ridare la finestra con le schede.
import { test, expect } from '../../fixtures/electron.mjs';

const normali = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .filter((w) => !w.isDestroyed() && w._filoTabs && !w._filoIncognito)
  .map((w) => ({ visibile: w.isVisible() })));

test('r1 Mac, clic sull\'icona del Dock con la finestrella di accesso aperta: torna la finestra normale', async ({ app, shell }) => {
  await app.evaluate(({ BrowserWindow }) => {
    const w = new BrowserWindow({ width: 400, height: 400, show: true });
    w.loadURL('data:text/html,<title>Accedi</title>passkey');
  });
  await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(async () => (await normali(app)).length, { timeout: 10000 }).toBe(0);
  await app.evaluate(({ app: a }) => { a.emit('activate', {}, true); });
  await expect.poll(async () => (await normali(app)).length, { message: 'su Mac la riapertura non ridà la finestra di Filo', timeout: 10000 }).toBe(1);
  expect((await normali(app))[0].visibile).toBe(true);
});
