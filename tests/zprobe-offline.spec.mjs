// TEMPORANEO — audit prober: cosa vede l'utente quando la rete non c'è.
import { test, expect } from './fixtures/electron.mjs';

test('bacheca offline: stato finale', async ({ openTab }) => {
  test.setTimeout(180_000);
  const page = await openTab('filo://board/board.html');
  for (const t of [2000, 5000, 10000, 20000]) {
    await page.waitForTimeout(t === 2000 ? 2000 : 3000);
    const st = await page.evaluate(() => ({
      loading: !document.getElementById('bdLoading')?.hidden,
      empty: !document.getElementById('bdEmpty')?.hidden,
      emptyTxt: document.getElementById('bdEmpty')?.textContent,
      cards: document.querySelectorAll('#bdList > *').length,
      visible: document.body.innerText.replace(/\s+/g, ' ').slice(0, 220),
    }));
    console.log(`t=${t}`, JSON.stringify(st));
  }
  await page.screenshot({ path: 'tests/.shots/zprobe-board-offline.png' });
});

test('feedback offline: stato finale', async ({ openTab }) => {
  test.setTimeout(180_000);
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForTimeout(12000);
  const st = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400));
  console.log('FEEDBACK:', st);
  await page.screenshot({ path: 'tests/.shots/zprobe-feedback-offline.png' });
});

test('crediti offline: stato finale', async ({ openTab }) => {
  test.setTimeout(120_000);
  const page = await openTab('filo://credits/credits.html');
  await page.waitForTimeout(8000);
  console.log('CREDITI:', await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400)));
});
