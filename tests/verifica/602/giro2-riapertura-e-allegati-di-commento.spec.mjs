// Verifica #602, giro 2 — le porte del giro 1, ri-provate, e quelle vicine.
//
// La richiesta: gli allegati dei commenti salgono CIFRATI, e chi li riceve li
// riapre uguali all'originale; se la cifratura non si può fare non parte
// niente e chi scrive lo legge.
//
// Il giro 1 aveva trovato l'anteprima rotta in TRE riquadri (risposta, nota di
// lavorazione, riapertura) e ne aveva chiusi due con le sue prove. Qui si
// prova il terzo — la riapertura — e si guarda cosa arriva davvero nel
// deposito da quella strada.
//
// Poi il viaggio intero di un allegato che NON è un'immagine (un log): dal
// riquadro di risposta al deposito cifrato, e ritorno — il file che arriva a
// chi riceve le segnalazioni, cliccando la pillola, deve essere byte per byte
// quello allegato.
//
// Infine: con la cifratura indisponibile, allegare a un commento non deve far
// uscire NIENTE verso il deposito, e chi sta scrivendo deve leggerlo.

import { test, expect } from '../../fixtures/electron.mjs';
import { webcrypto } from 'node:crypto';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function coppiaDiProva() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = Buffer.from(new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey)))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const priv = Buffer.from(new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)))
    .toString('base64');
  return { pub, priv };
}

// La pagina delle segnalazioni vista da chi le riceve, col deposito finto in
// casa: il caricamento è quello VERO (deve cifrare), la rilettura fa quello che
// fa il main (scarica dal deposito e decifra con la chiave privata).
async function preparaScheda(app, page, feedback, { pub, priv }) {
  await expect(page.locator('#adminBanner')).toBeVisible({ timeout: 10_000 });

  await page.evaluate(({ fb, pubKey, privKey }) => {
    window.SN_FEEDBACK.list = async () => [fb];
    window.SN_FEEDBACK_PUBKEY = pubKey;

    window.__deposito = new Map();
    window.__aggiornamenti = [];
    const fetchVero = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('uploadType=media')) {
        const nome = decodeURIComponent((/[?&]name=([^&]+)/.exec(u) || [])[1] || 'x');
        const byte = new Uint8Array(await new Response(opts.body).arrayBuffer());
        window.__deposito.set(nome, Array.from(byte));
        return new Response(JSON.stringify({ downloadTokens: 't' }), { status: 200 });
      }
      return fetchVero(url, opts);
    };

    const messaggioVero = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') {
        window.__aggiornamenti.push(msg);
        return { ok: true };
      }
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'owner@example.com' } };
      }
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
        const tipo = String(msg.mime || 'image/png');
        return { ok: true, dataUrl: `data:${tipo};base64,` + btoa(bin) };
      }
      return messaggioVero(msg);
    };
  }, { fb: feedback, pubKey: pub, privKey: priv });

  await page.waitForFunction(() => {
    const e = document.querySelector('.fb-empty');
    return !e || !/Caricamento/.test(e.textContent || '');
  }, null, { timeout: 12_000 });

  await app.evaluate(async ({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
      if (url.includes('feedback')) {
        wc.send('filo:broadcast', {
          type: 'auth_changed', signedIn: true, isAdmin: true,
          profile: { email: 'owner@example.com' },
        });
      }
    }
  });

  await page.locator('#refresh').click();
}

