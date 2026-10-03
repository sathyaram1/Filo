// #870 giro 1, rilievo 3: sulla carta di destra Invio fa l'azione principale, il clic non fa niente.
// Le due strade devono fare la stessa cosa.
import { test, expect } from '../../fixtures/electron.mjs';
import { homeTab, finestre } from './_comune.mjs';

test('un clic sulla carta dell’Editor fa quello che fa Invio: apre l’Editor', async ({ app }) => {
  test.setTimeout(45_000);
  const page = await homeTab(app);
  const editor = page.locator('#tieni .dash-carta[data-tipo="editor"]');
  await editor.click({ position: { x: 150, y: 20 } });
  await expect.poll(() => finestre(app, 'filo://editor').length, { timeout: 6_000 }).toBeGreaterThan(0);
});
