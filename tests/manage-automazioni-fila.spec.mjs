// Gestione → Automazioni: due scelte a poca distanza arrivano al server e restano
// sullo schermo come fatte, qualunque sia l'ordine delle risposte (#675).
// Il finto server copia il main: legge, scrive, rilegge, e ogni passo può tardare.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

async function apri(openTab) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo && window.SN_ROUTINE_SESSIONI);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await page.evaluate(() => {
    const attesa = (ms) => new Promise((r) => setTimeout(r, ms || 0));
    window.__auto = {
      enabled: false, routinesEnabled: true, proberWhenIdle: false,
      autoApprove: { owner: true, filo: true, claude: true, user: true },
    };
    window.__doc = { maxSessions: 4, priorityAccount: '', accountAOff: false, accountBOff: false };
    window.__passi = [];
    window.__arrivate = 0;
    const RS = window.SN_ROUTINE_SESSIONI;
    const foto = () => JSON.parse(JSON.stringify(window.__auto));
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_get') return Object.assign({ ok: true }, foto());
      if (msg && msg.type === 'automation_set') {
        const p = window.__passi.shift() || {};
        await attesa(p.prima);
        const a = window.__auto;
        if (typeof msg.enabled === 'boolean') a.enabled = msg.enabled;
        let istantanea = foto();
        if (msg.autoApprove) {
          // Come il main: rilegge la mappa intera e la riscrive intera.
          const letta = Object.assign({}, a.autoApprove);
          await attesa(p.rmw);
          a.autoApprove = Object.assign(letta, msg.autoApprove);
          istantanea = foto();
        }
        if (typeof msg.routinesEnabled === 'boolean') { a.routinesEnabled = msg.routinesEnabled; istantanea = foto(); }
        if (typeof msg.proberWhenIdle === 'boolean') { a.proberWhenIdle = msg.proberWhenIdle; istantanea = foto(); }
        await attesa(p.dopo);
        window.__arrivate += 1;
        return Object.assign({ ok: true }, istantanea);
      }
      if (msg && msg.type === 'automation_sessions_get') return Object.assign({ ok: true }, RS.leggiDoc(window.__doc));
      if (msg && msg.type === 'automation_sessions_set') {
        const p = window.__passi.shift() || {};
        await attesa(p.prima);
        Object.assign(window.__doc, RS.valida(msg).valori);
        const istantanea = Object.assign({ ok: true }, RS.leggiDoc(window.__doc));
        await attesa(p.dopo);
        window.__arrivate += 1;
        return istantanea;
      }
      return orig(msg);
    };
  });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => Promise.all([window.__mgTest.loadAutoMode(), window.__mgTest.loadSessions()]));
  return page;
}

const cambia = (page, id, checked) => page.evaluate(([i, c]) => {
  const el = document.getElementById(i);
  el.checked = c;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [id, checked]);

const arrivate = (page, n) => expect.poll(() => page.evaluate(() => window.__arrivate)).toBe(n);

test('due interruttori dell\'auto-approvazione spenti di fila restano spenti tutti e due', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => { window.__passi = [{ rmw: 600 }, {}]; });

  await cambia(page, 'mgAutoApproveOwner', false);
  await cambia(page, 'mgAutoApproveUser', false);

  await arrivate(page, 2);
  expect(await page.evaluate(() => window.__auto.autoApprove)).toMatchObject({ owner: false, user: false });
  await expect(page.locator('#mgAutoApproveOwner')).not.toBeChecked();
  await expect(page.locator('#mgAutoApproveUser')).not.toBeChecked();
});

test('la risposta dell\'interruttore generale non riaccende un mittente spento nel frattempo', async ({ openTab }) => {
  const page = await apri(openTab);
  // L'interruttore generale fotografa la mappa subito e risponde tardi; lo
  // spegnimento di «Altri utenti» parte dopo e arriva prima.
  await page.evaluate(() => { window.__passi = [{ dopo: 800 }, {}]; });

  await cambia(page, 'mgAutoToggle', true);
  await cambia(page, 'mgAutoApproveUser', false);

  await arrivate(page, 2);
  expect(await page.evaluate(() => window.__auto)).toMatchObject({ enabled: true, autoApprove: { user: false } });
  await expect(page.locator('#mgAutoApproveUser')).not.toBeChecked();
  await expect(page.locator('#mgAutoToggle')).toBeChecked();
});

test('due clic in fretta sulle routine autonome: vince l\'ultimo, sul server e sullo schermo', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => { window.__passi = [{ prima: 600 }, {}]; });

  await cambia(page, 'mgRoutinesToggle', false);
  await cambia(page, 'mgRoutinesToggle', true);

  await arrivate(page, 2);
  expect(await page.evaluate(() => window.__auto.routinesEnabled)).toBe(true);
  await expect(page.locator('#mgRoutinesToggle')).toBeChecked();
  await expect(page.locator('#mgRoutinesMsg')).toHaveText('Salvato.');
});

test('sessioni: una risposta che ha letto prima di una scrittura non la cancella arrivando dopo', async ({ openTab }) => {
  const page = await apri(openTab);
  // Il numero si scrive tardi ma risponde subito dopo; l'account si scrive
  // subito, fotografa il documento col numero vecchio e risponde per ultimo.
  await page.evaluate(() => { window.__passi = [{ prima: 300 }, { dopo: 700 }]; });

  await page.locator('#mgMaxSessions').fill('7');
  await page.locator('#mgMaxSessionsSave').click();
  await cambia(page, 'mgAccountA', false);

  await arrivate(page, 2);
  expect(await page.evaluate(() => window.__doc)).toMatchObject({ maxSessions: 7, accountAOff: true });
  await expect(page.locator('#mgMaxSessions')).toHaveValue('7');
  await expect(page.locator('#mgAccountA')).not.toBeChecked();
  await expect(page.locator('#mgMaxSessionsMsg')).toHaveText('Salvato.');
});