test('riaprendo una segnalazione, la schermata allegata si vede in anteprima e sale cifrata', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  const chiavi = await coppiaDiProva();

  await preparaScheda(app, page, {
    _id: 'verifica-602-riapertura',
    status: 'done',
    text: 'il pulsante non risponde',
    url: 'https://example.com',
    clientId: 'tester-123',
    notes: 'Risolto nella versione di ieri.',
    createdAt: new Date().toISOString(),
  }, chiavi);

  await page.locator('[data-tab="resolved"]').click();
  const card = page.locator('.fb-card');
  await card.locator('.fb-reopen-start').click();

  const mount = card.locator('.fb-attach-mount[data-kind="reopen"]');
  await expect(mount).toBeVisible();
  await mount.locator('input[type="file"]')
    .setInputFiles({ name: 'schermata.png', mimeType: 'image/png', buffer: PNG_1x1 });

  const thumb = mount.locator('.fb-attach-thumb img');
  await expect(thumb).toHaveCount(1);

  // Nel deposito sono arrivati byte cifrati, non la schermata.
  const cifrato = await page.evaluate(() => {
    const byte = [...window.__deposito.values()][0] || [];
    return byte.length > 78 && byte[0] === 1;
  });
  expect(cifrato, "anche dalla riapertura l'allegato deve salire cifrato").toBe(true);

  // E chi sta scrivendo la vede: non l'indirizzo del deposito, e un'immagine
  // che si carica davvero.
  await expect(thumb).not.toHaveAttribute('src', /firebasestorage/);
  await expect
    .poll(() => thumb.evaluate((el) => el.naturalWidth), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // Un clic la ingrandisce, e anche lì si vede.
  await thumb.click();
  await expect(page.locator('#lightbox')).toHaveClass(/open/, { timeout: 5_000 });
  await expect
    .poll(() => page.locator('#lightboxImg').evaluate((el) => el.naturalWidth), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await page.locator('#lightbox').click();

  // Confermando, la riapertura porta con sé l'allegato appena caricato.
  await card.locator('.fb-reopen-text').fill('Succede ancora, ecco la schermata.');
  await card.locator('.fb-reopen-confirm').click();
  await expect.poll(async () => {
    const ag = await page.evaluate(() => window.__aggiornamenti.slice());
    return ag.some((m) => /@@filo-attachment/.test(String(m?.payload?.notes || '')));
  }, { timeout: 10_000 }).toBe(true);
});

test('un log allegato a una risposta torna a chi lo riceve identico a com’era', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  const chiavi = await coppiaDiProva();

  const contenuto = 'riga 1: errore\nriga 2: stack\nriga 3: ▲ caratteri speciali é ü 😀\n';

  await preparaScheda(app, page, {
    _id: 'verifica-602-log',
    status: 'clarify',
    text: 'il pulsante non risponde',
    url: 'https://example.com',
    clientId: 'tester-123',
    notes: 'Puoi mandarmi il log?',
    createdAt: new Date().toISOString(),
  }, chiavi);

  await page.locator('[data-tab="inbox"]').click();
  const card = page.locator('.fb-card');
  await expect(card.locator('.fb-reply-text')).toBeVisible();

  const mount = card.locator('.fb-attach-mount[data-kind="reply"]');
  await mount.locator('input[type="file"]').setInputFiles({
    name: 'filo.log',
    mimeType: 'text/plain',
    buffer: Buffer.from(contenuto, 'utf8'),
  });
  await expect(mount.locator('.fb-attach-chip')).toHaveCount(1);

  // Nel deposito c'è un pacchetto cifrato, e le parole del log non ci sono.
  const esito = await page.evaluate(() => {
    const byte = [...window.__deposito.values()][0] || [];
    let testo = '';
    for (const b of byte) testo += String.fromCharCode(b);
    return { cifrato: byte.length > 78 && byte[0] === 1, inChiaro: /riga 1: errore/.test(testo) };
  });
  expect(esito.cifrato, 'il log deve salire cifrato').toBe(true);
  expect(esito.inChiaro, 'nel deposito non deve comparire il testo del log').toBe(false);

  // Si manda la risposta: l'allegato resta ancorato al turno.
  await card.locator('.fb-reply-text').fill('Ecco il log.');
  await card.locator('.fb-reply-send').click();

  const note = await page.evaluate(async () => {
    const ag = window.__aggiornamenti.slice();
    const con = ag.reverse().find((m) => /@@filo-attachment/.test(String(m?.payload?.notes || '')));
    return con ? String(con.payload.notes) : '';
  });
  expect(note, 'la risposta deve portarsi dietro il log').toMatch(/@@filo-attachment/);

  // Ora la scheda come la ritrova chi riceve le segnalazioni: la pillola del
  // log, cliccata, deve consegnare il file com'era.
  await page.evaluate((notes) => {
    window.SN_FEEDBACK.list = async () => [{
      _id: 'verifica-602-log',
      status: 'todo',
      text: 'il pulsante non risponde',
      url: 'https://example.com',
      clientId: 'tester-123',
      notes,
      createdAt: new Date().toISOString(),
    }];
    window.__scaricati = [];
    const clickVero = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute('download')) {
        window.__scaricati.push({ nome: this.download, href: this.href });
        return; // niente scarico vero durante la prova
      }
      return clickVero.apply(this, arguments);
    };
  }, note);

  await page.locator('#refresh').click();
  await page.locator('[data-tab="queue"]').click();
  const pillola = page.locator('a.fb-file').first();
  await expect(pillola).toBeVisible({ timeout: 10_000 });
  await expect(pillola).toContainText('filo.log');
  await pillola.click();

  const arrivato = await expect.poll(async () => page.evaluate(() => {
    const d = (window.__scaricati || [])[0];
    if (!d) return null;
    const b64 = String(d.href).split(',')[1] || '';
    const bin = atob(b64);
    const byte = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) byte[i] = bin.charCodeAt(i);
    return { nome: d.nome, testo: new TextDecoder().decode(byte) };
  }), { timeout: 10_000 }).not.toBeNull();
  void arrivato;

  const dati = await page.evaluate(() => {
    const d = (window.__scaricati || [])[0];
    const b64 = String(d.href).split(',')[1] || '';
    const bin = atob(b64);
    const byte = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) byte[i] = bin.charCodeAt(i);
    return { nome: d.nome, testo: new TextDecoder().decode(byte) };
  });
  expect(dati.nome).toBe('filo.log');
  expect(dati.testo, 'il log deve tornare identico a come è stato allegato').toBe(contenuto);
});

