// #1518 — il deposito degli allegati accetta solo il blob cifrato dall'app: tipo opaco, estensione
// fissa, nessun metadato. Qui il riquadro del feedback, col deposito finto che applica le regole
// pubblicate (storage.rules): un'immagine e un .txt arrivano e la dashboard li riapre; un .zip no.

import { test, expect } from './fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const REGOLE = readFileSync(new URL('../storage.rules', import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, ' ');
const NOME_AMMESSO = /file\.matches\('([^']+)'\)/.exec(REGOLE)[1].replace(/\\\\/g, '\\');
const TIPO_AMMESSO = /request\.resource\.contentType\s*==\s*'([^']+)'/.exec(REGOLE)[1];

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const TESTO = 'registro: il salvataggio non risponde dopo il secondo clic';

async function coppiaDiProva() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = Buffer.from(new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey)))
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const priv = Buffer.from(new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey))).toString('base64');
  return { pub, priv };
}

// Nel main: la chiave pubblica di prova, e il deposito e Firestore finti. Il deposito risponde
// come risponderebbe con le regole pubblicate: un nome o un tipo diversi sono un 403.
async function depositoConLeRegole(app, { pub, priv }) {
  await app.evaluate(async (_e, { pub, priv, nomeAmmesso, tipoAmmesso }) => {
    globalThis.SN_FEEDBACK_PUBKEY = pub;
    process.env.FILO_FEEDBACK_PRIVKEY = priv;
    const re = new RegExp(nomeAmmesso);
    const D = { caricati: [], rifiutati: [], documenti: [], oggetti: new Map() };
    globalThis.__deposito = D;
    const fetchVero = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (u.startsWith('https://firebasestorage.googleapis.com/')) {
        if (u.includes('uploadType=media')) {
          const nome = decodeURIComponent((/[?&]name=([^&]+)/.exec(u) || [])[1] || '');
          const h = opts.headers || {};
          const tipo = String(h['Content-Type'] || h['content-type'] || '');
          const byte = new Uint8Array(await new Response(opts.body).arrayBuffer());
          if (!nome.startsWith('feedback/') || !re.test(nome.slice('feedback/'.length)) || tipo !== tipoAmmesso) {
            D.rifiutati.push({ nome, tipo });
            return new Response(JSON.stringify({ error: { code: 403, message: 'Permission denied.' } }), { status: 403 });
          }
          const token = crypto.randomUUID();
          D.oggetti.set(nome, { byte, token });
          D.caricati.push({ nome, tipo, byte: Array.from(byte) });
          return new Response(JSON.stringify({ name: nome, downloadTokens: token }), { status: 200 });
        }
        // Lo scarico apre solo col codice giusto: il `get` delle regole è negato a tutti.
        const m = /\/o\/([^?]+)\?alt=media&token=([^&]+)/.exec(u);
        const o = m && D.oggetti.get(decodeURIComponent(m[1]));
        if (o && o.token === m[2]) return new Response(o.byte, { status: 200 });
        return new Response('', { status: 403 });
      }
      if (u.startsWith('https://firestore.googleapis.com/') && u.includes('/counters/')) {
        if (opts.method === 'PATCH') return new Response('{}', { status: 200 });
        return new Response(JSON.stringify({ fields: { value: { integerValue: '41' } }, updateTime: '2026-10-01T00:00:00Z' }), { status: 200 });
      }
      if (u.startsWith('https://firestore.googleapis.com/') && opts.method === 'POST' && /\/documents\/feedback\?/.test(u)) {
        D.documenti.push(JSON.parse(opts.body));
        return new Response(JSON.stringify({ name: 'projects/p/databases/(default)/documents/feedback/doc-1518' }), { status: 200 });
      }
      return fetchVero(url, opts);
    };
  }, { pub, priv, nomeAmmesso: NOME_AMMESSO, tipoAmmesso: TIPO_AMMESSO });
}

const deposito = (app) => app.evaluate(() => {
  const D = globalThis.__deposito;
  return { caricati: D.caricati, rifiutati: D.rifiutati, documenti: D.documenti };
});

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
  await win.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  return win;
}

async function trascina(page, { name, type, base64 }) {
  await page.evaluate(({ name, type, base64 }) => {
    const bin = atob(base64);
    const byte = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) byte[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([byte], name, { type }));
    document.querySelector('.sn-fb-modal').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { name, type, base64 });
}

/** I campi di un documento Firestore che servono qui, in chiaro. */
function allegatiDelDocumento(doc) {
  const f = doc.fields || {};
  const images = ((f.images && f.images.arrayValue && f.images.arrayValue.values) || []).map((v) => v.stringValue);
  const files = ((f.files && f.files.arrayValue && f.files.arrayValue.values) || []).map((v) => {
    const m = v.mapValue.fields;
    return { url: m.url.stringValue, name: m.name.stringValue, type: m.type.stringValue };
  });
  return { images, files };
}

