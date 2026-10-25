// #968 — Terminale della home: un percorso con spazi incollato nel comando prende le virgolette prima dell'Invio,
// e sotto un comando fallito per quelle mancanti c'è la versione giusta, da lanciare con un clic. Si asserisce il
// successo visto dall'utente: la riga che vede, e il comando che parte (l'elenco della cartella, la cartella nuova).

import { test, expect } from './fixtures/electron.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { clickConfirm } from './helpers/confirm.mjs';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata entro 10s').toBeTruthy();
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

// Una cartella «Nome Cognome» con un file dentro, in una temporanea che ha già uno spazio nel nome.
function preparaCartelle() {
  const dir = cartellaTemporanea('filo-virgolette-');
  const cartella = path.join(dir, 'Nome Cognome');
  mkdirSync(cartella);
  writeFileSync(path.join(cartella, 'dentro-968.txt'), 'x');
  return { dir, cartella };
}

async function incolla(app, page, testo) {
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), testo);
  await page.keyboard.press('ControlOrMeta+V');
}

test('#968: incollato dopo il comando, il percorso con spazi ha le virgolette prima dell\'Invio e il comando gira', async ({ app }) => {
  const { cartella } = preparaCartelle();
  const page = await newtabPage(app);
  const input = page.locator('#input');

  await input.click();
  await input.fill('/ls ');
  await incolla(app, page, cartella);
  await expect(input).toHaveValue(`/ls "${cartella}"`, { timeout: 8_000 });
  await page.screenshot({ path: 'tests/.shots/968-incollato.png' }).catch(() => {});

  // Le virgolette aggiunte si tolgono come ogni altra modifica: un Ctrl+Z.
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(input).toHaveValue(`/ls ${cartella}`);

  await input.fill('/ls ');
  await incolla(app, page, cartella);
  await expect(input).toHaveValue(`/ls "${cartella}"`, { timeout: 8_000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('.dash-term-out').last()).toContainText('dentro-968.txt', { timeout: 15_000 });
  await expect(page.locator('.dash-term-cmd').last()).toContainText(`ls "${cartella}"`);
});

test('#968: fuori da un comando, o con un percorso che non esiste, quello che incolli resta com\'è', async ({ app }) => {
  const { dir, cartella } = preparaCartelle();
  const page = await newtabPage(app);
  const input = page.locator('#input');

  await input.click();
  await input.fill('');
  await incolla(app, page, cartella);
  await expect(input).toHaveValue(cartella);

  const inventato = path.join(dir, 'Mario Rossi');
  await input.fill('/ls ');
  await incolla(app, page, inventato);
  await expect(input).toHaveValue(`/ls ${inventato}`);
  // Un percorso che esiste, incollato subito dopo nella stessa riga, le prende: la risposta per l'altro era arrivata.
  await input.press('End');
  await page.keyboard.type(' ');
  await incolla(app, page, cartella);
  await expect(input).toHaveValue(`/ls ${inventato} "${cartella}"`, { timeout: 8_000 });
});

test('#968: anche l\'Incolla del menu di Filo e un testo trascinato nella barra prendono le virgolette', async ({ app }) => {
  const { cartella } = preparaCartelle();
  const page = await newtabPage(app);
  const input = page.locator('#input');

  // Come scrive l'Incolla del menu (insertTextAtSelection in src/content/actions.js): valore e un `input` col testo.
  await input.click();
  await input.fill('/ls ');
  await page.evaluate((t) => {
    const el = document.getElementById('input');
    const start = el.value.length;
    el.value = el.value + t;
    el.setSelectionRange(start + t.length, start + t.length);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: t }));
  }, cartella);
  await expect(input).toHaveValue(`/ls "${cartella}"`, { timeout: 8_000 });

  await input.fill('/ls');
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    const el = document.getElementById('input');
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    document.getElementById('inputForm').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, cartella);
  await expect(input).toHaveValue(`/ls "${cartella}"`, { timeout: 8_000 });
});

