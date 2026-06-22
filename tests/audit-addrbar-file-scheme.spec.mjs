import { test, expect } from './fixtures/electron.mjs';

// AUDIT (repro temporaneo, NON committare): dimostra che la barra indirizzi
// (tabs:navigate -> navigate() -> loadURL) carica file:// bypassando il guard
// isWebUnsafeNav presente solo su will-navigate. Cattura screenshot di prova.
test('repro: address bar carica file://', async ({ shell, app }) => {
  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const tabId = snap.activeId ?? snap.tabs?.[0]?.id;
  const target = 'file:///etc/passwd';
  await shell.evaluate(([tid, u]) => window.filoShell.tabs.navigate(tid, u), [tabId, target]);
  await new Promise((r) => setTimeout(r, 1800));

  const fileWin = app.windows().find((w) => { try { return w.url().startsWith('file://'); } catch { return false; } });
  console.log('LOADED file:// window?', !!fileWin, fileWin && fileWin.url());
  if (fileWin) {
    try { await fileWin.screenshot({ path: 'tests/.shots/audit-addrbar-file-scheme.png' }); } catch (e) { console.log('shot err', e.message); }
  }
  expect(!!fileWin).toBe(true); // documenta il bug: file:// VIENE caricato
});
