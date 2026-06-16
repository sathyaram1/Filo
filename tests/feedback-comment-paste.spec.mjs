// FEEDBACK #22 (owner): "rendi possibile sempre incollare immagini o altri
// file quando aggiungo commenti. inoltre voglio poter aggiungere commenti
// anche nei feedback ricevuti non solo quelli da risolvere (in modo che
// posso commentare POI metterlo in da risolvere)".
//
// Due comportamenti da verificare, entrambi nella dashboard
// (filo://feedback/feedback.html):
//
//  1) Il tab "Ricevuti" (status `new`) ora ha una casella commento. Scrivere e
//     premere "Aggiungi commento" APPENDE un turno utente alle note (visibile
//     come bolla) e il feedback RESTA in `new` (niente cambio di stato): senza
//     il fix non esiste alcuna casella commento fuori da "Da risolvere", quindi
//     il test fallirebbe perché .fb-comment-text non esisterebbe affatto.
//
//  2) Incollare un'immagine nella casella commento la carica (via
//     SN_FEEDBACK.uploadImage, stubbato qui per restare offline e
//     deterministici — l'upload reale su Storage non è verificabile in CI) e
//     la mostra: l'url finisce in `images` del feedback E compare come <img>
//     nella card (fb-imgs), grazie al rendering esistente. Senza il fix non
//     c'è alcun listener 'paste' sulla casella, quindi l'update non parte e
//     non comparirebbe nessuna nuova <img>.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

async function setupAdmin(app, page, feedback, captureUpdates = false) {
  await expect(page.locator('#adminBanner')).toBeVisible({ timeout: 8_000 });

  await page.evaluate(({ fb, capture }) => {
    window.SN_FEEDBACK.list = async () => [fb];
    // Stub dell'upload: niente rete reale, ritorna un url fittizio ma stabile
    // e distinguibile (contiene il nome del blob caricato).
    window.SN_FEEDBACK.uploadImage = async (blob) => {
      const ext = (blob.type || '').includes('png') ? 'png' : 'bin';
      return { url: `https://fake.storage.test/upload-${(window.__uploadCount = (window.__uploadCount || 0) + 1)}.${ext}`, name: `upload.${ext}` };
    };
    if (capture) window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        if (window.__updates) window.__updates.push(msg);
        // Riflette l'update nel mock locale così un refresh successivo (se il
        // test lo facesse) vedrebbe lo stato coerente. Non strettamente
        // necessario qui ma evita sorprese.
        return { ok: true };
      }
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'sathyarampontillo@gmail.com' } };
      }
      return orig(msg);
    };
  }, { fb: feedback, capture: captureUpdates });

  await page.waitForFunction(() => {
    const e = document.querySelector('.fb-empty');
    return !e || !/Caricamento/.test(e.textContent || '');
  }, null, { timeout: 10_000 });

  await app.evaluate(async ({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
      if (url.includes('feedback')) {
        wc.send('filo:broadcast', {
          type: 'auth_changed', signedIn: true, isAdmin: true,
          profile: { email: 'sathyarampontillo@gmail.com' },
        });
      }
    }
  });

  await page.locator('#refresh').click();
}

test('Ricevuti: si può commentare senza cambiare stato, e il commento appare nel thread', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  await setupAdmin(app, page, {
    _id: 'mock-inbox-1',
    status: 'new',
    text: 'il tasto salva non funziona su mobile',
    url: 'https://example.com',
    clientId: 'tester-456',
    notes: '',
    createdAt: new Date().toISOString(),
  }, /* captureUpdates */ true);

  await page.locator('[data-tab="inbox"]').click();

  // Pre-condizione del fix: la casella commento esiste sul tab Ricevuti.
  const commentBox = page.locator('.fb-comment-text');
  await expect(commentBox).toBeVisible();

  await commentBox.click();
  await commentBox.fill('Confermato anche da me, ci guardo dopo.');
  await page.locator('.fb-comment-send').click();

  // L'update mandato al main NON deve includere `status` (resta in `new`).
  const upd = await page.waitForFunction(
    () => (window.__updates || []).find((m) => m.id === 'mock-inbox-1'),
    null, { timeout: 5_000 },
  ).then((h) => h.jsonValue());

  expect(upd.status).toBeUndefined();
  expect(upd.notes).toContain('Confermato anche da me');

  // Il commento appena inviato è visibile come bolla "Tu" nel thread (il
  // re-render dopo il patch mostra subito il nuovo turno).
  await expect(page.locator('.fb-bubble--user:not(.fb-bubble--report)')).toContainText('Confermato anche da me');

  // E il feedback è ancora nel tab Ricevuti (non è scomparso/spostato): la
  // card con quel testo è ancora visibile sotto questo stesso tab.
  await expect(page.locator('.fb-card')).toContainText('il tasto salva non funziona su mobile');
});

test('Ricevuti: incollare un\'immagine nel commento la carica e la mostra sulla card', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  // L'upload è stubbato (offline/deterministico), ma l'<img src> risultante
  // punta a un url fittizio che il browser tenterebbe di scaricare per
  // davvero: senza intercettarlo la richiesta fallisce e il listener 'error'
  // esistente sostituisce l'<img> con un placeholder "(immagine non
  // disponibile)" prima che il test riesca a controllarne il src. Qui
  // rispondiamo noi con un PNG valido, così l'<img> resta nel DOM e possiamo
  // verificare che il rendering ha davvero recepito il nuovo allegato.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
    'base64',
  );
  await page.route('https://fake.storage.test/**', (route) => route.fulfill({
    status: 200, contentType: 'image/png', body: png,
  }));

  await setupAdmin(app, page, {
    _id: 'mock-inbox-2',
    status: 'new',
    text: 'la sidebar si sovrappone al testo',
    url: 'https://example.com',
    clientId: 'tester-789',
    notes: '',
    images: [],
    createdAt: new Date().toISOString(),
  }, /* captureUpdates */ true);

  await page.locator('[data-tab="inbox"]').click();

  const commentBox = page.locator('.fb-comment-text');
  await expect(commentBox).toBeVisible();
  await commentBox.click();

  // Simula il paste di un'immagine: costruisce un ClipboardEvent con un
  // DataTransfer che contiene un File immagine, e lo dispatcha sulla casella
  // — lo stesso evento che il browser genera per un Ctrl+V con un'immagine
  // negli appunti.
  await commentBox.evaluate((el) => {
    const png = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'),
      (c) => c.charCodeAt(0),
    );
    const file = new File([png], 'screenshot.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
  });

  // L'indizio di caricamento compare e poi sparisce da solo a fine upload.
  await expect(page.locator('.fb-upload-hint')).toBeHidden({ timeout: 8_000 });

  // L'update mandato al main contiene il nuovo url in `images`.
  const upd = await page.waitForFunction(
    () => (window.__updates || []).find((m) => m.id === 'mock-inbox-2' && Array.isArray(m.images) && m.images.length > 0),
    null, { timeout: 8_000 },
  ).then((h) => h.jsonValue());

  expect(upd.images).toHaveLength(1);
  expect(upd.images[0]).toMatch(/^https:\/\/fake\.storage\.test\/upload-/);
  expect(upd.status).toBeUndefined(); // ancora niente cambio di stato

  // E soprattutto: l'immagine compare DAVVERO sulla card (non solo nel
  // payload mandato al main) — il re-render dopo il patch deve mostrarla.
  await expect(page.locator('.fb-imgs img')).toHaveCount(1);
  const src = await page.locator('.fb-imgs img').getAttribute('src');
  expect(src).toMatch(/^https:\/\/fake\.storage\.test\/upload-/);
});
