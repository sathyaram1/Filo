import { test, expect } from '/home/user/Filo/.claude/worktrees/worker-4908fb7d-2928-465e-b399-68b1b128eb06/tests/fixtures/electron.mjs';
test('probe', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<h2>Uno</h2><p id="s1">un ottimo risultato</p>'
      + '<h2>Due</h2><p id="s2">un orso bruno</p>'
      + '<h2>Tre</h2><p id="s3">qui vive un ornitorinco</p>';
    doc.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('[data-sr="find"]');
  await page.fill('[data-sr="find"]', 'or');
  await page.waitForTimeout(600);
  const info = await page.evaluate(() => ({
    html: document.getElementById('doc').innerHTML,
    marks: [...document.querySelectorAll('#doc mark.ed-find-hit')].map(m => m.parentElement.textContent.slice(0,40)),
  }));
  console.log(JSON.stringify(info, null, 1));
});
