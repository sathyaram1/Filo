// Verifica #586 giro 19, rilievo 2: il menu nato dentro un elemento del sito (dialogo modale, schermo intero) ne
// eredita lo stile del testo: voci centrate, maiuscole, in corsivo, spaziate.
import { test, expect } from '../../fixtures/electron.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('r2 in un dialogo modale con testo centrato e maiuscolo le voci del menu restano come altrove', async ({ openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, `<!doctype html><title>Dialogo</title><body>
    <dialog id="d" style="padding:20px;width:360px;text-align:center;text-transform:uppercase;letter-spacing:3px;font-style:italic">
    <p>Accedi</p><input id="c" style="width:300px"></dialog><script>d.showModal()</script></body>`);
  const box = await page.locator('#c').boundingBox();
  await page.mouse.click(box.x + 30, box.y + 8, { button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 5000 });
  await sleep(400);
  const st = await page.evaluate(() => {
    const c = getComputedStyle(document.querySelector('.sn-menu .sn-menu-paste-main .sn-menu-label'));
    return { textAlign: c.textAlign, textTransform: c.textTransform, fontStyle: c.fontStyle, letterSpacing: c.letterSpacing };
  });
  expect(st.textTransform).toBe('none');
  expect(st.fontStyle).toBe('normal');
  expect(st.textAlign).not.toBe('center');
  expect(st.letterSpacing).toBe('normal');
});
