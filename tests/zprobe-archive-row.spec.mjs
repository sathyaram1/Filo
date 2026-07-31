// PROBE (prober): archivio con MOLTE schede nello stesso giorno.
// La riga di un giorno è flex nowrap, overflow-x auto con scrollbar NASCOSTA.
// Domanda: le chip oltre il bordo destro sono raggiungibili?
import { test, expect } from './fixtures/electron.mjs';

test('probe: giorno con 60 schede archiviate', async ({ app, openTab }) => {
  const N = 60;
  await app.evaluate(async (_e, n) => {
    const now = Date.now();
    const items = [];
    for (let i = 0; i < n; i++) {
      items.push({
        id: 'p' + i,
        url: 'https://sito' + i + '.example/pagina',
        title: 'Scheda numero ' + i + ' con un titolo lungo',
        favicon: '',
        closedAt: new Date(now - i * 1000).toISOString(),
        identityColor: 'rgb(' + ((i * 37) % 255) + ', 90, 140)',
        scrollPosition: 0,
      });
    }
    await chrome.storage.local.set({ archivedTabs: items });
  }, N);

  const page = await openTab('filo://archive/archive.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const row = document.querySelector('.arc-tabs');
    if (!row) return { none: true, listHtml: document.getElementById('list').innerHTML.slice(0, 200) };
    const chips = [...row.querySelectorAll('.arc-tab')];
    const rowRect = row.getBoundingClientRect();
    const visible = chips.filter((c) => {
      const r = c.getBoundingClientRect();
      return r.left >= rowRect.left - 1 && r.right <= rowRect.right + 1;
    }).length;
    const cs = getComputedStyle(row);
    return {
      chips: chips.length,
      visible,
      scrollWidth: row.scrollWidth,
      clientWidth: row.clientWidth,
      scrollLeft: row.scrollLeft,
      overflowX: cs.overflowX,
      scrollbarWidth: cs.scrollbarWidth,
      firstChipW: chips[0] ? Math.round(chips[0].getBoundingClientRect().width) : 0,
      firstTitleVisible: chips[0] ? chips[0].querySelector('.arc-title').getBoundingClientRect().width : 0,
      innerW: window.innerWidth,
    };
  });
  console.log('ROW INFO', JSON.stringify(info, null, 2));

  // Prova a scorrere con la rotellina sopra la riga (come farebbe l'utente).
  const box = await page.locator('.arc-tabs').boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(500);
  }
  const afterWheelV = await page.evaluate(() => document.querySelector('.arc-tabs').scrollLeft);
  console.log('scrollLeft dopo wheel verticale:', afterWheelV);

  await page.mouse.wheel(300, 0);
  await page.waitForTimeout(500);
  const afterWheelH = await page.evaluate(() => document.querySelector('.arc-tabs').scrollLeft);
  console.log('scrollLeft dopo wheel orizzontale:', afterWheelH);

  await page.screenshot({ path: 'tests/.shots/probe-archive-row.png' });
  expect(info.chips).toBe(N);
});
