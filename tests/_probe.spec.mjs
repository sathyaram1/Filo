import { test, expect } from './fixtures/electron.mjs';

test('probe: click-everything in editor', async ({ openTab }) => {
  const errors = [];
  const ed = await openTab('filo://editor/editor.html');
  ed.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  ed.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  await ed.waitForSelector('#doc');

  const step = async (name, fn) => {
    const before = errors.length;
    try { await fn(); await ed.waitForTimeout(150); }
    catch (e) { errors.push(`[step ${name} threw] ` + e.message); }
    if (errors.length > before) console.log(`>> errore dopo step "${name}"`);
  };

  // pagina 0: word-count overlay
  await step('click word-count', () => ed.locator('.ed-module[data-type="word-count"] .ed-mod-pad').click());
  await step('close overlay', () => ed.locator('#overlay').click({ position: { x: 5, y: 5 } }));

  // apri settings (gear) → palette
  await step('open settings', () => ed.click('#settingsToggle'));
  // clicca un modulo in settings → openModuleConfig
  await step('config switch module', () => ed.locator('.ed-module[data-type="switch"]').click());
  await step('cancel config', () => ed.locator('#cfgCancel').click().catch(()=>{}));
  await step('close settings', () => ed.click('#settingsToggle'));

  // switch grow / shrink
  await step('grow switch', () => ed.locator('.ed-switch-arrow').nth(1).click());
  await step('shrink switch', () => ed.locator('.ed-switch-arrow').nth(0).click());

  // empty cell → add module menu
  await step('open add-module', () => ed.locator('.ed-cell-empty').first().click());
  await step('add word-count', () => ed.locator('[data-add="word-count"]').click().catch(()=>{}));

  // pagina 1 → comment + chat
  await step('go page 1', () => ed.locator('.ed-switch-icon').nth(1).click());
  await step('click comment', () => ed.locator('.ed-module[data-type="comment"] .ed-mod-pad').click());
  await step('close overlay 2', () => ed.locator('#overlay').click({ position: { x: 5, y: 5 } }).catch(()=>{}));

  // sidebar toggle
  await step('toggle sidebar', () => ed.click('#sidebarToggle'));
  await step('toggle sidebar back', () => ed.click('#sidebarToggle'));

  console.log('ALL ERRORS:', JSON.stringify(errors, null, 2));
});
