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
    // Il caricamento VERO, messo da parte: la prova della cifratura (#602) lo
    // rimette al suo posto, perche' quello che deve guardare e' proprio cosa
    // finisce nel deposito.
    window.__caricamentoVero = window.SN_FEEDBACK.uploadAttachment;
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

// ── Il tipo si guarda PRIMA di caricare (#582, giro 7) ──────────────────────
//
// Il riquadro con cui si manda una segnalazione rifiuta subito un .html o un
// .svg, con parole che dicono cosa si può allegare. Il compositore delle
// risposte quel controllo non ce l'aveva: guardava solo quanti file e quanto
// pesano, e il selettore che apre offre anche `image/*` e `text/*`, cioè anche
// una pagina web e un disegno vettoriale. Il file partiva, il deposito lo
// respingeva, e quello che si leggeva era il numero dell'errore del deposito.
// Il confine reggeva; a non andare era ciò che si leggeva.
test('nel compositore di una risposta un .svg e un .html sono rifiutati prima di partire', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  await setupAdmin(app, page, {
    _id: 'mock-att-tipi',
    status: 'clarify',
    text: 'il pulsante non risponde',
    url: 'https://example.com',
    clientId: 'tester-123',
    notes: 'Puoi mandarmi uno screenshot del problema?',
    createdAt: new Date().toISOString(),
  });

  // Conta i caricamenti: un tipo rifiutato non deve nemmeno partire.
  await page.evaluate(() => {
    window.__caricati = [];
    const orig = window.SN_FEEDBACK.uploadAttachment;
    window.SN_FEEDBACK.uploadAttachment = async (blob, name) => {
      window.__caricati.push(String(name || ''));
      return orig(blob, name);
    };
  });

  await page.locator('[data-tab="inbox"]').click();
  const card = page.locator('.fb-card');
  const mount = card.locator('.fb-attach-mount[data-kind="reply"]');
  await expect(card.locator('.fb-reply-text')).toBeVisible();

  for (const file of [
    { name: 'disegno.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>') },
    { name: 'pagina.html', mimeType: 'text/html', buffer: Buffer.from('<h1>ciao</h1>') },
  ]) {
    await mount.locator('input[type="file"]').setInputFiles(file);
    // Si legge cosa si può allegare, non il numero di un errore del deposito.
    await expect(mount.locator('.fb-attach-status')).toContainText('non supportato');
    await expect(mount.locator('.fb-attach-status')).not.toContainText('Caricamento non riuscito');
    // E niente allegato nel compositore.
    await expect(mount.locator('.fb-attach-thumb, .fb-attach-chip')).toHaveCount(0);
  }
  expect(await page.evaluate(() => window.__caricati)).toEqual([]);

  // Controprova: i tipi ammessi passano ancora, compreso un .yaml, che lo
  // strumento a riga di comando manda già e che il deposito accetta.
  await mount.locator('input[type="file"]')
    .setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('ciao') });
  await expect(mount.locator('.fb-attach-chip')).toHaveCount(1);
  await mount.locator('input[type="file"]')
    .setInputFiles({ name: 'conf.yaml', mimeType: 'application/x-yaml', buffer: Buffer.from('a: 1') });
  await expect(mount.locator('.fb-attach-chip')).toHaveCount(2);
  expect(await page.evaluate(() => window.__caricati)).toEqual(['note.txt', 'conf.yaml']);
});

