import { test, expect } from './fixtures/electron.mjs';
test('debug switch dom', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.locator('.ed-module[data-type="switch"]').waitFor();
  const info = await page.evaluate(() => {
    const sw = document.querySelector('.ed-module[data-type="switch"]');
    return {
      icons: document.querySelectorAll('.ed-switch-icon').length,
      iconsScoped: sw ? sw.querySelectorAll('.ed-switch-icon').length : -1,
      handle: !!document.querySelector('.ed-mod-resize-h'),
      gridColEnd: sw ? getComputedStyle(sw).gridColumnEnd : null,
      gridCol: sw ? sw.style.gridColumn : null,
    };
  });
  console.log('DBG', JSON.stringify(info));
});