test('senza cifratura, allegare a un commento non manda niente e lo si legge', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  const chiavi = await coppiaDiProva();

  await preparaScheda(app, page, {
    _id: 'verifica-602-senza-chiave',
    status: 'clarify',
    text: 'il pulsante non risponde',
    url: 'https://example.com',
    clientId: 'tester-123',
    notes: 'Puoi mandarmi uno screenshot?',
    createdAt: new Date().toISOString(),
  }, chiavi);

  // La copia di Filo «messa male»: la chiave con cui si cifra non c'è più.
  await page.evaluate(() => { window.SN_FEEDBACK_PUBKEY = null; });

  await page.locator('[data-tab="inbox"]').click();
  const card = page.locator('.fb-card');
  const mount = card.locator('.fb-attach-mount[data-kind="reply"]');
  await mount.locator('input[type="file"]')
    .setInputFiles({ name: 'schermata.png', mimeType: 'image/png', buffer: PNG_1x1 });

  // Si legge che non è partito niente, e perché.
  const stato = mount.locator('.fb-attach-status');
  await expect(stato).toContainText(/non ho mandato niente/i, { timeout: 10_000 });
  await expect(stato).toContainText(/chiave|cifrat/i);

  // E nel deposito non è entrato un byte.
  const quanti = await page.evaluate(() => window.__deposito.size);
  expect(quanti, 'senza cifratura nel deposito non deve entrare niente').toBe(0);
  await expect(mount.locator('.fb-attach-thumb')).toHaveCount(0);
});

test('più allegati di fila: ognuno resta la sua anteprima, e toglierne uno non spegne gli altri', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  const chiavi = await coppiaDiProva();

  await preparaScheda(app, page, {
    _id: 'verifica-602-molti',
    status: 'clarify',
    text: 'il pulsante non risponde',
    url: 'https://example.com',
    clientId: 'tester-123',
    notes: 'Puoi mandarmi gli screenshot?',
    createdAt: new Date().toISOString(),
  }, chiavi);

  await page.locator('[data-tab="inbox"]').click();
  const card = page.locator('.fb-card');
  const mount = card.locator('.fb-attach-mount[data-kind="reply"]');

  // Tre schermate in un colpo solo (come una selezione multipla).
  await mount.locator('input[type="file"]').setInputFiles([
    { name: 'uno.png', mimeType: 'image/png', buffer: PNG_1x1 },
    { name: 'due.png', mimeType: 'image/png', buffer: PNG_1x1 },
    { name: 'tre.png', mimeType: 'image/png', buffer: PNG_1x1 },
  ]);
  await expect(mount.locator('.fb-attach-thumb')).toHaveCount(3, { timeout: 15_000 });
  await expect
    .poll(() => mount.locator('.fb-attach-thumb img')
      .evaluateAll((els) => els.filter((e) => e.naturalWidth > 0).length), { timeout: 10_000 })
    .toBe(3);

  // Tre pacchetti distinti nel deposito, tutti cifrati.
  const dep = await page.evaluate(() => [...window.__deposito.values()]
    .map((b) => ({ n: b.length, primo: b[0] })));
  expect(dep.length).toBe(3);
  expect(dep.every((d) => d.primo === 1 && d.n > 78)).toBe(true);

  // Tolgo quella di mezzo: le altre due restano visibili (non è la × a
  // spegnere l'anteprima della vicina).
  await mount.locator('.fb-attach-thumb .fb-attach-x').nth(1).click();
  await expect(mount.locator('.fb-attach-thumb')).toHaveCount(2);
  await expect
    .poll(() => mount.locator('.fb-attach-thumb img')
      .evaluateAll((els) => els.filter((e) => e.naturalWidth > 0).length), { timeout: 10_000 })
    .toBe(2);
});
