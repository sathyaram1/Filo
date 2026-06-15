import { test, expect } from './fixtures/electron.mjs';

// Pagina che simula YouTube: registra un listener contextmenu in CAPTURE su
// window al primo script (prima del nostro content script), e blocca tutto
// con stopImmediatePropagation + preventDefault (mostrando il suo menu).
const HTML = `<!doctype html><html><head><script>
  window.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    var d = document.createElement('div');
    d.id = 'yt-menu';
    d.textContent = 'YouTube menu';
    document.body.appendChild(d);
  }, { capture: true });
</script></head><body style="padding:40px">
  <video id="player" width="320" height="180" style="background:#000"></video>
</body></html>`;

test('right-click su pagina tipo-YouTube apre il menu Filo, non quello della pagina', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.locator('#player').click({ button: 'right' });
  await page.waitForTimeout(300);
  await expect(page.locator('.sn-menu')).toBeVisible();
  // Il menu della pagina ostile NON deve comparire: lo abbiamo pre-emptato.
  await expect(page.locator('#yt-menu')).toHaveCount(0);
});

test('Shift + right-click su pagina ostile resta escape hatch (nessun menu Filo)', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HTML);
  await page.keyboard.down('Shift');
  await page.locator('#player').click({ button: 'right' });
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  await expect(page.locator('.sn-menu')).toHaveCount(0);
});
