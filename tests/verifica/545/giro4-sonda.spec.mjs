import { test, expect } from '../../fixtures/electron.mjs';
test('sonda layout map', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForLoadState('domcontentloaded');
  const r = await page.evaluate(async () => {
    try {
      if (!navigator.keyboard) return 'no navigator.keyboard';
      const m = await navigator.keyboard.getLayoutMap();
      return JSON.stringify([...m.entries()].slice(0, 60));
    } catch (e) { return 'ERR ' + e.message; }
  });
  console.log('LAYOUT', r);
});
