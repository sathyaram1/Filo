// Verifica #968 giro 1: esplorazione avversariale delle virgolette nel terminale della home.
import { test, expect } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win).toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#input')).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => win.evaluate(() => window.SN_DASH_TERMINALE?.isEnabled?.() === true), { timeout: 8_000 }).toBe(true);
  return win;
}

async function submitInput(page, value) {
  await page.evaluate((v) => {
    const input = document.getElementById('input');
    input.value = v;
    document.getElementById('inputForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, value);
}

async function incolla(app, page, testo) {
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), testo);
  await page.keyboard.press('ControlOrMeta+V');
}

function prepara() {
  const dir = cartellaTemporanea('filo-v968-');
  const cartella = path.join(dir, 'Nome Cognome');
  mkdirSync(cartella);
  writeFileSync(path.join(cartella, 'dentro-968.txt'), 'contenuto-968');
  const strana = path.join(dir, "l'archivio $HOME (1)");
  mkdirSync(strana);
  writeFileSync(path.join(strana, 'strano-968.txt'), 'x');
  return { dir, cartella, strana };
}

test('incollato in mezzo, prima di altre opzioni', async ({ app }) => {
  const { cartella } = prepara();
  const page = await newtabPage(app);
  const input = page.locator('#input');
  await input.click();
  await input.fill('/ls  -a');
  await page.evaluate(() => { const el = document.getElementById('input'); el.setSelectionRange(4, 4); });
  await incolla(app, page, cartella);
  await expect(input).toHaveValue(`/ls "${cartella}" -a`, { timeout: 8_000 });
  const cur = await page.evaluate(() => document.getElementById('input').selectionEnd);
  expect(cur).toBe(`/ls "${cartella}"`.length);
  await page.keyboard.press('Enter');
  await expect(page.locator('.dash-term-out').last()).toContainText('dentro-968.txt', { timeout: 15_000 });
});

test('nome con apostrofo, dollaro e parentesi', async ({ app }) => {
  const { strana } = prepara();
  const page = await newtabPage(app);
  const input = page.locator('#input');
  await input.click();
  await input.fill('/ls ');
  await incolla(app, page, strana);
  await expect.poll(() => input.inputValue(), { timeout: 8_000 }).not.toBe(`/ls ${strana}`);
  await page.keyboard.press('Enter');
  await expect(page.locator('.dash-term-out').last()).toContainText('strano-968.txt', { timeout: 15_000 });
});

test('relativo alla cartella del terminale, e selezione sostituita', async ({ app }) => {
  const { dir } = prepara();
  const page = await newtabPage(app);
  const input = page.locator('#input');
  await submitInput(page, `/cd "${dir}"`);
  await expect(page.locator('#dashDir')).toHaveText(dir, { timeout: 12_000 });
  await input.click();
  await input.fill('/cat XXX');
  await page.evaluate(() => { const el = document.getElementById('input'); el.setSelectionRange(5, 8); });
  await incolla(app, page, 'Nome Cognome/dentro-968.txt');
  await expect(input).toHaveValue('/cat "Nome Cognome/dentro-968.txt"', { timeout: 8_000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('.dash-term-out').last()).toContainText('contenuto-968', { timeout: 15_000 });
});

test('si scrive subito dopo aver incollato', async ({ app }) => {
  const { cartella } = prepara();
  const page = await newtabPage(app);
  const input = page.locator('#input');
  await input.click();
  await input.fill('/ls ');
  await incolla(app, page, cartella);
  await page.keyboard.type(' -a', { delay: 0 });
  await expect(input).toHaveValue(`/ls "${cartella}" -a`, { timeout: 8_000 });
});

test('proposta: file in sottocartella e percorso assoluto, il tasto la esegue', async ({ app }) => {
  const { dir, cartella } = prepara();
  const page = await newtabPage(app);
  await submitInput(page, `/cd "${dir}"`);
  await expect(page.locator('#dashDir')).toHaveText(dir, { timeout: 12_000 });
  await submitInput(page, '/cat Nome Cognome/dentro-968.txt');
  const proposta = page.locator('.dash-term-proposta');
  await expect(proposta).toHaveCount(1, { timeout: 12_000 });
  await expect(proposta.locator('.dash-term-proposta-cmd')).toHaveText('/ cat "Nome Cognome/dentro-968.txt"');
  await submitInput(page, `/ls ${cartella}`);
  await expect(proposta).toHaveCount(2, { timeout: 12_000 });
  await expect(proposta.last().locator('.dash-term-proposta-cmd')).toHaveText(`/ ls "${cartella}"`);
  await proposta.first().locator('.dash-term-proposta-esegui').click();
  await expect(page.locator('.dash-term-out').last()).toContainText('contenuto-968', { timeout: 15_000 });
  await page.screenshot({ path: 'tests/.shots/v968-proposte.png' }).catch(() => {});
});

test('testo enorme incollato: niente blocco', async ({ app }) => {
  const page = await newtabPage(app);
  const input = page.locator('#input');
  await input.click();
  await input.fill('/echo ');
  const lungo = 'a b '.repeat(5000);
  await incolla(app, page, lungo);
  await expect(input).toHaveValue(`/echo ${lungo}`);
  await submitInput(page, `/ls ${'x '.repeat(3000)}`);
  await expect(page.locator('.dash-term-exit').last()).toBeVisible({ timeout: 20_000 });
});
