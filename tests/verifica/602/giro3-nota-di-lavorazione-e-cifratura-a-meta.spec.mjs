// Verifica #602, giro 3 — le porte vicine a quelle già chiuse.
//
// La richiesta: gli allegati dei commenti salgono CIFRATI e chi li riceve li
// riapre uguali; se la cifratura non si può fare non parte niente e chi scrive
// lo legge.
//
// I giri 1 e 2 hanno provato il riquadro della risposta, quello della nota di
// lavorazione e quello della riapertura: l'anteprima, il pacchetto cifrato nel
// deposito, il ritorno del file identico, la cifratura tolta prima di allegare.
// Qui si va sulle strade che restavano:
//
//  · la nota di lavorazione SALVA da sola a ogni cambio. Allegare è metà del
//    lavoro: l'altra metà è togliere. Se la × toglie la miniatura ma quello che
//    si salva porta ancora l'allegato, l'invariante «si può aggiungere, si può
//    togliere» è rotta e l'allegato torna alla riapertura della scheda;
//  · la cifratura che si rompe A METÀ di una fila: il primo allegato è già
//    salito cifrato, il secondo non deve uscire, e quello di prima non deve
//    sparire;
//  · il deposito che RIFIUTA (403): non è la cifratura, quindi la frase è
//    un'altra, e dopo il rifiuto si deve poter riprovare;
//  · la frase che dice «non è partito niente» si legge per intero, nei due
//    temi: è l'unica cosa che chi scrive ha in mano.

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
// casa: il caricamento è quello VERO (deve cifrare) e la rilettura fa quello
// che fa il main (scarica dal deposito e decifra con la chiave privata).
// `window.__rifiutaDeposito` fa rispondere 403 al deposito, come le sue regole.
async function preparaScheda(app, page, feedback, { pub, priv }) {
  await expect(page.locator('#adminBanner')).toBeVisible({ timeout: 10_000 });

  await page.evaluate(({ fb, pubKey, privKey }) => {
    window.SN_FEEDBACK.list = async () => [fb];
    window.SN_FEEDBACK_PUBKEY = pubKey;

    window.__deposito = new Map();
    window.__aggiornamenti = [];
    window.__rifiutaDeposito = false;
    const fetchVero = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('uploadType=media')) {
        if (window.__rifiutaDeposito) {
          return new Response('Permission denied.', { status: 403 });
        }
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

function schedaInLavorazione(id, extra = {}) {
  return {
    _id: id,
    status: 'todo',
    text: 'il pulsante non risponde',
    url: 'https://example.com',
    clientId: 'tester-123',
    notes: 'Sto guardando.',
    createdAt: new Date().toISOString(),
    ...extra,
  };
}

test('nella nota di lavorazione un allegato si aggiunge E si toglie, e il salvataggio segue', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  const chiavi = await coppiaDiProva();

  await preparaScheda(app, page, schedaInLavorazione('verifica-602-g3-nota'), chiavi);

  const card = page.locator('.fb-card');
  const mount = card.locator('.fb-attach-mount[data-kind="notes"]');
  await expect(mount).toBeVisible({ timeout: 10_000 });

  await mount.locator('input[type="file"]')
    .setInputFiles({ name: 'schermata.png', mimeType: 'image/png', buffer: PNG_1x1 });

  const thumb = mount.locator('.fb-attach-thumb img');
  await expect(thumb).toHaveCount(1);
  await expect
    .poll(() => thumb.evaluate((el) => el.naturalWidth), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // Nel deposito è salito un pacchetto cifrato, e la nota salvata lo nomina.
  const cifrato = await page.evaluate(() => {
    const byte = [...window.__deposito.values()][0] || [];
    return byte.length > 78 && byte[0] === 1;
  });
  expect(cifrato, "l'allegato della nota deve salire cifrato").toBe(true);

  await expect.poll(async () => page.evaluate(() => window.__aggiornamenti
    .filter((m) => /@@filo-attachment/.test(String(m?.notes || ''))).length),
  { timeout: 10_000 }).toBeGreaterThan(0);

  // Ora lo tolgo. La × deve arrivare fino al salvataggio: se l'ultima nota
  // salvata porta ancora l'allegato, riaprendo la scheda quell'allegato torna.
  await mount.locator('.fb-attach-thumb .fb-attach-x').click();
  await expect(mount.locator('.fb-attach-thumb')).toHaveCount(0);

  await expect.poll(async () => page.evaluate(() => {
    const ultimo = window.__aggiornamenti[window.__aggiornamenti.length - 1];
    return /@@filo-attachment/.test(String(ultimo?.notes ?? 'ancora-attaccato'));
  }), { timeout: 10_000 })
    .toBe(false);
});

test('la cifratura che si rompe a metà fila: il primo resta, il secondo non esce', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  const chiavi = await coppiaDiProva();

  await preparaScheda(app, page, schedaInLavorazione('verifica-602-g3-meta', {
    status: 'clarify',
    notes: 'Puoi mandarmi gli screenshot?',
  }), chiavi);

  await page.locator('[data-tab="inbox"]').click();
  const card = page.locator('.fb-card');
  const mount = card.locator('.fb-attach-mount[data-kind="reply"]');
  await expect(mount).toBeVisible({ timeout: 10_000 });

  await mount.locator('input[type="file"]')
    .setInputFiles({ name: 'prima.png', mimeType: 'image/png', buffer: PNG_1x1 });
  await expect(mount.locator('.fb-attach-thumb')).toHaveCount(1);

  // A metà lavoro la copia di Filo si rompe: la chiave con cui cifra non c'è più.
  await page.evaluate(() => { window.SN_FEEDBACK_PUBKEY = null; });

  await mount.locator('input[type="file"]')
    .setInputFiles({ name: 'seconda.png', mimeType: 'image/png', buffer: PNG_1x1 });

  const stato = mount.locator('.fb-attach-status');
  await expect(stato).toContainText(/non ho mandato niente/i, { timeout: 10_000 });

  // Nel deposito è entrato SOLO il primo, cifrato.
  const dep = await page.evaluate(() => [...window.__deposito.values()].map((b) => ({ n: b.length, primo: b[0] })));
  expect(dep.length, 'il secondo allegato non deve uscire').toBe(1);
  expect(dep[0].primo).toBe(1);
  expect(dep[0].n).toBeGreaterThan(78);

  // E il primo allegato non è sparito: resta attaccato, con la sua anteprima.
  await expect(mount.locator('.fb-attach-thumb')).toHaveCount(1);
  await expect
    .poll(() => mount.locator('.fb-attach-thumb img').evaluate((el) => el.naturalWidth), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // Rimessa la chiave, si riparte: il pulsante non è rimasto spento.
  await page.evaluate((pub) => { window.SN_FEEDBACK_PUBKEY = pub; }, chiavi.pub);
  await expect(mount.locator('.fb-attach-btn')).toBeEnabled();
  await mount.locator('input[type="file"]')
    .setInputFiles({ name: 'terza.png', mimeType: 'image/png', buffer: PNG_1x1 });
  await expect(mount.locator('.fb-attach-thumb')).toHaveCount(2, { timeout: 10_000 });
  expect(await page.evaluate(() => window.__deposito.size)).toBe(2);
});

test('il deposito che rifiuta non si confonde con la cifratura, e si può riprovare', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  const chiavi = await coppiaDiProva();

  await preparaScheda(app, page, schedaInLavorazione('verifica-602-g3-403', {
    status: 'clarify',
    notes: 'Puoi mandarmi uno screenshot?',
  }), chiavi);

  await page.locator('[data-tab="inbox"]').click();
  const card = page.locator('.fb-card');
  const mount = card.locator('.fb-attach-mount[data-kind="reply"]');
  await expect(mount).toBeVisible({ timeout: 10_000 });

  await page.evaluate(() => { window.__rifiutaDeposito = true; });
  await mount.locator('input[type="file"]')
    .setInputFiles({ name: 'schermata.png', mimeType: 'image/png', buffer: PNG_1x1 });

  const stato = mount.locator('.fb-attach-status');
  await expect(stato).toContainText(/caricamento non riuscito/i, { timeout: 10_000 });
  // Non è la cifratura: non deve dire che il contenuto era in chiaro.
  await expect(stato).not.toContainText(/lo può leggere chiunque/i);
  await expect(mount.locator('.fb-attach-thumb')).toHaveCount(0);

  // Tornato il deposito, si riprova senza ricaricare la pagina.
  await page.evaluate(() => { window.__rifiutaDeposito = false; });
  await expect(mount.locator('.fb-attach-btn')).toBeEnabled();
  await mount.locator('input[type="file"]')
    .setInputFiles({ name: 'schermata.png', mimeType: 'image/png', buffer: PNG_1x1 });
  await expect(mount.locator('.fb-attach-thumb')).toHaveCount(1, { timeout: 10_000 });
});

test('la frase «non è partito niente» si legge per intero, sul chiaro e sullo scuro', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  const chiavi = await coppiaDiProva();

  await preparaScheda(app, page, schedaInLavorazione('verifica-602-g3-frase', {
    status: 'clarify',
    notes: 'Puoi mandarmi uno screenshot?',
  }), chiavi);

  await page.evaluate(() => { window.SN_FEEDBACK_PUBKEY = null; });
  await page.locator('[data-tab="inbox"]').click();
  const card = page.locator('.fb-card');
  const mount = card.locator('.fb-attach-mount[data-kind="reply"]');
  await mount.locator('input[type="file"]')
    .setInputFiles({ name: 'schermata.png', mimeType: 'image/png', buffer: PNG_1x1 });

  const stato = mount.locator('.fb-attach-status');
  await expect(stato).toContainText(/non ho mandato niente/i, { timeout: 10_000 });

  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, tema);
    // Niente taglio: quello che si legge è tutta la frase, non un pezzo.
    const misura = await stato.evaluate((el) => ({
      testo: el.textContent || '',
      tagliato: el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
    }));
    expect(misura.testo).toMatch(/lo può leggere chiunque/i);
    expect(misura.tagliato, `la frase non deve essere tagliata (tema ${tema})`).toBe(false);
    await page.screenshot({ path: `tests/.shots/602-giro3-frase-${tema}.png` });
  }
});
