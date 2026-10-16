// #857: la «Frase per chi ha segnalato» parte chiusa anche nella pagina Feedback, come in Gestione, e Esc la
// richiude in tutte e due le pagine. Senza la correzione la casella era aperta su ogni scheda della coda
// (primo controllo rosso) ed Esc in Gestione non la richiudeva (ultimo controllo rosso).

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';

const BASE = {
  clientId: 'tester-abc',
  status: 'todo',
  createdAt: '2026-09-28T10:00:00.000Z',
  notes: 'Report della lavorazione.',
};
const CODA = [
  { ...BASE, _id: 'fc-uno', seq: 1, text: 'Il pulsante di condivisione non risponde' },
  { ...BASE, _id: 'fc-due', seq: 2, text: 'La cronologia non si svuota', userNote: 'Ora la cronologia si svuota dal menu.' },
  { ...BASE, _id: 'fc-tre', seq: 3, text: 'Lo zoom torna al 100% da solo' },
];

async function apriCoda(page, items = CODA) {
  await page.waitForFunction(() => Boolean(window.__fbTest), null, { timeout: 10_000 });
  await page.evaluate((fbs) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
    window.__fbTest.setAdmin(true, { email: 'owner@example.com' });
    window.__fbTest.setData(fbs);
    window.__fbTest.setTab('queue');
  }, items);
  await expect(page.locator('.fb-card')).toHaveCount(items.length);
}

const tasto = (page, id) => page.locator(`.fb-usernote-toggle[data-id="${id}"]`);
const casella = (page, id) => page.locator(`.fb-usernote[data-id="${id}"]`);

test('pagina Feedback: in coda nessuna frase è aperta, e il tasto sulla riga delle azioni la apre e la chiude', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await apriCoda(page);

  for (const { _id } of CODA) {
    await expect(casella(page, _id), `frase di ${_id} chiusa`).toBeHidden();
    await expect(tasto(page, _id)).toHaveAttribute('aria-expanded', 'false');
    // Sulla stessa riga dei tasti di stato della scheda.
    const card = page.locator(`.fb-card[data-id="${_id}"]`);
    const t = await tasto(page, _id).boundingBox();
    const a = await card.locator('.fb-act').first().boundingBox();
    expect(Math.abs((t.y + t.height / 2) - (a.y + a.height / 2)), `tasto della frase in riga su ${_id}`).toBeLessThan(4);
  }

  // Una frase già scritta si riconosce dal tasto, senza aprirlo; le altre no.
  await expect(tasto(page, 'fc-due')).toHaveClass(/fb-usernote-piena/);
  await expect(tasto(page, 'fc-due')).toHaveAttribute('title', 'Frase già scritta: “Ora la cronologia si svuota dal menu.”');
  await expect(tasto(page, 'fc-uno')).not.toHaveClass(/fb-usernote-piena/);
  await expect(tasto(page, 'fc-uno')).toHaveAttribute('title', 'Scrivi la riga che leggerà chi ha segnalato');

  // Un clic la apre col cursore dentro, solo su quella scheda; un altro la chiude.
  await tasto(page, 'fc-uno').click();
  await expect(casella(page, 'fc-uno')).toBeVisible();
  await expect(casella(page, 'fc-uno')).toBeFocused();
  await expect(tasto(page, 'fc-uno')).toHaveAttribute('aria-expanded', 'true');
  await expect(casella(page, 'fc-tre')).toBeHidden();
  await tasto(page, 'fc-uno').click();
  await expect(casella(page, 'fc-uno')).toBeHidden();
  await expect(tasto(page, 'fc-uno')).toHaveAttribute('aria-expanded', 'false');

  // La frase già scritta, aperta, è lì.
  await tasto(page, 'fc-due').click();
  await expect(casella(page, 'fc-due')).toHaveValue('Ora la cronologia si svuota dal menu.');
});

test('pagina Feedback: Esc richiude la frase, rende il fuoco al tasto, e quello che si è scritto parte', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await apriCoda(page);

  await tasto(page, 'fc-uno').click();
  await casella(page, 'fc-uno').fill('Ora la condivisione apre il foglio di sistema.');
  await casella(page, 'fc-uno').press('Escape');

  await expect(casella(page, 'fc-uno')).toBeHidden();
  await expect(tasto(page, 'fc-uno')).toBeFocused();
  await expect.poll(() => page.evaluate(
    () => (window.__updates || []).filter((u) => u.id === 'fc-uno' && typeof u.userNote === 'string').map((u) => u.userNote),
  )).toEqual(['Ora la condivisione apre il foglio di sistema.']);
  // Da chiusa, il tasto dice che adesso una frase c'è.
  await expect(tasto(page, 'fc-uno')).toHaveClass(/fb-usernote-piena/);
  await expect(tasto(page, 'fc-uno')).toHaveAttribute('title', /Ora la condivisione apre il foglio di sistema\./);

  // Riaperta la ritrova, e la chiusura della segnalazione se la porta dietro.
  await tasto(page, 'fc-uno').click();
  await expect(casella(page, 'fc-uno')).toHaveValue('Ora la condivisione apre il foglio di sistema.');
  await page.locator('.fb-act[data-id="fc-uno"][data-to="done"]').click();
  await expect.poll(() => page.evaluate(
    () => (window.__updates || []).find((u) => u.status === 'done')?.userNote,
  )).toBe('Ora la condivisione apre il foglio di sistema.');
});