test('#968: al posto del programma il percorso fra virgolette è un comando che esiste, e parte', async ({ app }) => {
  const { dir } = preparaCartelle();
  const windows = process.platform === 'win32';
  const programma = path.join(dir, windows ? 'lancia me.cmd' : 'lancia me.sh');
  writeFileSync(programma, windows ? '@echo eseguito-968\r\n' : '#!/bin/sh\necho eseguito-968\n');
  if (!windows) chmodSync(programma, 0o755);
  const page = await newtabPage(app);
  const input = page.locator('#input');

  await input.click();
  await input.fill('/');
  await incolla(app, page, programma);
  // Su Windows la shell di serie è PowerShell, che una stringa da sola la stampa: davanti ci vuole &.
  await expect(input).toHaveValue(windows ? `/& "${programma}"` : `/"${programma}"`, { timeout: 8_000 });
  await expect(input).toHaveClass(/is-cmd-shell/, { timeout: 12_000 });
  await page.keyboard.press('Enter');
  // Un programma che il terminale non riconosce chiede prima; incollato, vuole la parola «conferma» (#892.1).
  await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'danger');
  await expect(page.locator('.dash-term-out').last()).toContainText('eseguito-968', { timeout: 15_000 });
});

test('#968: un comando fallito per le virgolette mancanti propone la versione giusta, e il tasto la esegue', async ({ app }) => {
  const { dir, cartella } = preparaCartelle();
  const page = await newtabPage(app);
  const input = page.locator('#input');

  await submitInput(page, `/cd "${dir}"`);
  await expect(page.locator('#dashDir')).toHaveText(dir, { timeout: 12_000 });

  // Un errore che non c'entra con le virgolette non propone niente.
  await submitInput(page, '/ls cartella-che-non-c-e-968');
  await expect(page.locator('.dash-term-exit').last()).toBeVisible({ timeout: 12_000 });
  await page.waitForTimeout(800);
  await expect(page.locator('.dash-term-proposta')).toHaveCount(0);

  await submitInput(page, '/cd Nome Cognome');
  const proposta = page.locator('.dash-term-proposta');
  await expect(proposta).toHaveCount(1, { timeout: 12_000 });
  await expect(proposta.locator('.dash-term-proposta-cmd')).toHaveText('/ cd "Nome Cognome"');
  await expect(proposta.locator('mark')).toHaveText('"Nome Cognome"');
  await expect(page.locator('#dashDir')).toHaveText(dir);
  await page.screenshot({ path: 'tests/.shots/968-proposta.png' }).catch(() => {});

  // Il tasto destro offre di correggerla a mano: la riga va nella barra, non parte.
  await proposta.click({ button: 'right' });
  await expect(page.locator('.sn-rinomina-menu')).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/968-proposta-menu.png' }).catch(() => {});
  await page.locator('.sn-rinomina-menu .sn-select-option', { hasText: 'Modifica prima di eseguire' }).click();
  await expect(input).toHaveValue('/cd "Nome Cognome"');
  await expect(page.locator('.dash-term-cmd')).toHaveCount(3);
  await input.fill('');

  await proposta.locator('.dash-term-proposta-esegui').click();
  await expect(page.locator('#dashDir')).toHaveText(cartella, { timeout: 12_000 });
  await expect(page.locator('.dash-term-cmd').last()).toContainText('cd "Nome Cognome"');
  await expect(proposta.locator('.dash-term-proposta-esegui')).toBeDisabled();
  // Il comando partito si legge: la sua bolla ha un fondo, non è testo chiaro su chiaro.
  const colori = await page.locator('.dash-term-cmd').last().evaluate((el) => ({
    fondo: getComputedStyle(el).backgroundColor,
    testo: getComputedStyle(el).color,
  }));
  expect(colori.fondo).not.toBe('rgba(0, 0, 0, 0)');
  expect(colori.fondo).not.toBe(colori.testo);

  await app.evaluate(async () => globalThis.__filoHandlers.handleMessage(
    { type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } },
    { url: 'filo://preferences/preferences.html' },
  ));
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', 'dark', { timeout: 5_000 });
  await page.screenshot({ path: 'tests/.shots/968-proposta-scuro.png' }).catch(() => {});
});