test('un’immagine e un .txt arrivano nel deposito come blob cifrati e la dashboard li riapre; un .zip non parte', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chiavi = await coppiaDiProva();
  await depositoConLeRegole(app, chiavi);

  const page = await newtabPage(app);
  await page.evaluate(() => window.SN_FEEDBACK_UI.open());
  await expect(page.locator('.sn-fb-modal')).toBeVisible();

  // Il .zip: rifiutato dal riquadro, con il messaggio che dice cosa si può allegare.
  await trascina(page, { name: 'progetto.zip', type: 'application/zip', base64: Buffer.from('PK\u0003\u0004zip').toString('base64') });
  await expect(page.locator('.sn-fb-status')).toContainText(/non supportato.*Ammessi: immagini/i);
  await expect(page.locator('.sn-fb-file-chip')).toHaveCount(0);
  await expect(page.locator('.sn-fb-thumb')).toHaveCount(0);

  await trascina(page, { name: 'schermata.png', type: 'image/png', base64: PNG_1x1.toString('base64') });
  await trascina(page, { name: 'note.txt', type: 'text/plain', base64: Buffer.from(TESTO).toString('base64') });
  await expect(page.locator('.sn-fb-thumb')).toHaveCount(1);
  await expect(page.locator('.sn-fb-file-chip .sn-fb-file-name')).toHaveText('note.txt');

  await page.locator('.sn-fb-text').fill('Il salvataggio non risponde, allego schermata e registro');
  await page.locator('.sn-fb-send').click();
  await expect(page.locator('.sn-fb-modal')).toHaveCount(0, { timeout: 8_000 });

  // Arrivano: due caricamenti, accettati dalle regole, cifrati; nessuno rifiutato e il .zip non c'è.
  await expect.poll(async () => (await deposito(app)).documenti.length, { timeout: 30_000 }).toBe(1);
  const d = await deposito(app);
  expect(d.rifiutati, 'il deposito con le regole nuove ha rifiutato un caricamento dell’app').toEqual([]);
  expect(d.caricati).toHaveLength(2);
  for (const c of d.caricati) {
    expect(c.tipo).toBe(TIPO_AMMESSO);
    expect(c.nome).toMatch(new RegExp(`^feedback/${NOME_AMMESSO.replace(/^\^/, '')}`));
    const byte = Buffer.from(c.byte);
    expect(byte[0], 'primo byte = versione del formato cifrato').toBe(1);
    expect(byte.includes(PNG_1x1.subarray(0, 8)), 'l’immagine non deve salire in chiaro').toBe(false);
    expect(byte.includes(Buffer.from(TESTO)), 'il testo non deve salire in chiaro').toBe(false);
  }
  const { images, files } = allegatiDelDocumento(d.documenti[0]);
  expect(images).toHaveLength(1);
  expect(files).toEqual([expect.objectContaining({ name: 'note.txt', type: 'text/plain' })]);

  // La dashboard di chi riceve le segnalazioni li riapre, dal main vero: scarico col codice e decifratura.
  await app.evaluate(async () => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    req('./auth/google-auth').isAdmin = () => true;
  });
  const dash = await openTab('filo://feedback/feedback.html');
  await dash.waitForFunction(() => !!(window.SN_FEEDBACK && window.filo && window.filo.message));
  await dash.evaluate(({ fb }) => {
    window.SN_FEEDBACK.list = async () => [fb];
    window.__decifrati = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: true, profile: { email: 'owner@esempio.invalid' } };
      const r = await orig(msg);
      if (msg && msg.type === 'feedback_decrypt_image') window.__decifrati.push({ url: msg.url, mime: msg.mime || '', r });
      return r;
    };
  }, { fb: { _id: 'doc-1518', status: 'todo', text: 'Il salvataggio non risponde', images, files, createdAt: new Date().toISOString() } });
  await app.evaluate(async ({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
      if (url.includes('feedback')) {
        wc.send('filo:broadcast', { type: 'auth_changed', signedIn: true, isAdmin: true, profile: { email: 'owner@esempio.invalid' } });
      }
    }
  });
  await expect(dash.locator('#adminBanner')).toBeHidden({ timeout: 8_000 });
  await dash.locator('#refresh').click();
  await dash.locator('[data-tab="queue"]').click();

  const img = dash.locator('.fb-card .fb-imgs img').first();
  await expect(img).toHaveAttribute('src', `data:image/png;base64,${PNG_1x1.toString('base64')}`, { timeout: 10_000 });

  await dash.locator('.fb-card a.fb-file').first().click();
  await expect.poll(() => dash.evaluate(() => window.__decifrati.filter((x) => x.mime === 'text/plain').length), { timeout: 10_000 }).toBe(1);
  const doc = await dash.evaluate(() => window.__decifrati.find((x) => x.mime === 'text/plain'));
  expect(doc.r.ok, JSON.stringify(doc.r)).toBe(true);
  expect(Buffer.from(doc.r.dataUrl.split(',')[1], 'base64').toString('utf8')).toBe(TESTO);
});
