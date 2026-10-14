// Verifica locale di gestione-sezioni, giro 2: le porte del giro 1 riprovate e la lettura periodica delle domande.
// Il main finto sta davanti alla pagina prima che parta: l'apertura vera legge questi dati.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const ORA = Date.now();

function fb(over = {}) {
  return Object.assign({
    _id: `fb-${over.seq || 1}`, name: `Pratica ${over.seq || 1}`, text: 'Testo.', seq: 1, subSeq: 0,
    status: 'todo', statusPublic: 'open', clientId: 'utente-x', createdAt: '2026-10-10T08:00:00Z', images: [],
  }, over);
}
const PRATICHE = [fb({ seq: 901, status: 'unlabeled' }), fb({ seq: 902, status: 'unlabeled' }), fb({ seq: 903, status: 'todo' })];

function domanda(numero, over = {}) {
  return Object.assign({
    id: `D-${numero}`, numero, titolo: `Domanda ${numero}`, priorita: 'importante', stato: 'aperta', fiducia: 'fidato',
    contesto: 'Contesto.', problema: 'Problema.',
    opzioni: [{ testo: 'Archivia la pratica', pro: 'Pulisce.', contro: 'Si perde.', azione: { tipo: 'archivia', feedbackId: 'fb-903' } }],
    consiglio: { opzione: 0, perche: 'Basta così.' }, notePerAgenti: '', gruppo: '', collegamenti: [],
    conversazione: [], creataIl: ORA - numero * 60000, modificataIl: ORA - numero * 60000,
  }, over);
}

async function mainFinto(app, cfg) {
  await app.evaluate(({ ipcMain }, c) => {
    globalThis.__v2 = c;
    globalThis.__v2Attese = globalThis.__v2Attese || [];
    globalThis.__v2Letture = globalThis.__v2Letture || 0;
    if (globalThis.__v2Orig) return;
    const orig = ipcMain._invokeHandlers.get('filo:message');
    globalThis.__v2Orig = orig;
    ipcMain.removeHandler('filo:message');
    ipcMain.handle('filo:message', async (event, msg) => {
      const s = globalThis.__v2;
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'feedback_fetch') {
        const rows = JSON.parse(JSON.stringify(s.feedbacks || []));
        if (msg.op === 'getMany') return { ok: true, rows: rows.filter((r) => (msg.ids || []).includes(r._id)) };
        return { ok: true, rows, complete: true, readTime: new Date().toISOString() };
      }
      if (t === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 7 * 864e5 };
      if (t === 'domande_elenco') {
        globalThis.__v2Letture++;
        if (s.trattieni) await new Promise((r) => globalThis.__v2Attese.push(r));
        if (s.guasti > 0) { s.guasti--; return { ok: false, error: 'deadline-exceeded' }; }
        return { ok: true, domande: JSON.parse(JSON.stringify(s.domande || [])), riferimenti: s.riferimenti || {}, adesso: Date.now(), altre: false };
      }
      return orig(event, msg);
    });
  }, cfg);
}
const cambiaFinto = (app, parte) => app.evaluate((_e, p) => Object.assign(globalThis.__v2, p), parte);
const letture = (app) => app.evaluate(() => globalThis.__v2Letture);
async function rilascia(app) {
  await app.evaluate(() => { globalThis.__v2.trattieni = false; for (const r of globalThis.__v2Attese.splice(0)) r(); });
}
async function apri(openTab) {
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && window.filo);
  return page;
}
const conto = (page, sez) => page.locator(`.mg-sezione[data-sezione="${sez}"] .mg-sezione-count`);

