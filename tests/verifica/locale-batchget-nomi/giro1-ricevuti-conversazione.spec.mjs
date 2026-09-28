// Verifica locale, giro 1: in Gestione → Ricevuti una pratica ferma per una
// decisione si apre con la conversazione intera, il rombo verde e la domanda
// nel pannello di destra. Finto è solo Firestore, nel main, e risponde come
// quello vero (400 a un nome di documento scritto come URL).

import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const ID = 'fb-decisione-711';
const ALTRA = 'fb-altra-712';

const DOC = {
  text: 'In Gestione non vedo la conversazione della pratica.',
  name: 'La conversazione della pratica non arriva',
  seq: 711, subSeq: 0,
  clientId: 'owner@example.com', createdAt: '2026-09-27T09:00:00Z',
  images: [], files: [],
  status: 'design', statusReason: 'decisione', statusPublic: 'open',
  branch: 'claude/pratica-711',
  notes: [
    'TURNO-UNO: primo report della lavorazione.',
    '--- La tua risposta del 27/09/2026, 10:00 ---',
    'TURNO-DUE: risposta dell\'owner.',
    '--- Filo ha risposto il 27/09/2026, 11:00 ---',
    'TURNO-TRE: serve una scelta, A oppure B?',
  ].join('\n'),
  livelli: { l3: { ruolo: 'resolver', at: '2026-09-27T11:00:00Z', esito: 'segnalato', testo: 'DOMANDA-L3: scegli A oppure B.' } },
};
const DOCS = {
  [ID]: DOC,
  [ALTRA]: { ...DOC, seq: 712, name: 'Un\'altra pratica ferma', notes: 'ALTRA-CONVERSAZIONE: il report dell\'altra pratica.',
    livelli: { l3: { ...DOC.livelli.l3, testo: 'ALTRA-DOMANDA: C oppure D?' } } },
};

// Firestore finto nel main: solo batchGet, con la stessa regola sul nome del vero.
async function firestoreFinto(app, { ritardoMs = 0, guasti = 0 } = {}) {
  await app.evaluate(async (_e, cfg) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const ga = req('./auth/google-auth');
    ga.isAdmin = () => true;
    ga.getIdToken = async () => 'tok-di-prova';

    const toFs = (v) => {
      if (v === null || v === undefined) return { nullValue: null };
      if (typeof v === 'string') return { stringValue: v };
      if (typeof v === 'boolean') return { booleanValue: v };
      if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
      if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
      return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFs(x)])) } };
    };
    const ROOT = 'projects/filo-8b9cb/databases/(default)/documents/';
    globalThis.__fs = { richieste: [], ritardoMs: cfg.ritardoMs, guasti: cfg.guasti,
      docs: Object.fromEntries(Object.entries(cfg.docs).map(([id, d]) => [`feedback/${id}`, Object.fromEntries(Object.entries(d).map(([k, v]) => [k, toFs(v)]))])) };
    if (!globalThis.__fetchVero) globalThis.__fetchVero = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (!u.includes(':batchGet')) return globalThis.__fetchVero(url, opts);
      const st = globalThis.__fs;
      const nomi = JSON.parse(opts.body).documents || [];
      st.richieste.push(nomi);
      if (st.ritardoMs) await new Promise((r) => setTimeout(r, st.ritardoMs));
      if (st.guasti > 0) {
        st.guasti -= 1;
        return new Response('{"error":{"code":503,"message":"unavailable"}}', { status: 503 });
      }
      const storto = nomi.find((n) => !String(n).startsWith(ROOT));
      if (storto) {
        return new Response(JSON.stringify([{ error: { code: 400, message: `Document name "${storto}" lacks "projects" at index 0.` } }]), { status: 400 });
      }
      const out = nomi.map((n) => {
        const d = st.docs[n.slice(ROOT.length)];
        return d
          ? { found: { name: n, fields: d, createTime: '2026-09-27T09:00:00Z', updateTime: '2026-09-27T11:00:00Z' }, readTime: 'r' }
          : { missing: n, readTime: 'r' };
      });
      return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  }, { docs: DOCS, ritardoMs, guasti });
}

// La pagina con la sola riga d'elenco (proiezione), come dopo il caricamento vero.
async function apri(openTab, ids = [ID]) {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo && window.SN_FEEDBACK);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(({ docs }) => {
    window.__inviati = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 7 * 86400000 };
      if (t === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      if (t === 'feedback_update') { window.__inviati.push(msg); return { ok: true }; }
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    const campi = window.SN_FEEDBACK.CAMPI_LISTA;
    window.__mgTest.setData(Object.entries(docs).map(([id, doc]) => ({
      ...Object.fromEntries(Object.entries(doc).filter(([k]) => campi.includes(k))),
      _id: id, _updateTime: '2026-09-27T11:00:00Z', _proiezione: true,
    })));
  }, { docs: Object.fromEntries(ids.map((id) => [id, DOCS[id]])) });
  return page;
}

const scheda = (page, id = ID) => page.locator(`.mg-item[data-id="${id}"]`);
const rombo = (page) => page.locator('#mgDetail .mg-forma[data-livello="l3"]');
const pannello = (page) => page.locator('#mgSideCol');