// ── #602 — l'allegato di un COMMENTO sale CIFRATO, e la dashboard lo riapre ──
//
// Il buco: gli allegati aggiunti ai commenti non passavano dalla cifratura e
// finivano nel deposito com'erano. È il caso peggiore, perché è lì che si
// allegano le schermate e i log del lavoro, e il deposito si apre col codice di
// scarico che sta nel collegamento — un collegamento che gira.
//
// La causa vera era in questa pagina: è l'unica che carica da sola nel deposito
// (il resto passa dal main), e il modulo di cifratura qui non era caricato
// affatto. Il ripiego «non riesco a cifrare, carico lo stesso» scattava quindi
// SEMPRE, in silenzio.
//
// Questa prova percorre il giro intero, sulla pagina vera e col caricamento
// vero: si allega una schermata a una risposta, si guarda cosa esce verso il
// deposito (deve essere un ciphertext, e non deve contenere i byte
// dell'immagine), e poi si rilegge come la rilegge la dashboard — scaricando e
// decifrando con la chiave privata — fino a rivedere l'immagine originale nella
// bolla del turno.
//
// Senza il fix è ROSSA: quello che parte verso il deposito è il PNG com'è.
test('#602 — un allegato di commento sale cifrato e la dashboard lo riapre', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  // Coppia di prova: la pubblica entra nella pagina al posto di quella vera, la
  // privata resta qui e fa il mestiere che nell'app fa la chiave dell'owner.
  const { webcrypto } = await import('node:crypto');
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = Buffer.from(new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey)))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const priv = Buffer.from(new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)))
    .toString('base64');

  await setupAdmin(app, page, {
    _id: 'mock-att-cifrato',
    status: 'clarify',
    text: 'il pulsante non risponde',
    url: 'https://example.com',
    clientId: 'tester-123',
    notes: 'Puoi mandarmi uno screenshot del problema?',
    createdAt: new Date().toISOString(),
  }, /* captureUpdates */ true);

  // Deposito finto e chiave privata dell'owner finta, dentro la pagina.
  await page.evaluate(({ pubKey, privKey }) => {
    window.SN_FEEDBACK_PUBKEY = pubKey;
    // Il caricamento vero: è lui che deve cifrare.
    window.SN_FEEDBACK.uploadAttachment = window.__caricamentoVero;

    // Il deposito: registra i byte che riceve, come li riceve.
    window.__deposito = new Map();
    const fetchVero = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('uploadType=media')) {
        // La chiave e' il NOME dell'oggetto: l'indirizzo completo lo compone
        // l'app col nome vero del deposito, e qui non lo si indovina.
        const nome = decodeURIComponent((/[?&]name=([^&]+)/.exec(u) || [])[1] || 'x');
        const byte = new Uint8Array(await new Response(opts.body).arrayBuffer());
        window.__deposito.set(nome, Array.from(byte));
        return new Response(JSON.stringify({ downloadTokens: 't' }), { status: 200 });
      }
      return fetchVero(url, opts);
    };

    // Il main visto dalla pagina: davanti a un allegato fa quello che fa il
    // vero — scarica dal deposito e decifra con la chiave privata di chi riceve
    // le segnalazioni. Se i byte non fossero cifrati, qui si vedrebbe.
    const messaggioVero = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_decrypt_image') {
        const nome = decodeURIComponent(String(msg.url || '').split('/o/')[1]?.split('?')[0] || '');
        const byte = window.__deposito.get(nome);
        if (!byte) return { ok: false, error: 'non nel deposito' };
        const pacchetto = new Uint8Array(byte);
        if (!window.SN_FEEDBACK_CRYPTO.isEncryptedBytes(pacchetto)) {
          return { ok: false, error: 'allegato NON cifrato nel deposito' };
        }
        const chiaro = await window.SN_FEEDBACK_CRYPTO.decryptBytes(pacchetto, privKey);
        let bin = '';
        for (let i = 0; i < chiaro.length; i++) bin += String.fromCharCode(chiaro[i]);
        return { ok: true, dataUrl: 'data:image/png;base64,' + btoa(bin) };
      }
      return messaggioVero(msg);
    };
  }, { pubKey: pub, privKey: priv });

  await page.locator('[data-tab="inbox"]').click();
  const card = page.locator('.fb-card');
  await expect(card.locator('.fb-reply-text')).toBeVisible();
  await card.locator('.fb-reply-text').fill('Ecco la schermata.');

  await card.locator('.fb-attach-mount[data-kind="reply"] input[type="file"]')
    .setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: PNG_1x1 });
  const miniatura = card.locator('.fb-attach-mount[data-kind="reply"] .fb-attach-thumb img');
  await expect(miniatura).toHaveCount(1);

  // ⓪ L'anteprima MOSTRA la schermata appena allegata (verifica #602, giro 1).
  // Nel deposito ci sono byte cifrati: il suo indirizzo dentro un <img> è un
  // riquadro rotto, e l'anteprima è l'unico modo di controllare di aver
  // allegato il file giusto prima di mandarlo. Si guarda com'è dal punto di
  // vista di chi la guarda: l'immagine si carica davvero.
  await expect(miniatura).not.toHaveAttribute('src', /firebasestorage/);
  await expect
    .poll(() => miniatura.evaluate((el) => el.naturalWidth), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // E l'ingrandimento apre quella stessa immagine, non un riquadro vuoto.
  await miniatura.click();
  const ingrandimento = page.locator('#lightboxImg');
  await expect(page.locator('#lightbox')).toHaveClass(/open/);
  await expect
    .poll(() => ingrandimento.evaluate((el) => el.naturalWidth), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await page.keyboard.press('Escape');

  // ① Quello che è arrivato nel deposito è un ciphertext, e l'immagine non c'è.
  const depositato = await page.evaluate(() => {
    const [nome, byte] = [...window.__deposito.entries()][0] || [];
    return { nome, byte };
  });
  expect(depositato.byte, 'un allegato deve essere arrivato al deposito').toBeTruthy();
  const saliti = Buffer.from(depositato.byte);
  expect(saliti[0], 'primo byte = versione del formato cifrato').toBe(1);
  expect(saliti.length).toBeGreaterThan(1 + 65 + 12);
  expect(saliti.slice(0, 8).toString('hex'), 'nel deposito non deve esserci un PNG')
    .not.toBe(PNG_1x1.slice(0, 8).toString('hex'));
  expect(saliti.includes(PNG_1x1), "i byte dell'immagine non devono comparire in chiaro").toBe(false);

  // ② Con la chiave privata tornano ESATTAMENTE i byte dell'originale.
  const chiaviDecifra = await webcrypto.subtle.importKey(
    'pkcs8', Buffer.from(priv, 'base64'), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const eph = await webcrypto.subtle.importKey(
    'raw', saliti.slice(1, 66), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = await webcrypto.subtle.deriveBits({ name: 'ECDH', public: eph }, chiaviDecifra, 256);
  const base = await webcrypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const aes = await webcrypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new Uint8Array(saliti.slice(1, 66)) },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const chiaro = Buffer.from(await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(saliti.slice(66, 78)) }, aes, saliti.slice(78)));
  expect(chiaro.equals(PNG_1x1), "decifrato deve tornare l'originale").toBe(true);

  // ③ E la dashboard lo riapre: manda la risposta, ricarica la scheda com'è
  // salvata e l'immagine del turno si vede — decifrata, non un segnaposto rotto.
  await card.locator('.fb-reply-send').click();
  const upd = await page.waitForFunction(
    () => (window.__updates || []).find((m) => m.id === 'mock-att-cifrato'),
    null, { timeout: 5_000 },
  ).then((h) => h.jsonValue());
  expect(upd.notes).toContain('@@filo-attachment');
  expect(upd.notes).toContain(encodeURIComponent(depositato.nome));

  await page.evaluate((note) => {
    window.SN_FEEDBACK.list = async () => [{
      _id: 'mock-att-cifrato',
      status: 'todo',
      text: 'il pulsante non risponde',
      url: 'https://example.com',
      clientId: 'tester-123',
      notes: note,
      createdAt: new Date().toISOString(),
    }];
  }, upd.notes);
  await page.locator('#refresh').click();
  await page.locator('[data-tab="queue"]').click();

  const img = page.locator('.fb-card .fb-imgs img').first();
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute('src', `data:image/png;base64,${PNG_1x1.toString('base64')}`);
});

