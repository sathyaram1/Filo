// Verifica #602, giro 1 — l'anteprima dell'allegato di un commento.
//
// La richiesta: gli allegati dei commenti devono salire CIFRATI e la scheda
// deve riaprirli decifrandoli, «come già fa per le immagini cifrate del
// feedback». La seconda metà vale anche PRIMA di mandare il commento: appena
// si allega una schermata, il compositore ne mostra l'anteprima, e cliccandola
// la si ingrandisce. Quell'anteprima è l'unico modo che ha chi scrive di
// controllare di aver allegato il file giusto prima di spedirlo.
//
// Qui si allega una schermata a una risposta, col caricamento VERO e un
// deposito finto, e si guarda l'anteprima dal punto di vista di chi la guarda:
// deve MOSTRARE la schermata appena allegata.
//
// Stesso giro per gli allegati già salvati in una nota: riaprendo la scheda, il
// compositore delle note li rimette come anteprime.

import { test, expect } from '../../fixtures/electron.mjs';
import { webcrypto } from 'node:crypto';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const PNG_1x1_B64 = PNG_1x1.toString('base64');

async function coppiaDiProva() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = Buffer.from(new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey)))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const priv = Buffer.from(new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)))
    .toString('base64');
  return { pub, priv };
}

// La pagina dei feedback vista da chi riceve le segnalazioni, col deposito
// finto in casa: il caricamento è quello vero (deve cifrare), la rilettura fa
// quello che fa il main (scarica e decifra con la chiave privata).
async function preparaScheda(app, page, feedback, { pub, priv }) {
  await expect(page.locator('#adminBanner')).toBeVisible({ timeout: 10_000 });

  await page.evaluate(({ fb, pubKey, privKey }) => {
    window.SN_FEEDBACK.list = async () => [fb];
    window.SN_FEEDBACK_PUBKEY = pubKey;

    window.__deposito = new Map();
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
      if (msg && msg.type === 'feedback_update') return { ok: true };
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'owner@example.com' } };
      }
      // Il main davanti a un allegato: scarica dal deposito e decifra.
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

test("l'anteprima di un allegato appena aggiunto a un commento mostra la schermata", async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  const chiavi = await coppiaDiProva();

  await preparaScheda(app, page, {
    _id: 'verifica-602-anteprima',
    status: 'clarify',
    text: 'il pulsante non risponde',
    url: 'https://example.com',
    clientId: 'tester-123',
    notes: 'Puoi mandarmi uno screenshot del problema?',
    createdAt: new Date().toISOString(),
  }, chiavi);

  await page.locator('[data-tab="inbox"]').click();
  const card = page.locator('.fb-card');
  await expect(card.locator('.fb-reply-text')).toBeVisible();

  const mount = card.locator('.fb-attach-mount[data-kind="reply"]');
  await mount.locator('input[type="file"]')
    .setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: PNG_1x1 });

  const thumb = mount.locator('.fb-attach-thumb img');
  await expect(thumb).toHaveCount(1);

  // Quello che è finito nel deposito è cifrato (la metà già chiesta dal
  // feedback): quindi il suo indirizzo NON è un'immagine mostrabile.
  const cifrato = await page.evaluate(() => {
    const byte = [...window.__deposito.values()][0] || [];
    return byte.length > 78 && byte[0] === 1;
  });
  expect(cifrato, "l'allegato del commento deve salire cifrato").toBe(true);

  // E l'anteprima deve mostrare la schermata appena allegata, non un riquadro
  // rotto. Non conta da dove Filo prenda l'immagine (la copia in chiaro che ha
  // in mano, o il contenuto decifrato): conta che quella sorgente NON sia
  // l'indirizzo del deposito, dove ci sono byte cifrati, e che l'immagine si
  // carichi davvero.
  await expect(thumb).not.toHaveAttribute('src', /firebasestorage/);
  await expect
    .poll(() => thumb.evaluate((el) => el.naturalWidth), { timeout: 10_000 })
    .toBeGreaterThan(0);

  // Cliccandola si ingrandisce, e anche lì si vede.
  await thumb.click();
  await expect(page.locator('#lightbox')).toHaveClass(/open/, { timeout: 5_000 });
  await expect
    .poll(() => page.locator('#lightboxImg').evaluate((el) => el.naturalWidth), { timeout: 10_000 })
    .toBeGreaterThan(0);
});

test('riaprendo una nota, gli allegati già salvati si rivedono in anteprima', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  const chiavi = await coppiaDiProva();

  // Una nota che porta già un allegato-immagine, come dopo un commento con
  // schermata: l'indirizzo è quello del deposito, i byte sono cifrati.
  const nomeOggetto = 'feedback/1780000000000_11111111-2222-3333-4444-555555555555.octetstream';
  const urlAllegato = `https://firebasestorage.googleapis.com/v0/b/filo-8b9cb.firebasestorage.app/o/${encodeURIComponent(nomeOggetto)}?alt=media&token=t`;
  const marcatore = `@@filo-attachment ${JSON.stringify({ kind: 'img', url: urlAllegato, name: 'screen.png', type: 'image/png' })}`;

  await preparaScheda(app, page, {
    _id: 'verifica-602-nota',
    status: 'todo',
    text: 'il pulsante non risponde',
    url: 'https://example.com',
    clientId: 'tester-123',
    notes: ['Ecco cosa ho visto.', marcatore].join('\n'),
    createdAt: new Date().toISOString(),
  }, chiavi);

  // Mettiamo nel deposito finto la versione cifrata di quella schermata, così
  // la rilettura può riuscire: è esattamente ciò che ci sarebbe in produzione.
  await page.evaluate(async ({ nome, pngB64 }) => {
    const grezzo = Uint8Array.from(atob(pngB64), (c) => c.charCodeAt(0));
    const sigillato = await window.SN_FEEDBACK_CRYPTO.encryptBytesForOwner(grezzo);
    window.__deposito.set(nome, Array.from(sigillato));
  }, { nome: nomeOggetto, pngB64: PNG_1x1_B64 });

  await page.locator('[data-tab="queue"]').click();
  const card = page.locator('.fb-card');
  const mount = card.locator('.fb-attach-mount[data-kind="notes"]').first();
  await expect(mount).toBeAttached({ timeout: 10_000 });

  const thumb = mount.locator('.fb-attach-thumb img').first();
  await expect(thumb).toHaveCount(1, { timeout: 10_000 });
  await expect(thumb).toHaveAttribute('src', new RegExp(`^data:image/png;base64,${PNG_1x1_B64}$`), { timeout: 10_000 });
  expect(await thumb.evaluate((el) => el.naturalWidth), "l'anteprima deve caricarsi davvero").toBeGreaterThan(0);
});
