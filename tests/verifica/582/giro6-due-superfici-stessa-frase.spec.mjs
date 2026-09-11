// Verifica #582, giro 6 — le DUE superfici che mostrano una segnalazione a un
// essere umano devono dire la stessa cosa davanti allo stesso allegato.
//
// I giri 3 e 5 hanno lavorato sulla FRASE: chi non riceve le segnalazioni, davanti
// allo screenshot e al documento di una segnalazione, non deve leggere che
// l'operazione è riservata agli amministratori (lo manda a cercare un permesso
// che non avrà mai), né che l'allegato è stato consegnato e viaggia cifrato
// (Filo non l'ha guardato). Deve leggere l'unica cosa vera sempre: quell'allegato
// lo apre solo chi riceve le segnalazioni.
//
// Quella cura è stata scritta nel riquadro dei feedback. La Gestione mostra la
// stessa segnalazione, con gli stessi allegati, allo stesso utente — è la
// superficie gemella, e nei giri passati è sempre stata contata insieme
// all'altra. Questa prova chiede che ci dica la stessa cosa.

import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const RIQUADRO = 'filo://feedback/feedback.html';
const GESTIONE = 'filo://manage/manage.html';
const BUCKET = 'filo-8b9cb.firebasestorage.app';
const BASE = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/feedback%2F`;

const SEGNALAZIONE = {
  _id: 'due-superfici-582-g6',
  seq: 9583,
  subSeq: 0,
  number: 9583,
  status: 'open',
  name: 'Lo schermo diventa bianco',
  text: 'succede quando apro la seconda scheda',
  url: 'https://esempio.invalid/pagina',
  clientId: 'tester@example.com',
  createdAt: '2026-09-11T10:00:00Z',
  images: [`${BASE}1788891497000_11111111-1111-4111-8111-111111111111.png?alt=media`],
  files: [{
    name: 'registro.txt',
    url: `${BASE}1788891497001_22222222-2222-4222-8222-222222222222.txt?alt=media`,
    type: 'text/plain',
  }],
};

// Le parole che NON devono comparire davanti a un allegato che chi guarda non
// può aprire, e quella che deve comparire.
const VIETATE = /amministrator/i;
const RICHIESTA = /segnalazioni/i;

test('riquadro dei feedback: a chi non riceve le segnalazioni l’allegato dice chi lo apre', async ({ openTab }) => {
  const page = await openTab(RIQUADRO);
  await page.waitForFunction(() => !!window.__fbTest);
  await page.evaluate((fb) => {
    window.__fbTest.setAdmin(false, null);
    window.SN_FEEDBACK.list = async () => [fb];
  }, SEGNALAZIONE);
  await page.locator('#refresh').click();
  await expect(page.locator('.fb-card').first()).toBeVisible({ timeout: 10_000 });

  const segnaposto = page.locator('.fb-img-broken').first();
  await expect(segnaposto).toBeVisible({ timeout: 10_000 });
  const scritta = ((await segnaposto.textContent()) || '').trim();
  const hover = (await segnaposto.getAttribute('title')) || '';
  expect(`${scritta} ${hover}`, `il riquadro parla di amministratori: «${scritta}» / «${hover}»`).not.toMatch(VIETATE);
  expect(hover, `il riquadro non dice chi apre l’allegato: «${hover}»`).toMatch(RICHIESTA);

  // La pillola del documento: la stessa frase, senza bisogno del clic.
  await page.waitForTimeout(1200);
  const pillola = page.locator('a.fb-file').first();
  await expect(pillola).toBeVisible();
  const notaPillola = ((await pillola.textContent()) || '').trim();
  const hoverPillola = (await pillola.getAttribute('title')) || '';
  expect(`${notaPillola} ${hoverPillola}`, `la pillola parla di amministratori: «${notaPillola}» / «${hoverPillola}»`).not.toMatch(VIETATE);
  expect(hoverPillola, `la pillola non dice chi apre l’allegato: «${hoverPillola}»`).toMatch(RICHIESTA);
});

test('Gestione: davanti allo stesso allegato dice la stessa cosa del riquadro', async ({ openTab }) => {
  const page = await openTab(GESTIONE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!window.__mgTest);
  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(false);
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('queue');
    window.__mgTest.openDetail(fb._id);
  }, SEGNALAZIONE);
  await expect(page.locator('#mgDetail')).toBeVisible();
  await page.waitForTimeout(1500);

  mkdirSync('tests/.shots', { recursive: true });
  await page.screenshot({ path: 'tests/.shots/582-giro6-gestione-non-admin.png', fullPage: true });

  // Lo screenshot: quello che si legge (alt) e quello che si legge passandoci
  // sopra (title) davanti a un allegato che chi guarda non apre.
  const img = page.locator('.mg-bubble-imgs img').first();
  await expect(img).toBeVisible();
  const alt = (await img.getAttribute('alt')) || '';
  const titleImg = (await img.getAttribute('title')) || '';
  expect(`${alt} ${titleImg}`, `Gestione parla di amministratori: «${alt}» / «${titleImg}»`).not.toMatch(VIETATE);
  expect(`${alt} ${titleImg}`, `Gestione non dice chi apre l’allegato: «${alt}» / «${titleImg}»`).toMatch(RICHIESTA);

  // La pillola del documento: come nel riquadro, lo dice PRIMA del clic.
  const pillola = page.locator('a.mg-file-link').first();
  await expect(pillola).toBeVisible();
  const testoPillola = ((await pillola.textContent()) || '').trim();
  const hoverPillola = (await pillola.getAttribute('title')) || '';
  expect(`${testoPillola} ${hoverPillola}`, `la pillola di Gestione parla di amministratori: «${testoPillola}» / «${hoverPillola}»`).not.toMatch(VIETATE);
  expect(hoverPillola, `la pillola di Gestione non dice niente prima del clic: «${hoverPillola}»`).toMatch(RICHIESTA);
});
