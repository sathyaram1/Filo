// Giro 3, rilievo 1: con la rete giù all'apertura, un salvataggio fallito
// toglie l'avviso «non ho potuto leggere» e lascia gli interruttori sui valori
// di partenza, come se venissero dal server.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function apri(openTab, doc = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await page.evaluate((init) => {
    window.__doc = Object.assign({}, init);
    window.__getFail = false;
    window.__setLettoFalse = false;
    window.__ritardi = [];
    const RS = window.SN_ROUTINE_SESSIONI;
    const orig = window.filo.message.bind(window.filo);
    const attesa = () => new Promise((r) => setTimeout(r, window.__ritardi.length ? window.__ritardi.shift() : 0));
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_sessions_get') {
        if (window.__getFail) { await attesa(); return { ok: false, error: 'rete giù' }; }
        const r = Object.assign({ ok: true, letto: true }, RS.leggiDoc(window.__doc));
        await attesa();
        return r;
      }
      if (msg && msg.type === 'automation_sessions_set') {
        const patch = {};
        for (const k of RS.CHIAVI) if (msg[k] != null) patch[k] = msg[k];
        const esito = RS.valida(patch);
        if (!esito.ok) return { ok: false, error: esito.testo };
        Object.assign(window.__doc, esito.valori);
        const r = window.__setLettoFalse
          ? Object.assign({ ok: true, letto: false }, esito.valori)
          : Object.assign({ ok: true, letto: true }, RS.leggiDoc(window.__doc));
        await attesa();
        return r;
      }
      return orig(msg);
    };
  }, doc);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadSessions());
  return page;
}

const cambia = (page, id, checked) => page.evaluate(([i, c]) => {
  const el = document.getElementById(i);
  el.checked = c;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, checked]);

test('rete giù all\'apertura, escludere B fallisce: la riga degli account dice ancora che non sa cosa c\'è sul server', async ({ openTab }) => {
  const page = await apri(openTab, { accountAOff: true, accountBOff: true });
  await page.evaluate(() => { window.__getFail = true; });
  await page.evaluate(() => window.__mgTest.loadSessions());
  await expect(page.locator('#mgAccountsMsg')).toContainText('Non ho potuto leggere');
  await page.evaluate(() => {
    const prec = window.filo.message;
    window.filo.message = async (msg) => (msg && msg.type === 'automation_sessions_set') ? { ok: false, error: 'rete giù' } : prec(msg);
  });
  await cambia(page, 'mgAccountB', false);
  await expect(page.locator('#mgAccountsMsg')).toContainText('NON è cambiata');
  // Sul server tutti e due sono esclusi: la riga non può tornare a mostrarli in uso senza dire che non lo sa.
  await expect(page.locator('#mgAccountsMsg')).toContainText('leggere');
});
