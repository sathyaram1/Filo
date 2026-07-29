import { test, expect } from './fixtures/electron.mjs';

const EDITOR = 'filo://editor/editor.html';

async function openStats(page) {
  await page.click('.ed-module[data-type="word-count"] .ed-mod-pad');
  await page.waitForSelector('.ed-stat-row');
}
async function readStats(page) {
  const rows = page.locator('.ed-stat-row');
  const n = await rows.count();
  const out = {};
  for (let i = 0; i < n; i++) {
    const label = (await rows.nth(i).locator('span').first().innerText()).trim();
    const val = (await rows.nth(i).locator('.v').innerText()).trim();
    out[label] = val;
  }
  return out;
}
async function closeStats(page) {
  await page.click('#ovClose');
  await page.waitForSelector('.ed-stat-row', { state: 'detached' }).catch(() => {});
}
async function setDoc(page, html) {
  await page.evaluate((h) => {
    const doc = document.querySelector('#doc') || document.querySelector('[contenteditable]');
    doc.innerHTML = h;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, html);
  await page.waitForTimeout(120);
}

test('#222 empty doc: all five stats are zero', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('.ed-module[data-type="word-count"] .wc-num');
  await openStats(page);
  const s = await readStats(page);
  console.log('EMPTY STATS', JSON.stringify(s));
  expect(s['Parole']).toBe('0');
  expect(s['Caratteri']).toBe('0');
  expect(s['Frasi']).toBe('0');
  expect(s['Paragrafi']).toBe('0');
  expect(s['Tempo di lettura']).toBe('~0 min');
});

test('#222 punctuation only counts as zero words, zero sentences', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('.ed-module[data-type="word-count"] .wc-num');
  await setDoc(page, '<p>,,, ... !!! ??? --- ;;;</p>');
  await openStats(page);
  const s = await readStats(page);
  console.log('PUNCT STATS', JSON.stringify(s));
  expect(s['Parole']).toBe('0');
  expect(s['Frasi']).toBe('0');
  expect(s['Tempo di lettura']).toBe('~0 min');
  // Punctuation chars still count as characters (they are typed content).
  expect(Number(s['Caratteri'])).toBeGreaterThan(0);
});

test('#222 whitespace-only doc is empty', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('.ed-module[data-type="word-count"] .wc-num');
  await setDoc(page, '<p>&nbsp; &nbsp;   </p>');
  await openStats(page);
  const s = await readStats(page);
  console.log('WS STATS', JSON.stringify(s));
  expect(s['Parole']).toBe('0');
  expect(s['Paragrafi']).toBe('0');
  expect(s['Tempo di lettura']).toBe('~0 min');
});

test('#222 mixed real words counted, punctuation ignored', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('.ed-module[data-type="word-count"] .wc-num');
  await setDoc(page, '<p>ciao , mondo ... ! come 3 stai</p>');
  await openStats(page);
  const s = await readStats(page);
  console.log('MIXED STATS', JSON.stringify(s));
  // ciao, mondo, come, 3, stai = 5 (3 is alphanumeric => a word)
  expect(s['Parole']).toBe('5');
});

test('#222 emoji-only counts as zero words', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('.ed-module[data-type="word-count"] .wc-num');
  await setDoc(page, '<p>😀 🎉 🚀 — …</p>');
  await openStats(page);
  const s = await readStats(page);
  console.log('EMOJI STATS', JSON.stringify(s));
  expect(s['Parole']).toBe('0');
  expect(s['Tempo di lettura']).toBe('~0 min');
});

test('#222 large doc: reading time scales up', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('.ed-module[data-type="word-count"] .wc-num');
  const words = Array.from({ length: 600 }, (_, i) => 'parola' + i).join(' ');
  await setDoc(page, '<p>' + words + '</p>');
  await openStats(page);
  const s = await readStats(page);
  console.log('LARGE STATS', JSON.stringify(s));
  expect(s['Parole']).toBe('600');
  // 600/200 = 3 min
  expect(s['Tempo di lettura']).toBe('~3 min');
});

test('#222 clearing text after typing returns to zero', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('.ed-module[data-type="word-count"] .wc-num');
  await setDoc(page, '<p>hello world foo bar</p>');
  await expect(page.locator('.ed-module[data-type="word-count"] .wc-num')).toHaveText('4');
  await setDoc(page, '<p><br></p>');
  await openStats(page);
  const s = await readStats(page);
  console.log('CLEARED STATS', JSON.stringify(s));
  expect(s['Parole']).toBe('0');
  expect(s['Paragrafi']).toBe('0');
  expect(s['Tempo di lettura']).toBe('~0 min');
});
