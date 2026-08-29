// Feedback #190.3 "Incollare immagini/file nei commenti della dashboard".
// L'admin deve poter ALLEGARE immagini e file mentre commenta un feedback, in
// tutti i compositori (note di triage su Ricevuti/In coda, risposta nei
// Chiarimenti), e l'allegato deve restare ANCORATO al singolo turno — non finire
// nella griglia immagini della segnalazione originale (scelta di design (b)).
//
// Gli allegati vivono come righe-marcatore dentro `notes` (niente cambio schema
// Firestore): qui asseriamo il SUCCESSO — l'allegato compare nel turno giusto e
// l'URL caricato finisce nel payload `notes` inviato al main.
//
// Come le altre spec della dashboard: mockiamo SN_FEEDBACK.list +
// uploadAttachment e intercettiamo window.filo.message per restare offline.

import { test, expect } from './fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

// 1×1 PNG (qualsiasi byte va bene: l'upload è mockato).
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function setupAdmin(app, page, feedback, captureUpdates = false) {
  await expect(page.locator('#adminBanner')).toBeVisible({ timeout: 8_000 });

  await page.evaluate(({ fb, capture }) => {
    window.SN_FEEDBACK.list = async () => [fb];
    // Mock dell'upload: niente rete, ritorna un URL deterministico per nome.
    window.SN_FEEDBACK.uploadAttachment = async (blob, name) => {
      const type = (blob && blob.type) || '';
      const kind = type.startsWith('image/') ? 'img' : 'file';
      return {
        kind,
        url: `https://firebasestorage.example/${encodeURIComponent(name || 'a')}`,
        name: String(name || (kind === 'img' ? 'immagine' : 'allegato')),
        type,
      };
    };
    if (capture) window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        if (window.__updates) window.__updates.push(msg);
        return { ok: true };
      }
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'sathyarampontillo@gmail.com' } };
      }
      // Il main decifra/scarica le immagini allegate ed è admin-gated: qui non
      // c'è una sessione admin REALE lato main (è finta solo lato renderer),
      // quindi mockiamo il decrypt perché l'immagine si risolva come per un admin
      // vero. Ritorna un 1×1 PNG deterministico.
      if (msg && msg.type === 'feedback_decrypt_image') {
        return { ok: true, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' };
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

test('un allegato in una RISPOSTA si mostra nella sua bolla, NON nella segnalazione', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  // Notes con un allegato-immagine ancorato al turno della risposta utente.
  const att = '@@filo-attachment {"kind":"img","url":"https://firebasestorage.example/shot.png"}';
  const notes = [
    'Ho risolto come chiesto.',
    '',
    '--- La tua risposta del 10/06/26, 09:00 ---',
    'Ecco lo screenshot del problema.',
    att,
  ].join('\n');

  await setupAdmin(app, page, {
    _id: 'mock-att-1',
    status: 'done',
    text: 'segnalazione senza immagini',
    url: 'https://example.com',
    clientId: 'tester-123',
    images: [], // la segnalazione NON ha immagini
    notes,
    createdAt: new Date().toISOString(),
  });

  await page.locator('[data-tab="resolved"]').click();

  // L'allegato compare — e si RISOLVE come immagine — nell'area immagini della
  // bolla RISPOSTA (lato utente, non report). Col decrypt mockato (admin vero),
  // l'<img> resta un'immagine (niente placeholder rotto): il suo URL sorgente
  // (data-url) è quello dell'allegato della risposta e viene mostrato (src
  // riempito col contenuto decifrato).
  const replyBubble = page.locator('.fb-bubble--user:not(.fb-bubble--report)');
  const attEl = replyBubble.locator('.fb-imgs img');
  await expect(attEl).toHaveCount(1);
  await expect(attEl.first()).toHaveAttribute('data-url', /shot\.png/);
  await expect(attEl.first()).toHaveAttribute('src', /^data:image\//);
  // …e NON nella bolla della segnalazione (che resta senza immagini).
  await expect(page.locator('.fb-bubble--report .fb-imgs')).toHaveCount(0);
  // La riga-marcatore grezza non deve apparire come testo nella bolla.
  await expect(replyBubble).not.toContainText('@@filo-attachment');
});

test('Domande di Filo: allegare un file alla risposta lo ancora al turno (URL nelle note)', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  await setupAdmin(app, page, {
    _id: 'mock-att-clarify',
    status: 'clarify',
    text: 'il pulsante non risponde',
    url: 'https://example.com',
    clientId: 'tester-123',
    notes: 'Puoi mandarmi uno screenshot del problema?',
    createdAt: new Date().toISOString(),
  }, /* captureUpdates */ true);

  await page.locator('[data-tab="inbox"]').click();

  const card = page.locator('.fb-card');
  const reply = card.locator('.fb-reply-text');
  await expect(reply).toBeVisible();
  await reply.fill('Eccolo qui.');

  // Allega un'immagine via l'input file del composer (l'upload è mockato).
  await card.locator('.fb-attach-mount[data-kind="reply"] input[type="file"]')
    .setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: PNG_1x1 });

  // La thumbnail appare nel composer della risposta.
  await expect(card.locator('.fb-attach-mount[data-kind="reply"] .fb-attach-thumb img')).toHaveCount(1);

  await card.locator('.fb-reply-send').click();

  // Il payload inviato: status todo + note che contengono testo, marcatore di
  // turno e la riga-allegato con l'URL caricato.
  const upd = await page.waitForFunction(
    () => (window.__updates || []).find((m) => m.id === 'mock-att-clarify'),
    null, { timeout: 5_000 },
  ).then((h) => h.jsonValue());

  expect(upd.status).toBe('todo');
  expect(upd.notes).toContain('Eccolo qui.');
  expect(upd.notes).toContain('@@filo-attachment');
  expect(upd.notes).toContain('screen.png');
});

test('In coda: allegare alla nota la salva subito nelle note (persistita)', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  await setupAdmin(app, page, {
    _id: 'mock-att-todo',
    status: 'todo',
    text: 'crash quando apro la sidebar',
    url: 'https://example.com',
    clientId: 'tester-123',
    notes: '',
    createdAt: new Date().toISOString(),
  }, /* captureUpdates */ true);

  await page.locator('[data-tab="queue"]').click();

  const card = page.locator('.fb-card');
  await card.locator('.fb-notes').fill('Riprodotto, allego il log.');

  // Allega un file di testo alla nota di triage.
  await card.locator('.fb-attach-mount[data-kind="notes"] input[type="file"]')
    .setInputFiles({ name: 'crash.log', mimeType: 'text/plain', buffer: Buffer.from('boom') });

  // La chip del file appare e una patch delle note parte subito (auto-persist).
  await expect(card.locator('.fb-attach-mount[data-kind="notes"] .fb-attach-chip')).toHaveCount(1);

  const upd = await page.waitForFunction(
    () => (window.__updates || []).find((m) => m.id === 'mock-att-todo' && /@@filo-attachment/.test(m.notes || '')),
    null, { timeout: 5_000 },
  ).then((h) => h.jsonValue());

  expect(upd.notes).toContain('Riprodotto, allego il log.');
  expect(upd.notes).toContain('crash.log');
  expect(upd.notes).toMatch(/@@filo-attachment .*"kind":"file"/);
});
