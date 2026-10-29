// #1340, giro 4, rilievo 1: spostato il pannello dell'Aiuto (dalla testata, o perché un avviso della barra lo alza),
// il microfono e il documento trovato si fermano sempre come coperti, senza nessun velo del sito.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { cartellaDellaProva, BOLLETTA_MARZO } from '../../helpers/documentiFinti.mjs';
import { confermaSopraPagina, clickConfirm } from '../../helpers/confirm.mjs';
import { nelMondoDiFilo } from '../../helpers/riquadri.mjs';

const pagina = (corpo = '<h1>Un sito</h1>') => `<!doctype html><html><head><meta charset="utf-8"><title>Fornitore Energia</title></head><body style="padding:40px;font:16px sans-serif">${corpo}</body></html>`;
const avvisoCoperto = (page) => page.locator('.sn-toast', { hasText: 'L\'Aiuto era coperto' });
async function apriAiuto(shell, page) {
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8_000 });
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
}
const contaAscolti = (app, page) => nelMondoDiFilo(app, page, () => {
  globalThis.__ascolti = 0;
  globalThis.SN_ASCOLTO.avvia = async () => { globalThis.__ascolti += 1; return null; };
  return true;
});
const ascolti = (app, page) => nelMondoDiFilo(app, page, () => globalThis.__ascolti);
async function centro(locator) {
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function sposta(page, dx, dy) {
  const h = await page.locator('.sn-sidebar-header').boundingBox();
  await page.mouse.move(h.x + 30, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 30 + dx, h.y + h.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
}

test('r1 il microfono dell\'Aiuto spostato dalla testata parte al clic', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina());
  await apriAiuto(shell, page);
  await contaAscolti(app, page);
  await page.waitForTimeout(1500);
  await sposta(page, -120, 60);
  await page.waitForTimeout(2000);
  const p = await centro(page.locator('.sn-sidebar .sn-voce-btn'));
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(800);
  expect(await avvisoCoperto(page).count(), 'nessun velo: niente avviso').toBe(0);
  expect(await ascolti(app, page)).toBe(1);
});

test('r1 il microfono dell\'Aiuto alzato da un avviso della barra parte al clic', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, pagina());
  await apriAiuto(shell, page);
  await contaAscolti(app, page);
  await page.waitForTimeout(1500);
  // Come fa Filo quando un avviso compare nell'angolo della barra.
  await page.addStyleTag({ content: ':root:root{--filo-avvisi-barra:140px!important}' });
  await page.waitForTimeout(2000);
  const p = await centro(page.locator('.sn-sidebar .sn-voce-btn'));
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(800);
  expect(await avvisoCoperto(page).count(), 'nessun velo: niente avviso').toBe(0);
  expect(await ascolti(app, page)).toBe(1);
});

async function aiutoFinto(app, risposte) {
  await app.evaluate(async (_e, risposte) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const risposta = ({ attempts, messages }) => {
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return { text: '{"message":"Ciao.","suggestions":[],"issues":[]}', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const ultimo = JSON.stringify([...messages].reverse().find((m) => m.role === 'user') || '');
      const scelta = risposte.find(([parola]) => ultimo.includes(parola)) || risposte[risposte.length - 1];
      return { text: scelta[1], model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => risposta(o);
    globalThis.__trascinati = [];
  }, risposte);
  await app.evaluate(({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) wc.startDrag = (item) => { globalThis.__trascinati.push(item.file); };
  });
}

test('r1 il documento trovato dall\'Aiuto, col pannello spostato, si trascina', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const dir = join(await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR), 'Scansioni');
  cartellaDellaProva(dir);
  const bolletta = join(dir, BOLLETTA_MARZO);
  const page = await testServer.openReady(openTab, pagina('<h1>Carica la tua bolletta</h1><input type="file" id="bolletta">'));
  await aiutoFinto(app, [
    ['ho cercato fra i documenti', JSON.stringify({ text: 'Eccola: trascinala nel campo «Bolletta».', file: 1, status: 'done' })],
    ['', JSON.stringify({ action: 'documenti', cosa: 'bolletta luce marzo', text: 'La cerco fra i tuoi documenti.' })],
  ]);
  await apriAiuto(shell, page);
  await page.fill('.sn-sidebar-input textarea', 'mi serve la bolletta della luce di marzo');
  await page.press('.sn-sidebar-input textarea', 'Enter');
  await clickConfirm(await confermaSopraPagina(app, { timeout: 20_000 }), 'ok');
  const file = page.locator('.sn-sidebar .sn-sidebar-file');
  await expect(file).toHaveCount(1, { timeout: 20_000 });
  await page.waitForTimeout(1500);
  await sposta(page, -150, 40);
  await page.waitForTimeout(2000);
  const box = await file.boundingBox();
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + box.height / 2 + 30, { steps: 6 });
  await page.mouse.move(box.x - 200, box.y - 200, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  expect(await avvisoCoperto(page).count(), 'nessun velo: niente avviso').toBe(0);
  await expect.poll(() => app.evaluate(() => globalThis.__trascinati)).toEqual([bolletta]);
});
