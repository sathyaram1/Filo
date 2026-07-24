// Spec Playwright per la visualizzazione degli allegati immagine cifrati nella
// dashboard di gestione (filo://manage/) — bug "non riesco ad aprire l'immagine".
//
// Gli allegati dei feedback sono cifrati come byte opachi su Storage: un
// <img src=URL> diretto mostrava un allegato ROTTO. Ora la bolla monta un
// segnaposto e chiede al main di decifrare l'immagine (feedback_decrypt_image),
// poi riempie src col data URL. Qui stubbiamo quell'IPC ed esercitiamo il VERO
// codice di rendering (openDetail → renderThread → appendBubble).
//
// Assert di COMPORTAMENTO (fallirebbe prima del fix, quando src era l'URL cifrato):
//   - un'immagine decifrata con successo prende il data URL come src e perde lo
//     stato di caricamento;
//   - il click apre il lightbox con l'immagine DECIFRATA (mai con l'URL cifrato);
//   - un'immagine che il main non riesce a decifrare mostra lo stato "non
//     disponibile" invece di un riquadro rotto silenzioso.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

// Un data URL 1x1 PNG: è ciò che il main restituirebbe dopo aver decifrato.
const FAKE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const ENC_URL_OK = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2Fok.png?alt=media';
const ENC_URL_FAIL = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2Ffail.png?alt=media';

const FAKE_FB = {
  _id: 'test-img-001',
  text: 'oggi è martedì',
  name: 'Test immagine allegata',
  seq: 363,
  subSeq: 0,
  clientId: 'owner:caf22093',
  createdAt: '2026-07-21T10:00:00Z',
  images: [ENC_URL_OK, ENC_URL_FAIL],
  pipeline: {
    action: 'block_spam',
    l1Category: 'clean',
    l2Class: 'spam',
    stage: 'L2',
    verdicts: [{ judge: 'A', class: 'spam', reasoning: 'affermazione senza contesto' }],
    filoSummary: 'Classificato spam.',
  },
};

test('gli allegati immagine cifrati vengono decifrati e mostrati (con fallback)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);

  // Stub dell'IPC: la prima immagine decifra, la seconda no. Ogni altro
  // messaggio prosegue verso il main reale (auth_status ecc.).
  await page.evaluate(({ okUrl, dataUrl }) => {
    const orig = window.filo.message.bind(window.filo);
    window.__decryptCalls = [];
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_decrypt_image') {
        window.__decryptCalls.push(msg.url);
        if (msg.url === okUrl) return { ok: true, dataUrl };
        return { ok: false, error: 'decifratura immagine fallita' };
      }
      return orig(msg);
    };
  }, { okUrl: ENC_URL_OK, dataUrl: FAKE_DATA_URL });

  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('inbox');
    window.__mgTest.openDetail(fb._id);
  }, FAKE_FB);

  // Due <img> nella bolla utente.
  const imgs = page.locator('.mg-bubble--user .mg-bubble-imgs img');
  await expect(imgs).toHaveCount(2);

  // 1ª immagine: src diventa il data URL decifrato e sparisce lo stato di carico.
  const okImg = imgs.first();
  await expect(okImg).toHaveJSProperty('src', FAKE_DATA_URL);
  await expect(okImg).not.toHaveClass(/mg-img-loading/);
  // Non deve MAI puntare all'URL cifrato di Storage (il bug originale).
  const okSrc = await okImg.evaluate((el) => el.getAttribute('src'));
  expect(okSrc.startsWith('data:image/png')).toBe(true);

  // 2ª immagine: decifratura fallita → stato "non disponibile" + il MOTIVO
  // preciso del main finisce nel title (hover), così l'owner sa PERCHÉ non la
  // vede invece di un segnaposto muto.
  const failImg = imgs.nth(1);
  await expect(failImg).toHaveClass(/mg-img-failed/);
  await expect(failImg).toHaveAttribute('alt', 'immagine non disponibile');
  await expect(failImg).toHaveAttribute('title', 'decifratura immagine fallita');

  // L'IPC è stato chiamato per entrambe.
  const calls = await page.evaluate(() => window.__decryptCalls);
  expect(calls).toContain(ENC_URL_OK);
  expect(calls).toContain(ENC_URL_FAIL);

  // Click sull'immagine decifrata → lightbox aperto con il data URL (mai l'URL cifrato).
  await okImg.click();
  await expect(page.locator('#mgLightbox')).toHaveClass(/open/);
  await expect(page.locator('#mgLightboxImg')).toHaveJSProperty('src', FAKE_DATA_URL);
});
