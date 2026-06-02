// Regression test per il feedback "cambia l'invio feedback": box centrato in
// basso, niente titolo/hint, niente riquadro dedicato per il drag, disegno a
// mano libera sullo schermo che auto-seleziona "Annota e allega", icone SVG al
// posto delle emoji, e testo della bozza persistito tra chiusura e riapertura.
//
// Asserisce IL SUCCESSO della feature (gli elementi nuovi ci sono e si
// comportano come richiesto), non l'assenza di un messaggio.

import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1',
    null,
    { timeout: 8_000 },
  );
  return win;
}

test('il box feedback è ridisegnato: niente titolo/hint/dropzone, icone SVG, centrato in basso', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  // Niente più header con titolo, né paragrafo hint, né riquadro dedicato.
  await expect(page.locator('.sn-fb-title')).toHaveCount(0);
  await expect(page.locator('.sn-fb-hint')).toHaveCount(0);
  await expect(page.locator('.sn-fb-drop')).toHaveCount(0);

  // La tela di disegno copre la pagina.
  await expect(page.locator('.sn-fb-canvas')).toHaveCount(1);

  // Icone SVG al posto delle emoji: chiusura e "annota e allega" contengono <svg>.
  await expect(page.locator('.sn-fb-close svg')).toHaveCount(1);
  await expect(page.locator('.sn-fb-attach svg')).toHaveCount(1);

  // Il box è ancorato in basso al centro della viewport.
  const placement = await page.evaluate(() => {
    const m = document.querySelector('.sn-fb-modal');
    const r = m.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    return {
      nearBottom: (window.innerHeight - r.bottom) < window.innerHeight * 0.25,
      centered: Math.abs(cx - window.innerWidth / 2) < 40,
    };
  });
  expect(placement.nearBottom, 'il box deve stare in basso').toBeTruthy();
  expect(placement.centered, 'il box deve essere centrato orizzontalmente').toBeTruthy();
});

test('disegnare sullo schermo seleziona "Annota e allega" e mostra "Cancella disegno"', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  const attach = page.locator('.sn-fb-attach');
  await expect(attach).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.sn-fb-clear')).toBeHidden();

  // Disegna un tratto nella zona alta (lontano dal box in basso).
  await page.mouse.move(120, 120);
  await page.mouse.down();
  await page.mouse.move(220, 180, { steps: 6 });
  await page.mouse.move(320, 140, { steps: 6 });
  await page.mouse.up();

  // Il pulsante si auto-seleziona e compare il comando per cancellare il disegno.
  await expect(attach).toHaveAttribute('aria-pressed', 'true');
  await expect(attach).toHaveClass(/sn-fb-attach-on/);
  await expect(page.locator('.sn-fb-clear')).toBeVisible();

  // "Cancella disegno" deseleziona e rimuove i tratti.
  await page.locator('.sn-fb-clear').click();
  await expect(attach).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.sn-fb-clear')).toBeHidden();
});

test('il testo della bozza sopravvive a chiusura e riapertura del box', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-text')).toBeVisible();

  const DRAFT = 'bozza che deve sopravvivere alla chiusura';
  await page.locator('.sn-fb-text').fill(DRAFT);
  // Attende il debounce di salvataggio (250ms) + margine.
  await page.waitForTimeout(500);

  // Chiude e riapre.
  await page.evaluate(() => window.SN_FEEDBACK_UI.close());
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-text')).toHaveValue(DRAFT, { timeout: 4_000 });

  // Pulizia: svuota la bozza per non sporcare altri test.
  await page.locator('.sn-fb-text').fill('');
  await page.waitForTimeout(400);
  await page.evaluate(() => window.SN_FEEDBACK_UI.close());
});
