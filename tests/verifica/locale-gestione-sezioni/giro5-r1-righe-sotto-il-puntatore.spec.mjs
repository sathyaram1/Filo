// Giro 5, rilievo 1: la rilettura di ogni minuto non sposta le domande sotto il puntatore fermo e non toglie il fuoco
// della tastiera: il clic e l'Invio che l'owner sta per dare arrivano alla domanda che ha davanti.
import { test, expect } from '../../fixtures/electron.mjs';
import { installa, sulServer, apri, domanda, fb, letture } from './aiuti-giro5.mjs';

async function domandeAperte(app, openTab) {
  await installa(app, { feedback: [fb('fb1', 'aligned')], domande: Array.from({ length: 12 }, (_, i) => domanda(i + 1)) });
  const page = await apri(openTab);
  await page.evaluate(() => window.__mgTest.setLiveTiming({ pollMs: 3000, clockMs: 500, rientroMs: 1000 }));
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await page.locator('.mg-domanda[data-id="D-1"]').click();
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-1"]')).toBeVisible();
  return page;
}

async function aspettaRilettura(app, cambio) {
  const prima = await letture(app);
  await sulServer(app, cambio);
  await expect.poll(() => letture(app), { timeout: 20_000 }).toBeGreaterThan(prima);
}

const centro = async (loc) => { const b = await loc.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

test('r1 una bloccante nuova arrivata sopra non sposta la casella sotto il puntatore: il clic spunta la domanda puntata', async ({ app, openTab }) => {
  const page = await domandeAperte(app, openTab);
  const [x, y] = await centro(page.locator('.mg-domanda[data-id="D-8"] .mg-dom-sel'));
  await page.mouse.move(x, y);
  await aspettaRilettura(app, (F) => {
    const ora = Date.now();
    F.domande.push({ ...F.domande[0], id: 'D-99', numero: 99, titolo: 'Bloccante nuova', priorita: 'bloccante', creataIl: ora, modificataIl: ora });
  });
  await page.waitForTimeout(800);
  await page.mouse.down();
  await page.mouse.up();
  const spuntate = await page.evaluate(() => [...document.querySelectorAll('#mgDomandeLista .mg-domanda')]
    .filter((r) => r.querySelector('.mg-dom-sel')?.checked).map((r) => r.dataset.id));
  expect(spuntate).toEqual(['D-8']);
});

test('r1 due domande chiuse altrove sopra non spostano la riga sotto il puntatore: il clic apre la domanda puntata', async ({ app, openTab }) => {
  const page = await domandeAperte(app, openTab);
  const [x, y] = await centro(page.locator('.mg-domanda[data-id="D-10"]'));
  await page.mouse.move(x, y);
  await aspettaRilettura(app, (F) => {
    for (const id of ['D-2', 'D-3']) {
      const d = F.domande.find((q) => q.id === id);
      d.stato = 'chiusa'; d.esito = { ok: true }; d.modificataIl = Date.now();
    }
  });
  await page.waitForTimeout(800);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator('#mgDomandaDettaglio .mg-dq').first()).toHaveAttribute('data-id', 'D-10');
});

test('r1 il fuoco della tastiera resta sulla riga quando la rilettura cambia un\'altra domanda: Invio la apre', async ({ app, openTab }) => {
  const page = await domandeAperte(app, openTab);
  await page.locator('.mg-domanda[data-id="D-11"]').focus();
  await aspettaRilettura(app, (F) => {
    const d = F.domande.find((q) => q.id === 'D-5');
    d.titolo = 'Cambiata sul server'; d.modificataIl = Date.now();
  });
  await expect(page.locator('.mg-domanda[data-id="D-5"]')).toContainText('Cambiata sul server', { timeout: 10_000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('#mgDomandaDettaglio .mg-dq').first()).toHaveAttribute('data-id', 'D-11');
});
