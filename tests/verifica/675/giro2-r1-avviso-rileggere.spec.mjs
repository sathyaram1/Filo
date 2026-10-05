// Verifica #675, giro 2: sonde sul riquadro sessioni e account di Gestione → Automazioni.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function apri(openTab, doc = {}, opts = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await page.evaluate(([init, o]) => {
    window.__doc = Object.assign({}, init);
    window.__getFail = !!o.getFail;
    window.__rileggiFail = false;
    window.__delaySet = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_sessions_get') {
        if (window.__getFail) return { ok: false, error: 'rete giù' };
        return Object.assign({ ok: true, letto: true }, window.SN_ROUTINE_SESSIONI.leggiDoc(window.__doc));
      }
      if (msg && msg.type === 'automation_sessions_set') {
        const patch = {};
        for (const k of ['maxSessions', 'priorityAccount', 'accountAOff', 'accountBOff']) if (msg[k] != null) patch[k] = msg[k];
        const esito = window.SN_ROUTINE_SESSIONI.valida(patch);
        if (!esito.ok) return { ok: false, error: esito.testo };
        Object.assign(window.__doc, esito.valori);
        const ms = window.__delaySet.shift();
        const risposta = window.__rileggiFail
          ? Object.assign({ ok: true, letto: false }, esito.valori)
          : Object.assign({ ok: true, letto: true }, window.SN_ROUTINE_SESSIONI.leggiDoc(window.__doc));
        if (ms) await new Promise((r) => setTimeout(r, ms));
        return risposta;
      }
      return orig(msg);
    };
  }, [doc, opts]);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadSessions());
  return page;
}

const cambia = (page, id, checked) => page.evaluate(([i, c]) => {
  const el = document.getElementById(i);
  el.checked = c;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, checked]);

test('scritto ma non riletto, poi una risposta piena: l\'avviso «non l\'ho potuto rileggere» se ne va', async ({ openTab }) => {
  const page = await apri(openTab, { maxSessions: 3 });
  await expect(page.locator('#mgMaxSessions')).toHaveValue('3');
  // Esclusione di A: scritta, ma la rilettura non riesce.
  await page.evaluate(() => { window.__rileggiFail = true; });
  await cambia(page, 'mgAccountA', false);
  await expect(page.locator('#mgAccountsMsg')).toContainText('non l\'ho potuto rileggere');
  // Torna la rete: un salvataggio del numero riporta il documento intero.
  await page.evaluate(() => { window.__rileggiFail = false; });
  await page.locator('#mgMaxSessions').fill('5');
  await page.locator('#mgMaxSessionsSave').click();
  await expect(page.locator('#mgMaxSessionsMsg')).toHaveText('Salvato.');
  await expect(page.locator('#mgAccountA')).not.toBeChecked();
  // Ora tutto il riquadro viene dal server: nessuna riga dice il contrario.
  await expect(page.locator('#mgAccountsMsg')).not.toContainText('rileggere');
});

test('dopo un salvataggio non riletto, riaprire la lettura toglie lo stesso avviso', async ({ openTab }) => {
  const page = await apri(openTab, { maxSessions: 3 });
  await page.evaluate(() => { window.__rileggiFail = true; });
  await page.locator('#mgMaxSessions').fill('6');
  await page.locator('#mgMaxSessionsSave').click();
  await expect(page.locator('#mgMaxSessionsMsg')).toContainText('non l\'ho potuto rileggere');
  await page.evaluate(() => { window.__rileggiFail = false; });
  await page.evaluate(() => window.__mgTest.loadSessions());
  await expect(page.locator('#mgMaxSessions')).toHaveValue('6');
  await expect(page.locator('#mgMaxSessionsMsg')).not.toContainText('rileggere');
});
