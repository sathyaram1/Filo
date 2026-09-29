// Verifica #588.5 giro 1, rilievo 1: il primo avviso della finestra non deve portarsi via la tastiera
// di chi sta scrivendo nella pagina (i tasti dopo l'avviso vanno ancora al campo).
import { test, expect } from '../../fixtures/electron.mjs';
import { execFileSync, spawnSync } from 'node:child_process';

const haXdotool = process.platform === 'linux' && !!process.env.DISPLAY
  && process.env.FILO_TEST_VISIBLE === '1'
  && spawnSync('sh', ['-c', 'command -v xdotool'], { stdio: 'ignore' }).status === 0;

function inFuoco(app) {
  return app.evaluate(({ webContents }) => {
    const f = webContents.getFocusedWebContents();
    return f ? f.getURL() : '';
  });
}

test('un avviso che compare mentre si scrive lascia la tastiera alla pagina', async ({ app, shell, openTab, testServer, avvisi }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <input id="campo" style="margin:40px;font-size:20px"></body></html>`);
  // Il clic di Playwright non sposta il fuoco fra le viste come un clic vero: la finestra e la
  // scheda il fuoco lo chiedono qui, come succede quando l'utente clicca nella pagina.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const tm = win._filoTabs;
    win.focus();
    tm.tabs.find((t) => t.id === tm.activeId).view.webContents.focus();
  });
  await page.locator('#campo').click();
  await expect.poll(() => inFuoco(app)).toContain(testServer.origin);

  // Il primo avviso di questa finestra: è quello che fa nascere la vista sopra la pagina.
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 0 }));
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show')).toHaveCount(1);
  await page.waitForTimeout(600);

  expect(await inFuoco(app), 'dopo il primo avviso la tastiera è finita sulla vista degli avvisi').toContain(testServer.origin);

  // Con uno schermo vero (xvfb, finestra visibile) si prova anche coi tasti del sistema.
  if (haXdotool) {
    execFileSync('xdotool', ['type', '--delay', '30', 'ciao']);
    await expect.poll(() => page.locator('#campo').inputValue()).toBe('ciao');
  }
});
