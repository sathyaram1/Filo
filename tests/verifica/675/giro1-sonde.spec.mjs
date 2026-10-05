// Verifica #675, giro 1: Gestione → Automazioni, scelte salvate a poca distanza.
// Finto server nella pagina; si guarda cosa arriva al server e cosa resta a schermo.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function apri(openTab) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await page.evaluate(() => {
    window.__doc = {};
    window.__delaySet = [];
    window.__mappa = { owner: true, filo: true, claude: true, user: true };
    window.__delayAuto = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_sessions_get') {
        return Object.assign({ ok: true }, window.SN_ROUTINE_SESSIONI.leggiDoc(window.__doc));
      }
      if (msg && msg.type === 'automation_sessions_set') {
        const ms = window.__delaySet.shift();
        if (ms) await new Promise((r) => setTimeout(r, ms));
        const patch = {};
        for (const k of ['maxSessions', 'priorityAccount', 'accountAOff', 'accountBOff']) {
          if (msg[k] != null) patch[k] = msg[k];
        }
        Object.assign(window.__doc, window.SN_ROUTINE_SESSIONI.valida(patch).valori);
        return Object.assign({ ok: true }, window.SN_ROUTINE_SESSIONI.leggiDoc(window.__doc));
      }
      if (msg && msg.type === 'automation_set' && msg.autoApprove) {
        // Come il main: legge la mappa intera, un giro di rete, la riscrive intera.
        const letta = Object.assign({}, window.__mappa);
        const ms = window.__delayAuto.shift();
        if (ms) await new Promise((r) => setTimeout(r, ms));
        const next = Object.assign(letta, msg.autoApprove);
        window.__mappa = next;
        return { ok: true, enabled: false, autoApprove: Object.assign({}, next), proberWhenIdle: false, routinesEnabled: true };
      }
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadSessions());
  return page;
}

const cambia = (page, id, checked) => page.evaluate(([i, c]) => {
  const el = document.getElementById(i);
  el.checked = c;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, checked]);

test('una richiesta che resta appesa non trattiene la scelta successiva su un altro campo', async ({ openTab }) => {
  const page = await apri(openTab);
  // Il numero resta appeso (rete che non risponde), l'owner esclude l'account A.
  await page.evaluate(() => { window.__delaySet = [20000, 0]; });
  await page.locator('#mgMaxSessions').fill('7');
  await page.locator('#mgMaxSessionsSave').click();
  await cambia(page, 'mgAccountA', false);
  // L'esclusione di A deve arrivare al server senza aspettare il numero.
  await expect.poll(() => page.evaluate(() => window.__doc.accountAOff === true), { timeout: 3000 }).toBe(true);
  await expect(page.locator('#mgAccountsMsg')).toHaveText('Salvato.');
});

test('due interruttori dell\'auto-approvazione toccati di fila restano entrambi come scelti', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => { window.__delayAuto = [600, 0]; });
  await cambia(page, 'mgAutoApproveOwner', false);
  await cambia(page, 'mgAutoApproveUser', false);
  await page.waitForTimeout(1500);
  const mappa = await page.evaluate(() => window.__mappa);
  expect(mappa.owner).toBe(false);
  expect(mappa.user).toBe(false);
  await expect(page.locator('#mgAutoApproveOwner')).not.toBeChecked();
  await expect(page.locator('#mgAutoApproveUser')).not.toBeChecked();
});

test('un numero riscritto dopo Salva non si vede accanto a «Salvato.»', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => { window.__delaySet = [600]; });
  await page.locator('#mgMaxSessions').fill('7');
  await page.locator('#mgMaxSessionsSave').click();
  await page.locator('#mgMaxSessions').fill('9');
  await page.waitForTimeout(1200);
  const doc = await page.evaluate(() => window.__doc.maxSessions);
  expect(doc).toBe(7);
  await page.screenshot({ path: 'tests/.shots/675-numero-riscritto.png' });
  // Il campo dice 9, il server 7: «Salvato.» lì accanto parla di un numero che non c'è.
  await expect(page.locator('#mgMaxSessionsMsg')).not.toHaveText('Salvato.');
});
