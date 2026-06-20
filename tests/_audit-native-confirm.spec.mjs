import { test, expect } from './fixtures/electron.mjs';

// PROBE: does native window.confirm() work on a filo:// WebContentsView tab?
// History "Clear" and Archive "Empty" rely on it.
test('probe native confirm on history page', async ({ openTab, app }) => {
  const page = await openTab('filo://history/history.html');
  await page.waitForLoadState('domcontentloaded');

  // Does a dialog event even fire when confirm() is called?
  let dialogFired = false;
  page.on('dialog', async (d) => {
    dialogFired = true;
    console.log('DIALOG fired:', d.type(), JSON.stringify(d.message()));
    await d.accept().catch(() => {});
  });

  // Call confirm directly and capture the synchronous return value.
  const result = await page.evaluate(() => {
    try {
      const r = window.confirm('PROBE-CONFIRM-MESSAGE');
      return { ok: true, value: r, type: typeof r };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  }).catch((e) => ({ evalError: String(e && e.message || e) }));

  console.log('CONFIRM RESULT:', JSON.stringify(result));
  console.log('DIALOG FIRED:', dialogFired);

  // Now exercise the actual "Clear" button flow.
  const clearBtn = page.locator('#clear');
  console.log('CLEAR BTN visible:', await clearBtn.isVisible().catch(() => 'err'));
});