test('Ricevuti: aprire la pratica mostra la conversazione intera, il rombo verde e la domanda', async ({ app, openTab }) => {
  await firestoreFinto(app);
  const page = await apri(openTab);
  await page.locator('.mg-tab[data-tab="inbox"]').click();
  await scheda(page).click();

  const detail = page.locator('#mgDetail');
  await expect(detail).toContainText('TURNO-TRE', { timeout: 15000 });
  await expect(detail).toContainText('TURNO-UNO');
  await expect(detail).toContainText('TURNO-DUE');
  await expect(detail).not.toContainText('non è arrivato');
  await expect(rombo(page)).toHaveClass(/mg-forma--design/);

  await rombo(page).click();
  await expect(pannello(page)).toContainText('DOMANDA-L3');
  await expect(pannello(page)).toContainText('27/09/2026');
  await expect(pannello(page)).not.toContainText('non è ancora arrivato');
  await page.screenshot({ path: 'tests/.shots/locale-batchget-nomi-chiaro.png' });
  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await page.screenshot({ path: 'tests/.shots/locale-batchget-nomi-scuro.png' });

  const richieste = await app.evaluate(() => globalThis.__fs.richieste);
  expect(richieste.flat().some((n) => n.endsWith(`/feedback/${ID}`))).toBe(true);
});

test('rombo aperto mentre il resto sta arrivando: il pannello di destra si aggiorna da solo', async ({ app, openTab }) => {
  await firestoreFinto(app, { ritardoMs: 2500 });
  const page = await apri(openTab);
  await scheda(page).click();
  await rombo(page).click();
  await expect(pannello(page)).toContainText('non è ancora arrivato');
  await expect(page.locator('#mgDetail')).toContainText('TURNO-TRE', { timeout: 15000 });
  await expect(pannello(page)).toContainText('DOMANDA-L3', { timeout: 5000 });
  await expect(rombo(page)).toHaveClass(/mg-forma--design/);
});

test('lettura fallita una volta: Riprova porta conversazione e rombo verde', async ({ app, openTab }) => {
  await firestoreFinto(app, { guasti: 1 });
  const page = await apri(openTab);
  await scheda(page).click();
  const riprova = page.locator('#mgRiprovaDettaglio');
  await expect(riprova).toBeVisible({ timeout: 15000 });
  await riprova.click();
  await expect(page.locator('#mgDetail')).toContainText('TURNO-TRE', { timeout: 15000 });
  await expect(rombo(page)).toHaveClass(/mg-forma--design/);
  await rombo(page).click();
  await expect(pannello(page)).toContainText('DOMANDA-L3');
});

test('rispondere subito, mentre la conversazione arriva: la risposta si aggiunge in coda, il report resta', async ({ app, openTab }) => {
  await firestoreFinto(app, { ritardoMs: 2500 });
  const page = await apri(openTab);
  await scheda(page).click();
  await page.locator('#mgClarifyText').fill('Scelgo A.');
  await page.locator('#mgClarifyBtn').click();
  await expect.poll(() => page.evaluate(() => window.__inviati.length), { timeout: 15000 }).toBe(1);
  const inviato = await page.evaluate(() => window.__inviati[0]);
  expect(inviato.id).toBe(ID);
  expect(inviato.notes.startsWith(DOC.notes)).toBe(true);
  expect(inviato.notes).toContain('Scelgo A.');
});

test('passare in fretta da una pratica all\'altra mentre arrivano: ognuna mostra la sua conversazione', async ({ app, openTab }) => {
  await firestoreFinto(app, { ritardoMs: 1500 });
  const page = await apri(openTab, [ID, ALTRA]);
  await scheda(page).click();
  await scheda(page, ALTRA).click();
  const detail = page.locator('#mgDetail');
  await expect(detail).toContainText('ALTRA-CONVERSAZIONE', { timeout: 15000 });
  await page.waitForTimeout(2000);
  await expect(detail).not.toContainText('TURNO-TRE');
  await rombo(page).click();
  await expect(pannello(page)).toContainText('ALTRA-DOMANDA');
  await scheda(page).click();
  await expect(detail).toContainText('TURNO-TRE', { timeout: 15000 });
  await expect(detail).not.toContainText('ALTRA-CONVERSAZIONE');
  await expect(rombo(page)).toHaveClass(/mg-forma--design/);
});

test('la pagina gemella dei feedback, stessa pratica nei Ricevuti: la conversazione arriva intera', async ({ app, openTab }) => {
  await firestoreFinto(app);
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__fbTest && window.filo && window.SN_FEEDBACK);
  await page.evaluate(({ id, doc }) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      return orig(msg);
    };
    window.__fbTest.setAdmin(true);
    const campi = window.SN_FEEDBACK.CAMPI_LISTA;
    window.__fbTest.setData([{
      ...Object.fromEntries(Object.entries(doc).filter(([k]) => campi.includes(k))),
      _id: id, _updateTime: '2026-09-27T11:00:00Z', _proiezione: true,
    }]);
    window.__fbTest.setTab('inbox');
  }, { id: ID, doc: DOC });
  await expect(page.locator('body')).toContainText('TURNO-TRE', { timeout: 15000 });
  await expect(page.locator('body')).toContainText('TURNO-UNO');
  await expect(page.locator('body')).not.toContainText('non è arrivato');
});
