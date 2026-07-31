// TEMP prober probe: renaming an UNTITLED editor doc without giving it a name
// (open rename + Enter, or clear + Enter) marks it titleManual=true, which
// permanently suppresses the ~100-word auto-title — even though the doc is still
// "Documento senza titolo". Removed after run.
import { test, expect } from './fixtures/electron.mjs';

const KEY = 'filo.editor.collection';

async function readActiveMeta(page) {
  return page.evaluate(async (k) => {
    const out = await new Promise((res) => chrome.storage.local.get(k, (o) => res(o)));
    const col = out && out[k];
    if (!col || !Array.isArray(col.files)) return null;
    const f = col.files.find((x) => x.id === col.activeId) || col.files[0];
    return f ? { title: f.meta && f.meta.title, titleManual: !!(f.meta && f.meta.titleManual) } : null;
  }, KEY);
}

test('untitled doc: no-op rename must not mark titleManual (would kill auto-title)', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#docSwitch', { timeout: 8000 });
  // let init persist the initial collection
  await page.waitForTimeout(800);

  const before = await readActiveMeta(page);
  console.log('BEFORE:', JSON.stringify(before));
  expect(before, 'collection should be persisted').not.toBeNull();
  // sanity: fresh doc is untitled and NOT manual
  expect(before.titleManual).toBe(false);

  // Open the document switcher popup
  await page.click('#docSwitch');
  await page.waitForSelector('#docPop .ed-doc-rename', { timeout: 4000 });
  // Click the pencil (inline rename) on the active file
  await page.click('#docPop .ed-doc-item.active .ed-doc-rename');
  const input = await page.waitForSelector('#docPop .ed-doc-item-input', { timeout: 4000 });
  // User confirms WITHOUT typing a name (clear + Enter = "I changed my mind")
  await input.fill('');
  await input.press('Enter');
  await page.waitForTimeout(400);

  const after = await readActiveMeta(page);
  console.log('AFTER :', JSON.stringify(after));

  // The doc is STILL untitled...
  expect(after.title).toBe(before.title); // "Documento senza titolo"
  // ...so it must remain eligible for auto-title. If titleManual flipped to true,
  // maybeAutoTitle() will bail forever -> the doc can never get an auto title.
  expect(after.titleManual, 'untitled doc wrongly marked as manually-titled').toBe(false);
});
