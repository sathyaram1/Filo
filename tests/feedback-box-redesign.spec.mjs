// Regression test per il box feedback ridisegnato (richiesta utente): box per
// scrivere + 4 bottoni nell'ordine Chiudi, Allega, "Allega screenshot"/Cancella,
// Invia. Il box è trascinabile (maniglia in alto) e non usa translateX(-50%)
// (che sfocava il testo su HiDPI). Il bottone screenshot è SEMPRE presente: di
// default "Allega screenshot" (premuto = selezionato → allega lo scatto anche
// senza disegnare); appena si disegna diventa "Cancella" (stesso colore).
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

test('il box feedback è solo un box + 4 bottoni (Allega/Chiudi/Invia/Cancella), nuovo placeholder, niente × né footer', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  // Niente più header/titolo, hint, dropzone dedicata, × in alto, né footer.
  await expect(page.locator('.sn-fb-title')).toHaveCount(0);
  await expect(page.locator('.sn-fb-hint')).toHaveCount(0);
  await expect(page.locator('.sn-fb-drop')).toHaveCount(0);
  await expect(page.locator('.sn-fb-close')).toHaveCount(0);
  await expect(page.locator('.sn-fb-footer')).toHaveCount(0);

  // Box per scrivere con il nuovo placeholder.
  await expect(page.locator('.sn-fb-text')).toBeVisible();
  await expect(page.locator('.sn-fb-text')).toHaveAttribute(
    'placeholder', /Descrivi il bug o la feature.*trascinare/i);

  // I 3 bottoni sempre presenti + l'input file per "Allega".
  await expect(page.locator('.sn-fb-attach')).toHaveText(/Allega/);
  await expect(page.locator('.sn-fb-cancel')).toHaveText(/Chiudi/);
  await expect(page.locator('.sn-fb-send')).toHaveText(/Invia/);
  await expect(page.locator('.sn-fb-file')).toHaveCount(1);

  // Icona SVG nel bottone "Allega".
  await expect(page.locator('.sn-fb-attach svg')).toHaveCount(1);

  // Il bottone screenshot è SEMPRE presente: di default "Allega screenshot",
  // non selezionato (niente più bottone nascosto finché non si disegna).
  await expect(page.locator('.sn-fb-clear')).toBeVisible();
  await expect(page.locator('.sn-fb-clear')).toHaveText(/Allega screenshot/);
  await expect(page.locator('.sn-fb-clear')).not.toHaveClass(/sn-fb-clear--on/);

  // Ordine richiesto: Chiudi (primo), Allega (secondo), Allega screenshot (terzo),
  // Invia (ultimo).
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('.sn-fb-actions button')].map((b) =>
      b.className.match(/sn-fb-(cancel|attach|clear|send)/)?.[1]));
  expect(order).toEqual(['cancel', 'attach', 'clear', 'send']);

  // Maniglia per spostare il box.
  await expect(page.locator('.sn-fb-drag')).toHaveCount(1);

  // Niente translateX(-50%) sul box (era la causa del testo sfocato su HiDPI).
  const transform = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.sn-fb-modal')).transform);
  expect(transform === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(transform)).toBeTruthy();

  // La tela di disegno copre la pagina.
  await expect(page.locator('.sn-fb-canvas')).toHaveCount(1);

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

  await page.evaluate(() => window.SN_FEEDBACK_UI.close());
});

test('disegnare fa diventare il bottone "Cancella" (selezionato); cliccarlo cancella e torna "Allega screenshot"', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  const clear = page.locator('.sn-fb-clear');
  await expect(clear).toHaveText(/Allega screenshot/);
  await expect(clear).not.toHaveClass(/sn-fb-clear--on/);

  // Disegna un tratto nella zona alta (lontano dal box in basso).
  await page.mouse.move(120, 120);
  await page.mouse.down();
  await page.mouse.move(220, 180, { steps: 6 });
  await page.mouse.move(320, 140, { steps: 6 });
  await page.mouse.up();

  // Ora il bottone è "Cancella" ed è selezionato (stesso colore dello stato armato).
  await expect(clear).toHaveText(/Cancella/);
  await expect(clear).toHaveClass(/sn-fb-clear--on/);

  // Cliccarlo rimuove i tratti e torna a "Allega screenshot" (sempre visibile).
  await clear.click();
  await expect(clear).toBeVisible();
  await expect(clear).toHaveText(/Allega screenshot/);
  await expect(clear).not.toHaveClass(/sn-fb-clear--on/);

  await page.evaluate(() => window.SN_FEEDBACK_UI.close());
});

test('"Allega screenshot" premuto si seleziona; il box si può trascinare con la maniglia', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  // Premere "Allega screenshot" senza disegnare lo arma (selezionato, stesso colore).
  const clear = page.locator('.sn-fb-clear');
  await clear.click();
  await expect(clear).toHaveClass(/sn-fb-clear--on/);
  await expect(clear).toHaveText(/Allega screenshot/);
  // Ri-cliccarlo lo disarma.
  await clear.click();
  await expect(clear).not.toHaveClass(/sn-fb-clear--on/);

  // Trascinare la maniglia sposta il box.
  const before = await page.evaluate(() => {
    const r = document.querySelector('.sn-fb-modal').getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  const handle = page.locator('.sn-fb-drag');
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 120, hb.y + hb.height / 2 - 80, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate(() => {
    const r = document.querySelector('.sn-fb-modal').getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  expect(Math.abs(after.left - before.left)).toBeGreaterThan(40);
  expect(Math.abs(after.top - before.top)).toBeGreaterThan(20);

  await page.evaluate(() => window.SN_FEEDBACK_UI.close());
});

test('"Allega" apre un selettore file e aggiunge l\'immagine scelta tra le anteprime', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  // Niente anteprime all'inizio.
  await expect(page.locator('.sn-fb-thumb')).toHaveCount(0);

  // Un PNG 1x1 trasparente come file da allegare.
  const PNG_1x1 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  await page.setInputFiles('.sn-fb-file', {
    name: 'shot.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_1x1, 'base64'),
  });

  // L'immagine allegata compare tra le anteprime.
  await expect(page.locator('.sn-fb-thumb')).toHaveCount(1, { timeout: 4_000 });

  await page.evaluate(() => window.SN_FEEDBACK_UI.close());
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
