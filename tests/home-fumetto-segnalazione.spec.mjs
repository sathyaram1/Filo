// #1635 — nella chat della home il tasto della segnalazione proposta e la riga «Segnalazione inviata» mostrano al
// passaggio del mouse il fumetto di Filo con titolo e testo interi: un testo lungo scorre con la rotella, il fumetto non
// copre il tasto, sparisce all'uscita e non cambia quello che parte. Riaperta la home, le righe lo dicono ancora (#1704.1),
// e fumetto, riquadro e invio dicono lo stesso titolo anche quando il modello lo scrive sotto un altro nome o non lo scrive.
// Modello finto, invio finto, nessuna rete.

import { test, expect } from './fixtures/electron.mjs';
import { home, modelloFinto, chiedi, ripristina } from './helpers/chatFinta.mjs';
import { livelloAutonomia } from './helpers/autonomia.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from './helpers/confirm.mjs';

const TITOLO = 'Timer muto';
const CODA = 'Questa è la coda della segnalazione.';
const TESTO = `Il timer non suona quando la scheda è dietro.\n${'Lo provo ogni mattina e il suono non arriva mai. '.repeat(60)}${CODA}`;
const FEEDBACK = { id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify({ testo: TESTO, titolo: TITOLO }) };

const fumetto = (page) => page.locator('[data-sn-fumetto] .tip');
const aperto = (page) => page.evaluate(() => window.SN_SUGGERIMENTO.aperto()?.testo || '');

async function passaSopra(page, loc) {
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
  return b;
}

// Il fumetto con titolo e testo interi, che non copre il pezzo; scorre con la rotella fino in fondo, poi all'uscita va via.
async function fumettoDellaSegnalazione(page, loc, nome) {
  const pezzo = await passaSopra(page, loc);
  const tip = fumetto(page);
  await expect(tip, `${nome}: il fumetto di Filo compare`).toBeVisible({ timeout: 3000 });
  await expect(tip).toContainText(TITOLO);
  await expect(tip).toContainText('Il timer non suona quando la scheda è dietro.');
  expect(await tip.evaluate((el) => el.textContent), `${nome}: il testo è intero`).toBe(`${TITOLO}\n\n${TESTO}`);
  const b = await tip.boundingBox();
  const copre = b.y < pezzo.y + pezzo.height && b.y + b.height > pezzo.y && b.x < pezzo.x + pezzo.width && b.x + b.width > pezzo.x;
  expect(copre, `${nome}: il fumetto non copre il pezzo`).toBe(false);
  expect(await loc.evaluate((el) => el.hasAttribute('title')), `${nome}: niente rettangolo nativo durante il passaggio`).toBe(false);
  // Più lungo dello spazio libero: la rotella sopra il pezzo lo scorre fino alla coda, e il fumetto resta aperto.
  const misure = () => tip.evaluate((el) => ({ su: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
  expect((await misure()).max, `${nome}: il testo lungo eccede e scorre`).toBeGreaterThan(0);
  for (let i = 0; i < 40 && (await misure()).su < (await misure()).max - 1; i++) await page.mouse.wheel(0, 400);
  const m = await misure();
  expect(m.su, `${nome}: la rotella porta alla coda`).toBeGreaterThanOrEqual(m.max - 1);
  await expect(tip).toBeVisible();
  await page.screenshot({ path: `tests/.shots/home-fumetto-segnalazione-${nome}.png` });
  await page.mouse.move(pezzo.x + pezzo.width / 2, Math.max(2, pezzo.y - 120), { steps: 3 });
  await expect.poll(() => aperto(page), { timeout: 3000, message: `${nome}: il fumetto va via col mouse fuori` }).not.toContain(TITOLO);
}

test('#1635 la segnalazione proposta e quella inviata mostrano titolo e testo nel fumetto di Filo', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await app.evaluate(() => {
    globalThis.__fbInviati = [];
    globalThis.__submitVero = globalThis.SN_FEEDBACK.submit;
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__fbInviati.push(p); return { id: 'fb-1635' }; };
  });
  try {
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ text: '', toolCalls: [FEEDBACK] }, { text: 'Fatto.' }]);
    await chiedi(page, 'segnala che il timer non suona');
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
    await clickConfirm(page, 'cancel');
    await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);

    // Annullata, la proposta resta come tasto: il passaggio del mouse dice cosa partirebbe, senza mandarlo.
    const tasto = page.locator('.dash-bubble-filo .dash-action-btn', { hasNotText: '✓' }).first();
    await expect(tasto).toBeVisible({ timeout: 5000 });
    await fumettoDellaSegnalazione(page, tasto, 'proposta');
    await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
    expect(await app.evaluate(() => globalThis.__fbInviati.length), 'il fumetto non invia niente').toBe(0);

    await tasto.click();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5000 });
    if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
    await scrollConfirmToEnd(page);
    await clickConfirm(page, 'ok');
    // Partita, il tasto spuntato dice ancora cosa è partito; e così la riga del diario, aperto il blocco del lavoro.
    const spuntato = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: '✓' }).first();
    await expect(spuntato).toBeVisible({ timeout: 10_000 });
    await fumettoDellaSegnalazione(page, spuntato, 'partita');
    await page.getByRole('button', { name: /Ha preparato una segnalazione/ }).first().click();
    await page.locator('.dash-activity-seg-head', { hasText: 'Preparata una segnalazione' }).first().click();
    const riga = page.locator('.dash-activity-row', { hasText: `Segnalazione inviata · ${TITOLO}` }).first();
    await expect(riga).toBeVisible({ timeout: 10_000 });
    await fumettoDellaSegnalazione(page, riga, 'inviata');

    const inviati = await app.evaluate(() => globalThis.__fbInviati);
    expect(inviati).toHaveLength(1);
    expect(JSON.stringify(inviati[0]), 'parte il testo intero, non toccato dal fumetto').toContain(CODA);
  } finally {
    await app.evaluate(() => { if (globalThis.__submitVero) globalThis.SN_FEEDBACK.submit = globalThis.__submitVero; });
    await ripristina(app);
  }
});

