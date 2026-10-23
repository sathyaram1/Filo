// #841 — chiedere a Filo di spegnere l'Aiuto lo spegne davvero: la voce sparisce dal tasto destro sulla pagina e
// sulla linguetta, Alt+H non apre il pannello (e dice perché); riacceso, tutto torna. Lo stesso interruttore, con
// quelli del correttore e delle categorie, sta in Preferenze. Un file di dati vecchio (spento di serie) lo trova acceso.

import { test as base, expect, chiudiApp, argomentiScala } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { statoDi } from './helpers/riquadri.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// `semeDisco`: lo storage.json con cui parte l'app, come lo lascia una versione di prima.
const test = base.extend({
  semeDisco: [null, { option: true }],
  app: async ({ semeDisco }, use) => {
    const userData = cartellaTemporanea('filo-test-');
    if (semeDisco) writeFileSync(join(userData, 'storage.json'), JSON.stringify(semeDisco));
    const app = await electron.launch({
      args: [...argomentiScala, '.'],
      cwd: APP_ROOT,
      env: { ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' },
    });
    await use(app);
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  },
});

const PAGINA = '<!doctype html><title>Pagina qualunque</title><body style="margin:0;padding:24px;font:16px sans-serif"><p id="p">Un paragrafo dove fare tasto destro.</p></body>';

const chiedi = (app, valore) => app.evaluate((_e, v) =>
  globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_PREFERENZA', chiave: 'aiuto', valore: v }), valore);

const impostazioni = (app) => app.evaluate(() => globalThis.SN_STORAGE.getSettings());

async function apriPagina(openTab, testServer) {
  const page = await openTab(testServer.html(PAGINA));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
  return page;
}

// Le voci del tasto destro sulla pagina, aperto e richiuso.
async function vociPagina(page) {
  await page.locator('#p').click({ button: 'right' });
  const menu = menuDi(page).locator('.sn-menu[role=menu]');
  await expect(menu).toBeVisible();
  const voci = await menu.locator('.sn-menu-item .sn-menu-label').allTextContents();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  return voci;
}

// Il menu della linguetta aperto col tasto destro sulla scheda attiva: c'è la voce Aiuto? null finché il riquadro
// del menu non si legge. Il riquadro si riusa, quindi chi aspetta un cambio ripete finché la lettura lo mostra.
async function linguettaHaAiuto(app, shell) {
  await shell.evaluate(() => {
    const el = document.querySelector('.tab.active');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  });
  await new Promise((r) => setTimeout(r, 250));
  for (const w of app.windows()) {
    try {
      const voci = await w.evaluate(() => {
        if (!document.body || !document.body.innerText.includes('Duplica')) return null;
        const v = [...document.querySelectorAll('button.item')].map((b) => b.textContent.trim());
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return v;
      });
      if (voci) return voci.includes('Aiuto');
    } catch (_) {}
  }
  return null;
}

function premiAltH(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const wc = w._filoTabs.tabs.find((t) => t.id === w._filoTabs.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'H', modifiers: ['alt'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'H', modifiers: ['alt'] });
  });
}

const vocesulMenuApp = (app) => app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('assistente-laterale')?.visible);

test('«spegni l\'Aiuto» lo toglie da tasto destro, linguetta e Alt+H; «riaccendilo» lo rimette', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await apriPagina(openTab, testServer);
  expect(await vociPagina(page)).toContain('Aiuto');
  await expect.poll(() => linguettaHaAiuto(app, shell), { timeout: 15_000 }).toBe(true);
  expect(await vocesulMenuApp(app)).toBe(true);

  const r = await chiedi(app, 'spento');
  expect(r.executed).toBe(true);
  await expect.poll(async () => (await impostazioni(app)).featureFlags.help).toBe(false);

  await expect.poll(() => vociPagina(page)).not.toContain('Aiuto');
  await expect.poll(() => linguettaHaAiuto(app, shell), { timeout: 15_000 }).toBe(false);
  await expect.poll(() => vocesulMenuApp(app)).toBe(false);

  await premiAltH(app);
  await expect.poll(async () => (await statoDi(app, page, '.sn-toast'))?.testo || '').toContain('L\'Aiuto è spento');
  // Nemmeno la strada della linguetta (un menu rimasto aperto da prima) apre il pannello.
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await page.waitForTimeout(600);
  await expect(page.locator('.sn-sidebar')).toHaveCount(0);

  expect((await chiedi(app, 'acceso')).executed).toBe(true);
  await expect.poll(() => vociPagina(page)).toContain('Aiuto');
  await expect.poll(() => linguettaHaAiuto(app, shell), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => vocesulMenuApp(app)).toBe(true);
  await premiAltH(app);
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8000 });
});

