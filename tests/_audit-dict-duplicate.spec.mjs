import { test, expect } from './fixtures/electron.mjs';

// AUDIT: adding a word already in the personal dictionary (same word, or
// different casing) silently clears the input with NO feedback — unlike the
// autocorrect section right above it, which shows a clear conflict message.
test('dict duplicate word is swallowed with no feedback', async ({ openTab }) => {
  const page = await openTab('filo://spellcheck/spellcheck.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!document.getElementById('newDictWord'));

  const input = page.locator('#newDictWord');
  const addBtn = page.locator('#addDict');

  // Add "casa" — first time: a row should appear.
  await input.fill('casa');
  await addBtn.click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#dictList .sn-spell-word')].some((e) => e.textContent === 'casa'));
  const rowsAfterFirst = await page.locator('#dictList .sn-spell-word').count();
  console.log('rows after first add:', rowsAfterFirst);

  // Now add "Casa" (same word, different case) — should be deduped.
  await input.fill('Casa');
  await addBtn.click();
  await page.waitForTimeout(300);

  const inputValueAfter = await input.inputValue();
  const rowsAfterDup = await page.locator('#dictList .sn-spell-word').count();

  // Is there ANY visible message telling the user the word already exists?
  const bodyText = await page.locator('body').innerText();
  const hasFeedback = /gi.+esist|esist.+gi|già nel diz|already|duplicat/i.test(bodyText);

  console.log('input value after dup add:', JSON.stringify(inputValueAfter));
  console.log('rows after dup add:', rowsAfterDup);
  console.log('any "already exists" feedback shown:', hasFeedback);

  await page.screenshot({ path: 'tests/.shots/audit-dict-duplicate.png' });

  // Document the bug: input was cleared (word "vanished") but no feedback and
  // no new row — the user gets zero indication of what happened.
  expect(inputValueAfter).toBe('');     // input cleared → typed word vanished
  expect(rowsAfterDup).toBe(rowsAfterFirst); // no new row
  expect(hasFeedback).toBe(false);      // BUG: no feedback at all
});
