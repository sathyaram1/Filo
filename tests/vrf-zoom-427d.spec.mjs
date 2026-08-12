// VERIFICA #427 — il caso "fuoco sulla barra" e' un limite dell'harness o un bug vero? (temporaneo)
import { test, expect } from './fixtures/electron.mjs';

const z = (page) => page.evaluate(() => window.devicePixelRatio);

test('la shell riceve davvero i tasti? (controllo con before-input-event)', async ({ app, shell, openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForTimeout(900);

  // Spia indipendente su before-input-event della shell.
  await app.evaluate(async ({ BrowserWindow }) => {
    globalThis.__spy = [];
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.on('before-input-event', (_e, input) => {
      globalThis.__spy.push({ type: input.type, key: input.key, code: input.code, ctrl: input.control });
    });
  });

  // Controllo 1: i tasti arrivano al RENDERER della shell?
  await shell.evaluate(() => {
    globalThis.__rspy = [];
    window.addEventListener('keydown', (e) => globalThis.__rspy.push({ key: e.key, ctrl: e.ctrlKey }), true);
  });

  await shell.click('.tab.active', { timeout: 3000 }).catch(() => {});
  await shell.waitForTimeout(300);
  for (let i = 0; i < 3; i++) { await shell.keyboard.press('Control+Equal'); await shell.waitForTimeout(180); }
  await shell.waitForTimeout(500);

  const mainSpy = await app.evaluate(() => globalThis.__spy);
  const rendSpy = await shell.evaluate(() => globalThis.__rspy);
  console.log('[dbg] before-input-event visti nel main:', JSON.stringify(mainSpy));
  console.log('[dbg] keydown visti nel renderer shell:', JSON.stringify(rendSpy));
  console.log('[dbg] manage dpr dopo:', await z(page));

  // quale tab risulta attiva al main
  const active = await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const t = win._filoTabs;
    if (!t) return 'no _filoTabs';
    const a = t.tabs.find((x) => x.id === t.activeId);
    return a ? a.view.webContents.getURL() : 'nessuna attiva';
  });
  console.log('[dbg] tab attiva secondo il main:', active);
});
