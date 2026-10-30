// Verifica #1791, giro 2, rilievo 1: in una lista corta tenuta ferma sotto il puntatore, le domande arrivate più su
// restano tagliate sopra la colonna e la rotella non le raggiunge finché il puntatore non esce dalla lista.
import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE, domanda } from '../../helpers/gestioneMainFinto.mjs';

const riga = (page, id) => page.locator(`#mgDomandeLista .mg-domanda[data-id="${id}"]`);

test('r1 lista corta tenuta ferma: con la rotella in su si arriva alle domande arrivate sopra', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  const base = [100, 101, 102].map((n, i) => domanda(n, { titolo: `Domanda ${n}`, creataIl: 1e12 + i * 1000 }));
  await page.evaluate((l) => window.__mgTest.setDomande(l, {}), base);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  const box = await riga(page, 'D-102').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const arrivi = [96, 97, 98].map((n, i) => domanda(n, { titolo: `Arrivata ${n}`, creataIl: 1 + i }));
  await page.evaluate((l) => window.__mgTest.setDomande(l, {}), [...arrivi, ...base]);
  await expect(riga(page, 'D-96')).toHaveCount(1);
  // La riga sotto il puntatore resta dov'era (la porta del giro 1, chiusa).
  expect(Math.abs((await riga(page, 'D-102').boundingBox()).y - box.y)).toBeLessThan(1.5);

  // Chi vede il conteggio salire e una riga tagliata in cima sale con la rotella, senza uscire dalla lista.
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(400);
  const cima = await page.locator('#mgDomandeCol .mg-col-body').boundingBox();
  const arrivata = await riga(page, 'D-96').boundingBox();
  expect(arrivata.y).toBeGreaterThanOrEqual(cima.y - 0.5);
});
