// Verifica avversariale #497 — giro 2, seconda ondata.
// Le altre porte da cui la frase per chi ha segnalato potrebbe uscire di scena,
// e la riga dei tasti sullo schermo al 125% (quello dell'owner).

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const BASE = {
  _id: 'v497b',
  text: 'Il tasto non fa niente',
  name: 'Tasto muto',
  seq: 497,
  subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-09-01T10:00:00Z',
  images: [],
  notes: 'Report della lavorazione.',
};

async function pronta(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
  });
}

async function apri(page, fb, tab) {
  await page.evaluate(({ f, t }) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([f]);
    window.__mgTest.setTab(t);
    window.__mgTest.openDetail(f._id);
  }, { f: fb, t: tab });
}

test('rispondendo a un chiarimento la frase scritta non sparisce', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await apri(page, { ...BASE, _id: 'v497b-clarify', status: 'clarify' }, 'inbox');
  await expect(page.locator('#mgClarify')).toBeVisible();
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').fill('Ti ho risposto: guarda la conversazione.');
  await page.locator('#mgClarifyText').fill('Intendevo il tasto in alto a destra.');
  await page.locator('#mgClarifyBtn').click();
  await expect.poll(() => page.evaluate(() => window.__updates.length), { timeout: 5000 }).toBeGreaterThanOrEqual(2);
  const inviati = await page.evaluate(() => window.__updates);
  const frase = inviati.find((u) => typeof u.userNote === 'string');
  expect(frase, 'la frase non è partita rispondendo al chiarimento').toBeTruthy();
  expect(frase.userNote).toBe('Ti ho risposto: guarda la conversazione.');
});

test('riaprendo un fix la frase scritta parte prima', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await apri(page, { ...BASE, _id: 'v497b-riapri', status: 'done', statusPublic: 'closed' }, 'resolved');
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').fill('Riaperta: manca ancora il caso del trascinamento.');
  await page.locator('#mgActionsRow button', { hasText: 'Riapri' }).click();
  await page.locator('#mgReopenText').fill('Il trascinamento non funziona ancora.');
  await page.locator('#mgReopenConfirmBtn').click();
  await expect.poll(() => page.evaluate(() => window.__updates.length), { timeout: 5000 }).toBeGreaterThanOrEqual(2);
  const inviati = await page.evaluate(() => window.__updates);
  const frase = inviati.find((u) => typeof u.userNote === 'string');
  const stato = inviati.find((u) => typeof u.status === 'string');
  expect(frase).toBeTruthy();
  expect(frase.userNote).toBe('Riaperta: manca ancora il caso del trascinamento.');
  expect(inviati.indexOf(frase)).toBeLessThan(inviati.indexOf(stato));
});

test('il tasto di stato premuto senza mai uscire dalla casella porta via la frase con sé', async ({ openTab }) => {
  // Cammino "duro": il clic parte da JS, quindi la casella NON perde il fuoco e
  // il salvataggio automatico da blur non scatta. Deve bastare comunque.
  const page = await openTab(URL);
  await pronta(page);
  await apri(page, { ...BASE, _id: 'v497b-nofocus', status: 'todo', reviewDecision: 'accepted' }, 'queue');
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').type('Scritta e mai lasciata.', { delay: 10 });
  await page.evaluate(() => {
    [...document.querySelectorAll('#mgActionsRow button')].find((b) => /Risolto/.test(b.textContent)).click();
  });
  await expect.poll(() => page.evaluate(() => window.__updates.length), { timeout: 5000 }).toBeGreaterThanOrEqual(2);
  const inviati = await page.evaluate(() => window.__updates);
  const frase = inviati.find((u) => typeof u.userNote === 'string');
  expect(frase, 'la frase non è partita').toBeTruthy();
  expect(frase.userNote).toBe('Scritta e mai lasciata.');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).not.toBe(null);
});

test('la frase si può anche togliere, e il segno sul tasto se ne accorge', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await apri(page, { ...BASE, _id: 'v497b-tolgo', status: 'done', statusPublic: 'closed', userNote: 'Adesso funziona.' }, 'resolved');
  const toggle = page.locator('#mgUserNoteToggle');
  await expect(toggle).toHaveClass(/mg-usernote-piena/);
  await toggle.click();
  await page.locator('#mgUserNoteText').fill('');
  await page.locator('#mgUserNoteBtn').click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  expect(await page.evaluate(() => window.__updates[0].userNote)).toBe('');
  await expect(page.locator('#mgUserNoteMsg')).toHaveText('Frase rimossa');
  await expect(toggle).not.toHaveClass(/mg-usernote-piena/);
  expect(await toggle.getAttribute('title')).not.toContain('Adesso funziona.');
  expect(await page.locator('#mgThread').innerText()).not.toContain('Adesso funziona.');
});

test('Invio nella casella salva', async ({ openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await apri(page, { ...BASE, _id: 'v497b-invio', status: 'todo', reviewDecision: 'accepted' }, 'queue');
  await page.locator('#mgUserNoteToggle').click();
  await page.locator('#mgUserNoteText').type('Salvata con Invio.', { delay: 5 });
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  expect(await page.evaluate(() => window.__updates[0].userNote)).toBe('Salvata con Invio.');
});

test('la larghezza a cui i tasti vanno a capo', async ({ app, openTab }) => {
  const page = await openTab(URL);
  await pronta(page);
  await apri(page, { ...BASE, _id: 'v497b-larghezza', status: 'suspicious_file' }, 'inbox');
  const misura = async () => page.evaluate(() => {
    const els = [...document.querySelectorAll('#mgActionsRow button, #mgStarBtn, #mgUserNoteToggle')]
      .filter((el) => el.getClientRects().length);
    const tops = els.map((el) => Math.round(el.getBoundingClientRect().top));
    return { righe: new Set(tops).size, quanti: els.length };
  });
  const soglie = [];
  for (const w of [1600, 1400, 1280, 1200, 1100, 1000, 900, 800, 700, 600, 500]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(120);
    const m = await misura();
    soglie.push(`${w}px → ${m.righe} riga/e (${m.quanti} tasti)`);
  }
  console.log('LARGHEZZE:', soglie.join(' | '));
});
