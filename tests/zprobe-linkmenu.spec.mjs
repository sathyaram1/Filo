// PROBE TEMPORANEO (audit prober) — voci del menu tasto destro su un link a file.
import { test, expect } from './fixtures/electron.mjs';

async function menuEntries(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.sn-menu, [class*="sn-menu"]');
    if (!root) return null;
    return Array.from(root.querySelectorAll('.sn-menu-item, [class*="menu-item"], li, button'))
      .map((e) => (e.innerText || e.textContent || '').trim())
      .filter(Boolean);
  });
}

test('menu tasto destro su un link a un file scaricabile', async ({ testServer, openTab }) => {
  const page = await testServer.openReady(openTab, `
    <h1>Documenti</h1>
    <p><a id="file" href="https://esempio.it/manuale.pdf">Manuale (PDF)</a></p>
    <p><a id="zip" href="https://esempio.it/pacchetto.zip">Pacchetto (ZIP)</a></p>
    <p><a id="web" href="https://esempio.it/pagina">Una pagina normale</a></p>
  `);

  for (const id of ['file', 'zip', 'web']) {
    await page.click('body', { position: { x: 5, y: 5 } }).catch(() => {});
    await page.waitForTimeout(200);
    const el = page.locator(`#${id}`);
    await el.click({ button: 'right' });
    await page.waitForTimeout(900);
    const entries = await menuEntries(page);
    console.log(`--- menu su #${id}:`, JSON.stringify(entries));
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  }

  await page.locator('#file').click({ button: 'right' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'tests/.shots/probe-linkmenu.png' });
});
