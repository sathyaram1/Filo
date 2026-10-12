// Esplorazione giro 5 (#429): si cancella prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';
import { captureCompositeElectron } from '../../agent/driver.mjs';

const PAGINE = ['filo://manage/manage.html', 'filo://options/options.html', 'filo://history/history.html',
  'filo://feedback/feedback.html', 'filo://downloads/downloads.html'];

const info = (shell) => shell.evaluate(() => {
  const st = document.querySelector('.tabs');
  return { scroll: st.scrollWidth - st.clientWidth, fila: Math.round(document.querySelector('.tab-row').getBoundingClientRect().width),
    s: [...document.querySelectorAll('#tabs .tab')].map((t) => { const ti = t.querySelector('.title'); return `${ti.textContent}:${Math.round(t.getBoundingClientRect().width)}:${ti.clientWidth}/${ti.scrollWidth}`; }) };
});

test('ridimensiona la finestra', async ({ app, shell }) => {
  for (const u of PAGINE) await shell.evaluate((u) => window.filoShell.tabs.open(u), u);
  await expect.poll(() => shell.locator('#tabs .tab').count(), { timeout: 10_000 }).toBe(PAGINE.length + 1);
  await shell.waitForTimeout(1500);
  console.log('1280', JSON.stringify(await info(shell)));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getBounds().width > 600)?.setSize(760, 600));
  await shell.waitForTimeout(1500);
  console.log('760', JSON.stringify(await info(shell)));
  await captureCompositeElectron(app, 'tests/.shots/g5-760.png');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getBounds().width > 600)?.setSize(1280, 800));
  await shell.waitForTimeout(1500);
  console.log('di nuovo 1280', JSON.stringify(await info(shell)));
});
