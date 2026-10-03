// Chi manda una segnalazione con uno screenshot o un documento, riaprendola in
// Gestione, trova un segnaposto: l'allegato viaggia cifrato con la chiave di chi
// riceve le segnalazioni e lui non lo rivedrà. È voluto; il messaggio però deve
// dire chi lo apre, non mandarlo a cercare permessi di amministratore (#582).

import { test, expect } from './fixtures/electron.mjs';

// Allegati del bucket di Filo, nella forma esatta che il modulo dei feedback
// salva nella segnalazione. Non verranno mai scaricati: il main si ferma prima,
// perché chi guarda non è amministratore.
const ALLEGATO = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1788891497000_3f2a1b0c-1111-4222-8333-444455556666.png?alt=media&token=abc';
const DOCUMENTO = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1788891497001_3f2a1b0c-2222-4222-8333-444455556666.pdf?alt=media&token=def';

const GESTIONE_URL = 'filo://manage/manage.html';

// Senza il fix è rossa due volte: sull'alt dell'immagine e sull'hover della
// pillola, che prima del clic non diceva niente.
test('Gestione dice dell’allegato chi lo apre, non che mancano permessi', async ({ openTab }) => {
  const page = await openTab(GESTIONE_URL);
  await page.waitForFunction(() => !!window.__mgTest);
  await page.evaluate(({ img, doc }) => {
    window.__mgTest.setAdmin(false);
    window.__mgTest.setData([{
      _id: 'due-superfici-582',
      seq: 9582, subSeq: 0, number: 9582,
      status: 'open',
      name: 'Lo schermo diventa bianco',
      text: 'succede quando apro la seconda scheda',
      clientId: 'tester@example.com',
      createdAt: '2026-09-11T10:00:00Z',
      images: [img],
      files: [{ name: 'registro.txt', url: doc, type: 'text/plain' }],
    }]);
    window.__mgTest.setTab('queue');
    window.__mgTest.openDetail('due-superfici-582');
  }, { img: ALLEGATO, doc: DOCUMENTO });
  await expect(page.locator('#mgDetail')).toBeVisible();

  const img = page.locator('.mg-bubble-imgs img').first();
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute('alt', '(allegato riservato)', { timeout: 10_000 });
  const hoverImg = (await img.getAttribute('title')) || '';
  expect(hoverImg, 'Gestione dice chi apre l’allegato').toMatch(/lo apre solo chi riceve le segnalazioni/i);
  expect(hoverImg, 'Gestione manda un tester a cercare permessi che non avrà mai').not.toMatch(/amministrator/i);

  const pillola = page.locator('a.mg-file-link').first();
  await expect(pillola).toBeVisible();
  // Lo dice PRIMA del clic.
  await expect(pillola.locator('.mg-file-note')).toHaveText(/riservato/, { timeout: 10_000 });
  const hoverDoc = (await pillola.getAttribute('title')) || '';
  expect(hoverDoc, 'la pillola di Gestione non dice niente prima del clic').toMatch(/lo apre solo chi riceve le segnalazioni/i);
  expect(hoverDoc, 'la pillola di Gestione parla di amministratori').not.toMatch(/amministrator/i);
  // E di un allegato che non ha aperto, Filo non dichiara né che è arrivato né
  // come viaggia.
  expect(hoverDoc).not.toMatch(/consegnat|arrivat|ricevut|cifrat/i);
});
