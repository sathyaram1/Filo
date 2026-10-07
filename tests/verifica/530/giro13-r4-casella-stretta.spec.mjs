// Verifica #530 giro 13, rilievo 4: con la finestra stretta il livello di autonomia toglie alla casella della home un terzo dello spazio.
import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

test('r4 a 720 pixel la casella della home lascia al testo almeno metà della sua larghezza', async ({ app }) => {
  const page = await home(app);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(720, 800));
  await page.waitForTimeout(800);
  await page.locator('#input').fill('una domanda abbastanza lunga da andare su due righe nella casella della home di Filo');
  const m = await page.evaluate(() => ({
    form: document.getElementById('inputForm').getBoundingClientRect().width,
    testo: document.getElementById('input').getBoundingClientRect().width,
  }));
  expect(m.testo, `al testo restano ${Math.round(m.testo)} pixel su ${Math.round(m.form)}`).toBeGreaterThan(m.form / 2);
});