test('spento con il pannello aperto, il pannello se ne va', async ({ app, openTab, testServer }) => {
  const page = await apriPagina(openTab, testServer);
  await premiAltH(app);
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8000 });
  expect((await chiedi(app, 'spento')).executed).toBe(true);
  await expect(page.locator('.sn-sidebar')).toHaveCount(0, { timeout: 8000 });
});

test('sotto l\'avviso del sito, da spento Alt+H e la linguetta dicono perché nella cornice', async ({ app, shell, openTab, testServer }) => {
  await apriPagina(openTab, testServer);
  await chiedi(app, 'spento');
  await expect.poll(async () => (await impostazioni(app)).featureFlags.help).toBe(false);
  // L'avviso vero chiede un sito finto in lista: qui basta che la scheda risulti coperta.
  await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    const tab = tm.tabs.find((t) => t.id === tm.activeId);
    tm.avvisoSito.coperta = () => tab;
  });
  // Le carte della cornice si disegnano in un riquadro sopra le pagine: la cornice ne tiene l'elenco.
  const avvisi = () => shell.evaluate(() => [...document.querySelectorAll('#shell-notifs > .shell-notif')].filter((c) => c.textContent.includes('L\'Aiuto è spento')).length);
  await premiAltH(app);
  await expect.poll(avvisi, { timeout: 8000 }).toBe(1);
  await shell.evaluate(() => document.querySelectorAll('#shell-notifs > .shell-notif').forEach((c) => c.remove()));
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await expect.poll(avvisi, { timeout: 8000 }).toBe(1);
});

test('in Preferenze ci sono i tre interruttori: cambiano le stesse impostazioni della chat e seguono la chat', async ({ app, openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  const aiuto = page.locator('#aiutoAcceso');
  const correttore = page.locator('#correttoreAcceso');
  const categorie = page.locator('#categorieAutomatiche');
  await expect(aiuto).toBeChecked();
  await expect(correttore).toBeChecked();
  await expect(categorie).not.toBeChecked();

  // Dalla chat: la pagina aperta si aggiorna da sola.
  await chiedi(app, 'spento');
  await expect(aiuto).not.toBeChecked();
  await chiedi(app, 'acceso');
  await expect(aiuto).toBeChecked();

  // Dalla pagina: cambia la stessa impostazione che legge la chat.
  await aiuto.uncheck();
  await expect.poll(async () => (await impostazioni(app)).featureFlags.help).toBe(false);
  await correttore.uncheck();
  await expect.poll(async () => (await impostazioni(app)).featureFlags.spellcheck).toBe(false);
  await categorie.check();
  await expect.poll(async () => (await impostazioni(app)).featureFlags.categorize).toBe(true);
  await aiuto.check();
  await expect.poll(async () => (await impostazioni(app)).featureFlags).toMatchObject({ help: true, spellcheck: false, categorize: true });

  await page.reload();
  await expect(aiuto).toBeChecked();
  await expect(correttore).not.toBeChecked();
  await expect(categorie).toBeChecked();
});

const VECCHIE = { theme: 'dark', featureFlags: { help: false, categorize: false, spellcheck: true } };

test.describe('un file di dati di prima, con l\'Aiuto spento perché era il valore di serie', () => {
  test.use({ semeDisco: { settings: VECCHIE, filo_onboarding: { done: true } } });
  test('lo trova acceso, senza un cambio inventato nel filo', async ({ app, openTab, testServer }) => {
    const page = await apriPagina(openTab, testServer);
    expect(await vociPagina(page)).toContain('Aiuto');
    const s = await impostazioni(app);
    expect(s.featureFlags.help).toBe(true);
    expect(s.theme).toBe('dark');
    const registro = await app.evaluate(async () => globalThis.SN_REGISTRO_CAMBI.lista());
    expect(JSON.stringify(registro)).not.toContain('featureFlags.help');
  });
});

test.describe('un file di dati di prima dove l\'Aiuto l\'aveva spento l\'utente', () => {
  test.use({
    semeDisco: {
      settings: VECCHIE,
      filo_onboarding: { done: true },
      filo_cambi: [
        { id: 'c1', ts: '2026-09-01T10:00:00.000Z', tipo: 'impostazioni', via: 'chat', cambi: [{ chiave: 'featureFlags.help', prima: false, dopo: true }] },
        { id: 'c2', ts: '2026-09-02T10:00:00.000Z', tipo: 'impostazioni', via: 'chat', cambi: [{ chiave: 'featureFlags.help', prima: true, dopo: false }] },
      ],
    },
  });
  test('lo trova spento', async ({ app, openTab, testServer }) => {
    const page = await apriPagina(openTab, testServer);
    expect(await vociPagina(page)).not.toContain('Aiuto');
    expect((await impostazioni(app)).featureFlags.help).toBe(false);
  });
});