// ── Verifica #602, giro 1 — gli allegati già salvati in una nota ────────────
//
// Riaprendo una scheda commentata, il compositore della nota rimette gli
// allegati che porta già: sono nel deposito, cifrati. Se li mostrasse dal loro
// indirizzo sarebbero riquadri rotti ogni volta, anche giorni dopo. Qui si
// chiede che si vedano, come si vedono nella conversazione lì sotto.
test("#602 — un allegato già salvato in una nota si rivede in anteprima", async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);

  const urlAllegato = 'https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/feedback%2F1780000000000_11111111-2222-3333-4444-555555555555.octetstream?alt=media&token=t';
  const marcatore = `@@filo-attachment ${JSON.stringify({ kind: 'img', url: urlAllegato, name: 'screen.png', type: 'image/png' })}`;

  await setupAdmin(app, page, {
    _id: 'mock-att-nota',
    status: 'todo',
    text: 'il pulsante non risponde',
    url: 'https://example.com',
    clientId: 'tester-123',
    notes: ['Ecco cosa ho visto.', marcatore].join('\n'),
    createdAt: new Date().toISOString(),
  });

  await page.locator('[data-tab="queue"]').click();
  const mount = page.locator('.fb-card .fb-attach-mount[data-kind="notes"]').first();
  await expect(mount).toBeAttached({ timeout: 10_000 });

  const miniatura = mount.locator('.fb-attach-thumb img').first();
  await expect(miniatura).toHaveCount(1, { timeout: 10_000 });
  await expect(miniatura).toHaveAttribute('src', /^data:image\//, { timeout: 10_000 });
  await expect
    .poll(() => miniatura.evaluate((el) => el.naturalWidth), { timeout: 10_000 })
    .toBeGreaterThan(0);
});
