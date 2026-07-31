// TEMPORANEO — audit prober: quanto resta "Caricamento…" la bacheca senza rete.
import { test, expect } from './fixtures/electron.mjs';

test('board: tempo prima di uscire da Caricamento', async ({ openTab }) => {
  test.setTimeout(180_000);
  const t0 = Date.now();
  const page = await openTab('filo://board/board.html');
  let when = -1;
  for (let i = 0; i < 120; i++) {
    const loading = await page.evaluate(() => !document.getElementById('bdLoading')?.hidden);
    if (!loading) { when = Date.now() - t0; break; }
    await page.waitForTimeout(500);
  }
  const st = await page.evaluate(() => ({
    empty: !document.getElementById('bdEmpty')?.hidden,
    txt: document.body.innerText.replace(/\s+/g, ' ').slice(0, 250),
  }));
  console.log('loader sparito dopo ms =', when, JSON.stringify(st));
  await page.screenshot({ path: 'tests/.shots/zprobe-board-final.png' });
});
