// Verifica #582, giro 8 — il selettore dei file e il filtro degli allegati
// devono dire la stessa cosa, sulle DUE superfici che allegano.
//
// Perché sta qui. Le regole del deposito ammettono una lista precisa di tipi, e
// l'app ha una lista condivisa (`SN_FEEDBACK_ATTACH`) che rifiuta subito quello
// che il deposito respingerebbe. Quella lista è UNA. La stringa che decide cosa
// il selettore di file MOSTRA, invece, è scritta a mano DUE volte — una nel
// riquadro di segnalazione dentro i siti, una nel compositore con cui si
// risponde dentro la conversazione — e nessuna delle due la ricava dalla lista.
// Così le due superfici promettono cose diverse da quelle che poi accettano, in
// tutte e due le direzioni:
//   - il compositore delle risposte offre `image/*` e `text/*`, che comprendono
//     un disegno vettoriale e una pagina web: tipi che il filtro rifiuta un
//     istante dopo (è la metà rimasta aperta del rilievo del giro 7);
//   - il riquadro di segnalazione NON offre il `.tsv`, che invece Filo accetta
//     (aggiunto alla lista al giro 7, insieme al `.yaml`, perché lo manda lo
//     strumento a riga di comando).
//
// Le due prove asseriscono il comportamento voluto dal punto di vista di chi
// allega: quello che vedo nel selettore è quello che Filo accetta. Senza la
// correzione sono rosse; con la correzione (una stringa sola, ricavata dalla
// lista condivisa) diventano verdi.

import { test, expect } from './../../fixtures/electron.mjs';

const FEEDBACK_URL = 'filo://feedback/feedback.html';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(
    () => document.documentElement.dataset.filoContentScripts === '1',
    null,
    { timeout: 8_000 },
  );
  return win;
}

// Un tipo è "offerto" dal selettore se compare come MIME esatto, come
// estensione, o dentro una famiglia con l'asterisco (`image/*`).
function offerto(accept, { mime, ext }) {
  const voci = String(accept || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const famiglia = String(mime || '').split('/')[0];
  return voci.includes(String(mime || '').toLowerCase())
    || voci.includes(`.${String(ext || '').toLowerCase()}`)
    || voci.includes(`${famiglia}/*`);
}

test('riquadro di segnalazione: il selettore offre ogni tipo che Filo poi accetta', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);

  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  // Premessa, misurata e non data per buona: una tabella .tsv Filo la ACCETTA.
  const accettato = await page.evaluate(() => {
    const A = window.SN_FEEDBACK_ATTACH;
    return A.classify({ name: 'misure.tsv', type: 'text/tab-separated-values' });
  });
  expect(accettato, 'una tabella .tsv dovrebbe essere un allegato ammesso').toBe('file');

  // Quindi deve comparire anche nel selettore: un tipo ammesso che il selettore
  // non mostra costringe a cambiare filtro a mano per allegare una cosa
  // permessa.
  const accept = await page.locator('.sn-fb-file').getAttribute('accept');
  expect(
    offerto(accept, { mime: 'text/tab-separated-values', ext: 'tsv' }),
    `il selettore non offre la tabella .tsv, che Filo accetta (accept="${accept}")`,
  ).toBe(true);
});

test('compositore delle risposte: il selettore non offre tipi che Filo poi rifiuta', async ({ app, openTab }) => {
  const page = await openTab(FEEDBACK_URL);
  await expect(page.locator('#adminBanner')).toBeVisible({ timeout: 8_000 });

  const feedback = {
    _id: 'giro8-selettore',
    status: 'clarify',
    text: 'il pulsante non risponde',
    url: 'https://example.com',
    clientId: 'tester-123',
    notes: 'Puoi mandarmi uno screenshot del problema?',
    createdAt: new Date().toISOString(),
  };

  await page.evaluate((fb) => {
    window.SN_FEEDBACK.list = async () => [fb];
    window.SN_FEEDBACK.uploadAttachment = async (blob, name) => ({
      kind: String((blob && blob.type) || '').startsWith('image/') ? 'img' : 'file',
      url: `https://firebasestorage.example/${encodeURIComponent(name || 'a')}`,
      name: String(name || 'allegato'),
      type: (blob && blob.type) || '',
    });
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') return { ok: true };
      if (msg && msg.type === 'auth_status') {
        return { ok: true, isAdmin: true, profile: { email: 'sathyarampontillo@gmail.com' } };
      }
      return orig(msg);
    };
  }, feedback);

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
  await page.locator('[data-tab="inbox"]').click();

  const card = page.locator('.fb-card');
  const input = card.locator('.fb-attach-mount[data-kind="reply"] input[type="file"]');
  await expect(input).toHaveCount(1, { timeout: 10_000 });

  // Controprova: il filtro RIFIUTA davvero un disegno vettoriale e una pagina
  // web. Se un giorno li accettasse, la prova sotto non direbbe più niente.
  const rifiutati = await page.evaluate(() => {
    const A = window.SN_FEEDBACK_ATTACH;
    return {
      svg: A.classify({ name: 'logo.svg', type: 'image/svg+xml' }),
      html: A.classify({ name: 'pagina.html', type: 'text/html' }),
    };
  });
  expect(rifiutati.svg, 'un .svg dovrebbe essere rifiutato').toBe(null);
  expect(rifiutati.html, 'un .html dovrebbe essere rifiutato').toBe(null);

  // Quindi il selettore non deve nemmeno proporli: `image/*` e `text/*` li
  // comprendono, e chi li sceglie si sente rispondere che non si possono
  // allegare dopo averli cercati.
  const accept = await input.getAttribute('accept');
  expect(
    offerto(accept, { mime: 'image/svg+xml', ext: 'svg' }),
    `il selettore offre un disegno vettoriale, che Filo rifiuta (accept="${accept}")`,
  ).toBe(false);
  expect(
    offerto(accept, { mime: 'text/html', ext: 'html' }),
    `il selettore offre una pagina web, che Filo rifiuta (accept="${accept}")`,
  ).toBe(false);

  // E quello che è ammesso si allega ancora: la correzione non deve chiudere
  // niente di buono.
  await input.setInputFiles({ name: 'screen.png', mimeType: 'image/png', buffer: PNG_1x1 });
  await expect(card.locator('.fb-attach-mount[data-kind="reply"] .fb-attach-thumb img')).toHaveCount(1);
});
