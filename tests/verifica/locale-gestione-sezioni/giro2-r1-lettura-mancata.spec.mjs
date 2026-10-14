// Verifica locale di gestione-sezioni, giro 2, rilievo 1: una lettura delle domande non riuscita svuota la sezione
// Domande sotto le mani dell'owner. Il main finto sta davanti alla pagina prima che parta e sa far fallire una lettura.
import { test, expect } from '../../fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const ORA = Date.now();

function fb(over = {}) {
  return Object.assign({
    _id: `fb-${over.seq || 1}`, name: `Pratica ${over.seq || 1}`, text: 'Testo.', seq: 1, subSeq: 0,
    status: 'todo', statusPublic: 'open', clientId: 'utente-x', createdAt: '2026-10-10T08:00:00Z', images: [],
  }, over);
}
const PRATICHE = [fb({ seq: 901, status: 'unlabeled' }), fb({ seq: 903, status: 'todo' })];

function domanda(numero, over = {}) {
  return Object.assign({
    id: `D-${numero}`, numero, titolo: `Domanda ${numero}`, priorita: 'importante', stato: 'aperta', fiducia: 'fidato',
    contesto: 'Contesto.', problema: 'Problema.',
    opzioni: [{ testo: 'Archivia la pratica', pro: 'Pulisce.', contro: 'Si perde.', azione: { tipo: 'archivia', feedbackId: 'fb-903' } }],
    consiglio: { opzione: 0, perche: 'Basta così.' }, notePerAgenti: '', gruppo: '', collegamenti: [],
    conversazione: [], creataIl: ORA - numero * 60000, modificataIl: ORA - numero * 60000,
  }, over);
}

// `guasti`: quante letture dell'elenco delle domande falliscono, dalla prossima.
async function mainFinto(app, cfg) {
  await app.evaluate(({ ipcMain }, c) => {
    globalThis.__v2 = c;
    globalThis.__v2Letture = 0;
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
        if (s.guasti > 0) { s.guasti--; return { ok: false, error: 'deadline-exceeded' }; }
        return { ok: true, domande: JSON.parse(JSON.stringify(s.domande || [])), riferimenti: { 'fb-903': { num: '#903', priorita: 1 } }, adesso: Date.now(), altre: false };
      }
      if (t === 'domanda_rispondi') {
        const d = (s.domande || []).find((x) => x.id === msg.id);
        if (!d) return { ok: false, error: 'domanda sconosciuta' };
        Object.assign(d, { stato: 'in_lavorazione', modificataIl: Date.now() });
        return { ok: true, domanda: JSON.parse(JSON.stringify(d)), riferimenti: { 'fb-903': { num: '#903', priorita: 1 } } };
      }
      return orig(event, msg);
    });
  }, cfg);
}
const cambiaFinto = (app, parte) => app.evaluate((_e, p) => Object.assign(globalThis.__v2, p), parte);
const letture = (app) => app.evaluate(() => globalThis.__v2Letture);

async function apriSuDomande(app, openTab) {
  await mainFinto(app, { feedbacks: PRATICHE, domande: [domanda(1, { priorita: 'bloccante' }), domanda(2), domanda(3)] });
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await expect(page.locator('.mg-sezione--active')).toHaveAttribute('data-sezione', 'domande');
  return page;
}

test('r1 la rilettura periodica che fallisce una volta non porta via la domanda a cui l’owner sta scrivendo', async ({ app, openTab }) => {
  test.setTimeout(300_000);
  const page = await apriSuDomande(app, openTab);
  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-3"] .mg-domanda-titolo').click();
  const art = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-3"]');
  await expect(art).toBeVisible();
  await art.locator('.mg-dq-testo').click();
  await page.keyboard.type('Sto scrivendo la risposta alla terza');
  const prima = await letture(app);
  await cambiaFinto(app, { guasti: 1 });
  // La rilettura col ritmo del giro dal vivo: un minuto.
  await expect.poll(() => letture(app), { timeout: 150_000 }).toBeGreaterThan(prima);
  await page.waitForTimeout(1000);
  await expect(art).toBeVisible();
  await expect(art.locator('.mg-dq-testo')).toHaveValue('Sto scrivendo la risposta alla terza');
  await expect(page.locator('#mgDomandeLista .mg-domanda[data-id="D-3"]')).toHaveClass(/mg-domanda--aperta/);
});

test('r1 una risposta partita resta a schermo col suo esito anche se la rilettura che la segue fallisce', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await apriSuDomande(app, openTab);
  const art = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-1"]');
  await expect(art).toBeVisible();
  await cambiaFinto(app, { guasti: 1 });
  await art.locator('button[data-scelta="0"]').click();
  await page.waitForTimeout(1500);
  await expect(art).toBeVisible();
  await expect(art.locator('.mg-dq-msg')).toHaveText(/Mandata/);
});
