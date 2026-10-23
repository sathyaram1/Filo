// Verifica #1343.1 giro 1: un colore scritto nelle Preferenze arriva nel salvato anche passando subito ad altro.
import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm } from '../../helpers/confirm.mjs';

const PREFERENZE = 'filo://preferences/preferences.html';
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
const tokens = (app) => impostazioni(app).then((s) => s.themeTokens || {});

async function scrivi(page, sel, testo) {
  await page.click(sel);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(testo);
}

async function chiudiScheda(shell, frammento) {
  const id = await shell.evaluate(async (f) => {
    const s = await window.filoShell.tabs.snapshot();
    const lista = Array.isArray(s) ? s : (s && s.tabs) || [];
    const t = lista.find((x) => (x.url || '').includes(f));
    return t ? t.id : null;
  }, frammento);
  expect(id).toBeTruthy();
  await shell.evaluate((i) => window.filoShell.tabs.close(i), id);
}

test('colore scritto e scheda chiusa subito', async ({ app, shell, openTab }) => {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#tok-accent');
  await scrivi(page, '#tok-accent', '#1a7d3a');
  await chiudiScheda(shell, 'preferences');
  await expect.poll(() => tokens(app).then((t) => t.accent), { timeout: 8000 }).toBe('#1a7d3a');
});

test('colore scritto e tema cambiato subito: restano tutti e due, anche nel campo', async ({ app, openTab }) => {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#tok-accent');
  await scrivi(page, '#tok-accent', '#1a7d3a');
  await page.selectOption('#theme', 'dark');
  await page.selectOption('#textScale', '1.25');
  await expect.poll(() => tokens(app).then((t) => t.accent), { timeout: 5000 }).toBe('#1a7d3a');
  await expect.poll(() => impostazioni(app).then((s) => s.theme), { timeout: 5000 }).toBe('dark');
  await page.waitForTimeout(1500);
  expect(await page.inputValue('#tok-accent')).toBe('#1a7d3a');
  expect((await tokens(app)).accent).toBe('#1a7d3a');
});

test('due colori di fila senza pause: si salvano tutti e due', async ({ app, openTab }) => {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#tok-accent');
  await scrivi(page, '#tok-accent', '#1a7d3a');
  await scrivi(page, '#tok-background', '#203040');
  await scrivi(page, '#tok-text', '#fafafa');
  await expect.poll(() => tokens(app), { timeout: 5000 }).toMatchObject({ accent: '#1a7d3a', background: '#203040', text: '#fafafa' });
});

test('due schede Preferenze: un colore per scheda, restano entrambi', async ({ app, openTab }) => {
  const a = await openTab(PREFERENZE);
  await a.waitForSelector('#tok-accent');
  const b = await openTab(PREFERENZE + '?b=1');
  await b.waitForSelector('#tok-background');
  await a.fill('#tok-accent', '#1a7d3a');
  await b.fill('#tok-background', '#203040');
  await expect.poll(() => tokens(app), { timeout: 5000 }).toMatchObject({ accent: '#1a7d3a', background: '#203040' });
  await a.waitForTimeout(1500);
  expect(await tokens(app)).toMatchObject({ accent: '#1a7d3a', background: '#203040' });
});

test('colore cambiato da Filo mentre la pagina ne sta scrivendo un altro: restano entrambi', async ({ app, openTab }) => {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#tok-accent');
  await scrivi(page, '#tok-accent', '#1a7d3a');
  await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    await globalThis.SN_STORAGE.updateSettings({ themeTokens: { ...(s.themeTokens || {}), background: '#203040' } });
  });
  await expect.poll(() => tokens(app), { timeout: 5000 }).toMatchObject({ accent: '#1a7d3a', background: '#203040' });
  await page.waitForTimeout(1500);
  expect(await tokens(app)).toMatchObject({ accent: '#1a7d3a', background: '#203040' });
});

test('colore scritto e poi tolto col pulsante della riga: torna al predefinito', async ({ app, openTab }) => {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#tok-accent');
  await scrivi(page, '#tok-accent', '#1a7d3a');
  await page.click('.sn-token-row[data-token="accent"] .sn-token-reset');
  await page.waitForTimeout(1500);
  expect((await tokens(app)).accent).toBeUndefined();
});

test('colore scritto e Ripristina tutto subito: non torna dopo il ripristino', async ({ app, openTab }) => {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#tok-accent');
  await scrivi(page, '#tok-accent', '#1a7d3a');
  await page.click('#resetAllSettings');
  await clickConfirm(page, 'ok');
  await expect.poll(() => tokens(app).then((t) => Object.keys(t).length), { timeout: 5000 }).toBe(0);
  await page.waitForTimeout(2000);
  expect(await tokens(app)).toEqual({});
});