async function conInvioFinto(app, fn) {
  await app.evaluate(() => {
    globalThis.__fbInviati = [];
    globalThis.__submitVero = globalThis.SN_FEEDBACK.submit;
    globalThis.SN_FEEDBACK.submit = async (p) => { globalThis.__fbInviati.push(p); return { id: 'fb-1704' }; };
  });
  try {
    await fn();
  } finally {
    await app.evaluate(() => { if (globalThis.__submitVero) globalThis.SN_FEEDBACK.submit = globalThis.__submitVero; });
    await ripristina(app);
  }
}

async function confermaInvio(page) {
  if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
}

const BREVE = 'Il timer non suona mai quando la scheda è dietro.';

for (const esito of ['inviata', 'non inviata']) {
  test(`#1704.1 riaperta la home, la riga «Segnalazione ${esito}» mostra ancora titolo e testo nel fumetto`, async ({ app }) => {
    test.setTimeout(90_000);
    const page = await home(app);
    await conInvioFinto(app, async () => {
      await livelloAutonomia(app, 'conservativo');
      await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify({ testo: BREVE, titolo: TITOLO }) }] }, { text: 'Fatto.' }]);
      await chiedi(page, 'segnala il timer');
      await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
      if (esito === 'inviata') {
        await confermaInvio(page);
        await expect(page.locator('.dash-bubble-filo .dash-action-btn', { hasText: '✓' }).first()).toBeVisible({ timeout: 10_000 });
      } else {
        await clickConfirm(page, 'cancel');
        await expect(page.locator('.dash-bubble-filo .dash-action-btn', { hasNotText: '✓' }).first()).toBeVisible({ timeout: 5000 });
      }
      await page.reload();
      const di = await home(app);
      const riga = di.locator('.dash-activity-row', { hasText: esito === 'inviata' ? `Segnalazione inviata · ${TITOLO}` : 'Segnalazione non inviata' }).first();
      await expect(riga).toBeVisible({ timeout: 10_000 });
      await passaSopra(di, riga);
      const tip = fumetto(di);
      await expect(tip, 'riaperta, la riga ha il suo fumetto').toBeVisible({ timeout: 3000 });
      expect(await tip.evaluate((el) => el.textContent)).toBe(`${TITOLO}\n\n${BREVE}`);
      await di.screenshot({ path: `tests/.shots/home-fumetto-segnalazione-riaperta-${esito.replace(' ', '-')}.png` });
    });
  });
}

// Il titolo sotto il terzo nome, o non scritto: il fumetto dice quello che il riquadro chiede e l'invio manda.
for (const [nome, campi] of [['sotto «name»', { testo: BREVE, name: TITOLO }], ['senza titolo', { testo: BREVE }]]) {
  test(`#1704.1 titolo ${nome}: fumetto, riquadro e invio dicono lo stesso titolo`, async ({ app }) => {
    test.setTimeout(90_000);
    const page = await home(app);
    await conInvioFinto(app, async () => {
      await livelloAutonomia(app, 'conservativo');
      await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: JSON.stringify(campi) }] }, { text: 'Fatto.' }]);
      await chiedi(page, 'segnala il timer');
      const riquadro = page.locator(CONFIRM_HOST);
      await expect(riquadro).toBeVisible({ timeout: 10_000 });
      await clickConfirm(page, 'cancel');
      const tasto = page.locator('.dash-bubble-filo .dash-action-btn', { hasNotText: '✓' }).first();
      await expect(tasto).toBeVisible({ timeout: 5000 });
      await passaSopra(page, tasto);
      await expect(fumetto(page)).toBeVisible({ timeout: 3000 });
      const [titolo, testo] = (await fumetto(page).evaluate((el) => el.textContent)).split('\n\n');
      expect(testo).toBe(BREVE);
      expect(titolo, 'il fumetto ha un titolo').toBeTruthy();
      if (campi.name) expect(titolo).toBe(TITOLO);
      await page.mouse.move(5, 5);

      await tasto.click();
      await expect(riquadro).toBeVisible({ timeout: 5000 });
      await expect.poll(() => confirmText(page), { message: 'il riquadro chiede lo stesso titolo' }).toContain(`Titolo:\n«${titolo}»`);
      await confermaInvio(page);
      await expect.poll(() => app.evaluate(() => globalThis.__fbInviati.length), { timeout: 10_000 }).toBe(1);
      const [inviato] = await app.evaluate(() => globalThis.__fbInviati);
      expect(inviato.name, 'parte il titolo che il fumetto diceva').toBe(titolo);
      expect(inviato.text).toBe(testo);
    });
  });
}
