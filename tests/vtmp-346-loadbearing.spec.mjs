import { test, expect } from './fixtures/electron.mjs';

async function openBuilder(page) {
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
}
async function stuff(page, sel, n) {
  await page.evaluate(({ sel, count }) => {
    const body = document.querySelector(sel);
    for (let i = 0; i < count; i++) {
      const p = document.createElement('p');
      p.textContent = 'Riga ' + i + ' testo di riempimento reale.';
      p.style.margin = '14px 0';
      body.appendChild(p);
    }
  }, { sel, count: n });
}
function measure(page) {
  return page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect();
    const grid = r(document.getElementById('builderGrid'));
    const inp = r(document.getElementById('chatInput'));
    const cb = document.getElementById('chatLog');
    return {
      gridBottom: grid.bottom,
      inputBottom: inp.bottom, inputHeight: inp.height,
      chatScrollH: cb.scrollHeight, chatClientH: cb.clientHeight,
    };
  });
}

test('#346 load-bearing: senza min-height:0 l\'input esce dal riquadro; col fix resta dentro e la chat scrolla', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await openBuilder(page);
  await stuff(page, '#chatLog', 80);
  await page.waitForTimeout(50);

  // Stato CON fix (min-height:0 nel CSS della pagina): input dentro, chat scrolla.
  const withFix = await measure(page);
  expect(withFix.inputBottom).toBeLessThanOrEqual(withFix.gridBottom + 2);
  expect(withFix.inputHeight).toBeGreaterThan(10);
  expect(withFix.chatScrollH).toBeGreaterThan(withFix.chatClientH + 20);

  // Neutralizzo il fix a runtime (simulo la sua assenza) → deve rompersi.
  await page.addStyleTag({ content: '#builderGrid .dk-col { min-height: auto !important; }' });
  await page.waitForTimeout(50);
  const noFix = await measure(page);

  // Senza il fix la colonna cresce col contenuto: l'input in fondo finisce
  // SOTTO il bordo del builder (clippato) → "non vedo dove scrivere".
  expect(noFix.inputBottom).toBeGreaterThan(noFix.gridBottom + 20);
  // E la chat NON scrolla più internamente (client cresce fino al contenuto).
  expect(noFix.chatScrollH).toBeLessThanOrEqual(noFix.chatClientH + 2);
});