test('riprova giro 1 primo rilievo: una bloccante nata con la Gestione aperta si conta e si fa rossa senza entrare in Domande; una risposta altrove scende', async ({ app, openTab }) => {
  test.setTimeout(420_000);
  await mainFinto(app, { feedbacks: PRATICHE, domande: [domanda(1)] });
  const page = await apri(openTab);
  await page.evaluate(() => window.__mgTest.whenReady());
  await expect(page.locator('.mg-sezione--active')).toHaveAttribute('data-sezione', 'feedback');
  await expect(conto(page, 'domande')).toHaveText('(1)');
  await expect(page.locator('.mg-sezione[data-sezione="domande"]')).not.toHaveClass(/mg-sezione--urgente/);
  await cambiaFinto(app, { domande: [domanda(1), domanda(2, { priorita: 'bloccante', modificataIl: Date.now() })] });
  await expect(conto(page, 'domande')).toHaveText('(2)', { timeout: 150_000 });
  await expect(page.locator('.mg-sezione[data-sezione="domande"]')).toHaveClass(/mg-sezione--urgente/);
  await expect(page.locator('.mg-sezione--active')).toHaveAttribute('data-sezione', 'feedback');
  // Risposta data da una sessione locale: la domanda passa in lavorazione.
  await cambiaFinto(app, { domande: [domanda(1), domanda(2, { priorita: 'bloccante', stato: 'in_lavorazione', modificataIl: Date.now() })] });
  await expect(conto(page, 'domande')).toHaveText('(1)', { timeout: 150_000 });
  await expect(page.locator('.mg-sezione[data-sezione="domande"]')).not.toHaveClass(/mg-sezione--urgente/);
});

test('riprova giro 1 secondo rilievo: la pratica aperta mentre le domande arrivano resta a schermo', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mainFinto(app, { feedbacks: PRATICHE, domande: [domanda(1, { priorita: 'bloccante' })], trattieni: true });
  const page = await apri(openTab);
  const riga = page.locator('#mgList .mg-item[data-id="fb-902"]');
  await expect(riga).toBeVisible({ timeout: 30_000 });
  await riga.click();
  await expect(page.locator('#mgDetail')).toBeVisible();
  await rilascia(app);
  await page.evaluate(() => window.__mgTest.whenReady());
  await expect(conto(page, 'domande')).toHaveText('(1)');
  await page.waitForTimeout(1500);
  await expect(page.locator('.mg-sezione--active')).toHaveAttribute('data-sezione', 'feedback');
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgList .mg-item[data-id="fb-902"]')).toHaveClass(/selected|active|--sel/);
});

test('riprova giro 1 secondo rilievo con la lente: la ricerca scritta mentre le domande arrivano resta', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await mainFinto(app, { feedbacks: PRATICHE, domande: [domanda(1, { priorita: 'bloccante' })], trattieni: true });
  const page = await apri(openTab);
  await expect(page.locator('#mgList .mg-item').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('#mgSearchToggle').click();
  await page.locator('#mgSearchInput').pressSequentially('pratica che non trovo');
  await rilascia(app);
  await page.evaluate(() => window.__mgTest.whenReady());
  await expect(conto(page, 'domande')).toHaveText('(1)');
  await page.waitForTimeout(1500);
  await expect(page.locator('#mgSearchBar')).toBeVisible();
  await expect(page.locator('#mgSearchInput')).toHaveValue('pratica che non trovo');
});

test('una lettura periodica delle domande andata male non porta via la domanda a cui l’owner sta rispondendo', async ({ app, openTab }) => {
  test.setTimeout(420_000);
  await mainFinto(app, { feedbacks: PRATICHE, domande: [domanda(1, { priorita: 'bloccante' }), domanda(2), domanda(3)] });
  const page = await apri(openTab);
  await page.evaluate(() => window.__mgTest.whenReady());
  await expect(page.locator('.mg-sezione--active')).toHaveAttribute('data-sezione', 'domande');
  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-3"]').click();
  const art = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-3"]');
  await expect(art).toBeVisible();
  await art.locator('.mg-dq-testo').click();
  await page.keyboard.type('Sto scrivendo la risposta alla terza');
  const prima = await letture(app);
  await cambiaFinto(app, { guasti: 1 });
  await expect.poll(() => letture(app), { timeout: 150_000 }).toBeGreaterThan(prima);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: test.info().outputPath('dopo-guasto.png') });
  // Dal punto di vista dell'owner: la domanda e il testo restano, al più con un avviso.
  await expect(art).toBeVisible();
  await expect(art.locator('.mg-dq-testo')).toHaveValue('Sto scrivendo la risposta alla terza');
  await expect(page.locator('#mgDomandeLista .mg-domanda[data-id="D-3"]')).toBeVisible();
});
