import { test, expect } from './fixtures/electron.mjs';

test('probe: dashboard then navigate same tab to editor, capture errors', async ({ app, shell, openTab }) => {
  const errors = [];

  // 1) apri la dashboard (newtab)
  const dash = await openTab('filo://newtab/');
  dash.on('pageerror', (e) => errors.push('[dash pageerror] ' + e.message));
  dash.on('console', (m) => { if (m.type() === 'error') errors.push('[dash console] ' + m.text()); });
  await dash.waitForTimeout(500);

  // 2) naviga LO STESSO tab all'editor (come farebbe l'utente dalla barra/azione)
  await shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    const active = (snap.tabs || snap).find?.((t) => t.active) || (snap.tabs || [])[0];
    await window.filoShell.tabs.navigate(active.id, 'filo://editor/editor.html');
  });
  await dash.waitForTimeout(1800);

  console.log('SAME-TAB ERRORS:', JSON.stringify(errors, null, 2));
});

test('probe: fresh editor tab, capture errors', async ({ app, openTab }) => {
  const errors = [];
  const page = await openTab('filo://editor/editor.html');
  page.on('pageerror', (e) => errors.push('[ed pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[ed console] ' + m.text()); });
  await page.waitForSelector('#doc');
  await page.waitForTimeout(800);
  console.log('FRESH ERRORS:', JSON.stringify(errors, null, 2));
});
