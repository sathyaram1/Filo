// Verifica #1344, giro 1: porte provate e chiuse, le strade che lo spec del lavoro non prova (crediti finiti e funzione senza modello
// sulle stesse superfici, tema chiaro).

import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi, clicca, scrivi } from '../../helpers/riquadri.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SHOTS = 'tests/.shots';

async function creditiFiniti(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'k-test' } });
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    const boom = () => {
      const e = new Error('OpenRouter 402: {"error":{"message":"Insufficient credits"}}');
      e.status = 402; e.provider = 'openrouter';
      throw e;
    };
    globalThis.SN_PROVIDER_OPENROUTER = { ...P, streamComplete: boom, complete: boom };
  });
}

async function senzaModello(app, azione) {
  await app.evaluate(async (_e, a) => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      models: { ...globalThis.SN_TEST_MODELS.models, [a]: '' },
    });
  }, azione);
}

const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .flatMap((w) => (w._filoTabs ? w._filoTabs.tabs : []))
  .map((t) => t.view.webContents.getURL()));
const aperta = async (app, inizio) => (await schede(app)).some((u) => u.startsWith(inizio));
async function siApre(app, inizio) {
  await expect.poll(() => aperta(app, inizio), { timeout: 15_000 }).toBe(true);
}

async function spiegaParola(app, testServer, openTab, tema) {
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Parola</title>'
    + '<p id="t" style="font:18px sans-serif;margin:120px 40px">La fotosintesi trasforma la luce.</p>');
  if (tema) await page.evaluate((t) => { document.documentElement.dataset.snTheme = t; }, tema);
  await page.evaluate(() => {
    const n = document.querySelector('#t').firstChild;
    const r = document.createRange();
    r.setStart(n, 3); r.setEnd(n, 14);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.locator('#t').click({ button: 'right', position: { x: 60, y: 8 } });
  return page;
}

test('parola coi crediti finiti: «Apri Crediti» sotto la spiegazione', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await creditiFiniti(app);
  const page = await spiegaParola(app, testServer, openTab, 'light');
  const sezione = menuDi(page).locator('.sn-menu-inline-explain');
  await expect(sezione).toHaveClass(/sn-menu-inline-error/, { timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/1344-parola-crediti-chiaro.png` }).catch(() => {});
  await expect(sezione.locator('.sn-msg-rimedio')).toHaveText('Apri Crediti');
  await sezione.locator('.sn-msg-rimedio').click();
  await siApre(app, 'filo://credits');
});

test('parola con la spiegazione senza modello: «Apri Opzioni»', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await senzaModello(app, 'explain');
  const page = await spiegaParola(app, testServer, openTab, 'dark');
  const sezione = menuDi(page).locator('.sn-menu-inline-explain');
  await expect(sezione).toHaveClass(/sn-menu-inline-error/, { timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/1344-parola-senza-modello.png` }).catch(() => {});
  await expect(sezione.locator('.sn-msg-rimedio')).toHaveText('Apri Opzioni');
  await sezione.locator('.sn-msg-rimedio').click();
  await siApre(app, 'filo://options');
});

async function modifica(app, page) {
  await page.locator('#campo').click();
  await page.evaluate(() => { const t = document.querySelector('#campo'); t.focus(); t.select(); });
  await page.locator('#campo').click({ button: 'right' });
  await menuDi(page).voce('Modifica').click();
  await expect.poll(async () => (await statoDi(app, page, '.sn-editbox'))?.visibile, { timeout: 10_000 }).toBe(true);
  await scrivi(app, page, '.sn-editbox-instruction', 'rendilo più corto');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await statoDi(app, page, '.sn-editbox-proposed'))?.classi || '', { timeout: 30_000 })
    .toContain('sn-editbox-errore');
}
const CAMPO = '<!doctype html><meta charset="utf-8"><title>Modulo</title>'
  + '<textarea id="campo" style="margin:120px 40px;width:400px;height:80px;font:16px sans-serif">Un testo con un erore.</textarea>';

test('Modifica coi crediti finiti, tema chiaro: «Apri Crediti»', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await creditiFiniti(app);
  const page = await testServer.openReady(openTab, CAMPO);
  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'light'; });
  await modifica(app, page);
  await page.screenshot({ path: `${SHOTS}/1344-modifica-crediti-chiaro.png` }).catch(() => {});
  const tasto = await statoDi(app, page, '.sn-editbox .sn-msg-rimedio');
  expect(tasto?.testo).toBe('Apri Crediti');
  await clicca(app, page, '.sn-editbox .sn-msg-rimedio');
  await siApre(app, 'filo://credits');
});

test('Modifica senza modello: «Apri Opzioni»', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await senzaModello(app, 'edit_text');
  const page = await testServer.openReady(openTab, CAMPO);
  await modifica(app, page);
  const tasto = await statoDi(app, page, '.sn-editbox .sn-msg-rimedio');
  expect(tasto?.testo).toBe('Apri Opzioni');
  await clicca(app, page, '.sn-editbox .sn-msg-rimedio');
  await siApre(app, 'filo://options');
});

test('Traduci la pagina senza modello: l’avviso porta alle Opzioni', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await senzaModello(app, 'translate_page');
  const page = await testServer.openReady(openTab, '<!doctype html><html lang="en"><meta charset="utf-8"><title>Article</title>'
    + '<p id="p1" style="margin:80px 40px">The quick brown fox jumps over the lazy dog, again and again, in the morning light.</p>');
  await page.locator('#p1').click({ button: 'right', position: { x: 5, y: 5 } });
  await menuDi(page).icona('translate').click();
  const avviso = page.locator('.sn-toast', { hasText: 'Opzioni' }).first();
  await expect(avviso).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/1344-traduzione-senza-modello.png` }).catch(() => {});
  await expect(avviso.locator('.sn-msg-rimedio')).toHaveText('Apri Opzioni');
});

test('chat dell’Editor senza modello: «Apri Opzioni»', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await senzaModello(app, 'editor_chat');
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-module[data-type="switch"]');
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('.ed-module[data-type="chat"]');
  const input = page.locator('.ed-module[data-type="chat"] [data-chat="input"]');
  await input.click();
  await input.fill('di cosa parla?');
  await input.press('Enter');
  await expect(page.locator('.ed-chat-msg.assistant.errore')).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/1344-editor-senza-modello.png` }).catch(() => {});
  await expect(page.locator('.ed-chat-rimedio')).toHaveText('Apri Opzioni');
  await page.locator('.ed-chat-rimedio').click();
  await siApre(app, 'filo://options');
});

test('chat della home senza modello: «Apri Opzioni» in evidenza', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const deadline = Date.now() + 10_000;
  let page = null;
  while (!page && Date.now() < deadline) {
    page = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null;
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  await expect(page.locator('#input')).toBeVisible();
  await senzaModello(app, 'filo_chat');
  await page.locator('#input').fill('ciao');
  await page.locator('#sendBtn').click();
  const principale = page.locator('.dash-bubble-actions .dash-action-btn-primary').last();
  await expect(principale).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: `${SHOTS}/1344-home-senza-modello.png` }).catch(() => {});
  await expect(principale).toHaveText('Apri Opzioni');
  await principale.click();
  await siApre(app, 'filo://options');
});