test('pagina Feedback: aperta resta aperta quando la lista si ridisegna, e cambiando sezione riparte chiusa', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await apriCoda(page);

  await tasto(page, 'fc-tre').click();
  await expect(casella(page, 'fc-tre')).toBeFocused();
  // Dati nuovi dal server: la lista si ricompone, la casella no.
  await page.evaluate((fbs) => window.__fbTest.setData(fbs), CODA);
  await expect(casella(page, 'fc-tre')).toBeVisible();
  await expect(casella(page, 'fc-tre')).toBeFocused();
  await expect(tasto(page, 'fc-tre')).toHaveAttribute('aria-expanded', 'true');

  // Chiusa con Esc, il fuoco resta sul tasto anche dopo un ridisegno.
  await casella(page, 'fc-tre').press('Escape');
  await page.evaluate((fbs) => window.__fbTest.setData(fbs), CODA);
  await expect(tasto(page, 'fc-tre')).toBeFocused();

  await tasto(page, 'fc-tre').click();
  await page.evaluate(() => { window.__fbTest.setTab('inbox'); window.__fbTest.setTab('queue'); });
  await expect(casella(page, 'fc-tre')).toBeHidden();
});

test('pagina Feedback: se il salvataggio fallisce a frase chiusa, la casella si riapre', async ({ openTab }) => {
  const page = await openTab(FEEDBACK);
  await apriCoda(page);
  page.on('dialog', (d) => d.accept());
  await page.evaluate(() => {
    const orig = window.filo.message;
    window.filo.message = async (msg) => (msg && msg.type === 'feedback_update' && typeof msg.userNote === 'string')
      ? { ok: false, error: 'rete giù' } : orig(msg);
  });

  await tasto(page, 'fc-uno').click();
  await casella(page, 'fc-uno').fill('Non arriverà.');
  await casella(page, 'fc-uno').press('Escape');
  // Un errore dentro una casella chiusa non lo vedrebbe nessuno: torna aperta, su quello che c'è davvero.
  await expect(casella(page, 'fc-uno')).toBeVisible();
  await expect(casella(page, 'fc-uno')).toHaveValue('');
  await expect(tasto(page, 'fc-uno')).not.toHaveClass(/fb-usernote-piena/);
});

test('Gestione: Esc nella frase la richiude, rende il fuoco al tasto e salva', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await page.evaluate((f) => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([f]);
    window.__mgTest.setTab('queue');
    window.__mgTest.openDetail(f._id);
  }, CODA[0]);

  const modulo = page.locator('#mgUserNote');
  const tastoMg = page.locator('#mgUserNoteToggle');
  await tastoMg.click();
  await expect(page.locator('#mgUserNoteText')).toBeFocused();
  await page.locator('#mgUserNoteText').fill('Ora la condivisione apre il foglio di sistema.');
  await page.locator('#mgUserNoteText').press('Escape');

  await expect(modulo).toBeHidden();
  await expect(tastoMg).toBeFocused();
  await expect(tastoMg).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => page.evaluate(() => window.__updates.map((u) => u.userNote))).toEqual(['Ora la condivisione apre il foglio di sistema.']);
  await expect(tastoMg).toHaveClass(/mg-usernote-piena/);

  // Un Esc chiude una cosa sola: con la ricerca aperta, chiude la frase e la ricerca resta.
  await page.locator('#mgSearchToggle').click();
  await expect.poll(() => page.evaluate(() => window.__mgTest.isSearchMode())).toBe(true);
  await page.evaluate((id) => window.__mgTest.openDetail(id), CODA[0]._id);
  await tastoMg.click();
  await expect(page.locator('#mgUserNoteText')).toBeFocused();
  await page.locator('#mgUserNoteText').press('Escape');
  await expect(modulo).toBeHidden();
  expect(await page.evaluate(() => window.__mgTest.isSearchMode())).toBe(true);
});
