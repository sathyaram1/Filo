// Verifica #1685 giro 11: esplorazione delle conferme ridate in una chat riaperta.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';
import { existsSync } from 'node:fs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;
const dimenticaLaMemoria = (app, id) => app.evaluate((_e, c) => globalThis.SN_CONTESTO_FILO.dimentica(c), id);
async function riapri(app, page, id) {
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
}
async function rispondi(page, bottone, ok) {
  await bottone.click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  if (ok && await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
  if (ok) await scrollConfirmToEnd(page);
  await clickConfirm(page, ok ? 'ok' : 'cancel');
}
const mkdir = (id, dir, nome) => ({ id, name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `mkdir "${join(dir, nome)}"`, spiegazione: `Creo la cartella ${nome}` }) });

async function preparaDue(app, dir, coda) {
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [
    { text: 'Creo le due cartelle.', toolCalls: [mkdir('c1', dir, 'sei'), mkdir('c2', dir, 'otto')] },
    { text: 'Aspetto i tuoi OK.' },
    ...coda,
  ]);
  await chiedi(page, 'crea le cartelle sei e otto');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Aspetto i tuoi OK' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  return page;
}

test('A riaperta: OK al primo, no al secondo: una ripresa sola, col primo esito', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('g11-');
  try {
    const page = await preparaDue(app, dir, [{ text: 'Fatta la sei.' }, { text: 'extra' }]);
    const chat = await chatCon(app, 'crea le cartelle sei e otto');
    await dimenticaLaMemoria(app, chat.id);
    await riapri(app, page, chat.id);
    const bottoni = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: /Creo la cartella/ });
    await expect(bottoni).toHaveCount(2, { timeout: 8_000 });
    await rispondi(page, bottoni.filter({ hasText: 'sei' }), true);
    await page.waitForTimeout(1500);
    expect((await chiamateAlModello(app)).length).toBe(2);
    await rispondi(page, bottoni.filter({ hasText: 'otto' }), false);
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatta la sei' })).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    const ch = await chiamateAlModello(app);
    expect(ch.length).toBe(3);
    console.log('A ULTIMA', JSON.stringify(ch[2]).slice(-1500));
    expect(existsSync(join(dir, 'sei'))).toBe(true);
    expect(existsSync(join(dir, 'otto'))).toBe(false);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

for (const riaperta of [false, true]) {
  test(`D ${riaperta ? 'riaperta' : 'in diretta'}: OK al primo, no al secondo: la ripresa sa del no?`, async ({ app }) => {
    test.setTimeout(60_000);
    const dir = cartellaTemporanea('g11-');
    try {
      const page = await preparaDue(app, dir, [{ text: 'Fatta la sei.' }, { text: 'extra' }]);
      const chat = await chatCon(app, 'crea le cartelle sei e otto');
      if (riaperta) {
        await dimenticaLaMemoria(app, chat.id);
        await riapri(app, page, chat.id);
      }
      const bottoni = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: /Creo la cartella/ });
      await expect(bottoni).toHaveCount(2, { timeout: 8_000 });
      await rispondi(page, bottoni.filter({ hasText: 'sei' }), true);
      await page.waitForTimeout(1000);
      await rispondi(page, bottoni.filter({ hasText: 'otto' }), false);
      await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatta la sei' })).toBeVisible({ timeout: 10_000 });
      await page.waitForTimeout(1500);
      const ch = await chiamateAlModello(app);
      const s = JSON.stringify(ch[2]);
      console.log('D', riaperta, 'RIPRESA', s.slice(-900));
      const c2 = await chatCon(app, 'crea le cartelle sei e otto');
      console.log('D', riaperta, 'ARCHIVIO', JSON.stringify(c2.messages.map((m) => ({ r: m.role, t: m.text, e: (m.esiti || []).map((v) => `${v.esito}:${v.motivo || ''}`) }))));
      expect(s, 'la ripresa dice al modello che otto ha avuto un no').toMatch(/otto[^\n]*detto no|NO alla conferma[^\n]*otto|otto[^\n]*NO alla conferma/);
    } finally {
      await ripristina(app);
      togliCartella(dir);
    }
  });
}

test('B in diretta OK al primo, poi riaperta: OK al secondo riprende una volta e il modello sa di tutti e due', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('g11-');
  try {
    const page = await preparaDue(app, dir, [{ text: 'Fatte tutte e due.' }, { text: 'extra' }]);
    const bottoni = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: /Creo la cartella/ });
    await rispondi(page, bottoni.filter({ hasText: 'sei' }), true);
    await page.waitForTimeout(1500);
    expect((await chiamateAlModello(app)).length).toBe(2);
    const chat = await chatCon(app, 'crea le cartelle sei e otto');
    await dimenticaLaMemoria(app, chat.id);
    await riapri(app, page, chat.id);
    const ridati = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: /Creo la cartella/ });
    await expect(page.locator('.dash-bubble-filo')).toContainText('Creo la cartella otto', { timeout: 8_000 });
    console.log('B BOLLA', await page.locator('.dash-bubble-filo').first().innerText());
    console.log('B BOTTONI', await ridati.count());
    await rispondi(page, ridati.filter({ hasText: 'otto' }), true);
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatte tutte e due' })).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    const ch = await chiamateAlModello(app);
    expect(ch.length).toBe(3);
    console.log('B ULTIMA', JSON.stringify(ch[2]).slice(-2000));
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

test('C riaperta: OK al primo, poi l\'utente scrive altro, poi OK al secondo', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('g11-');
  try {
    const page = await preparaDue(app, dir, [{ text: 'Sono le dieci.' }, { text: 'Fatta anche la otto.' }, { text: 'extra' }]);
    const chat = await chatCon(app, 'crea le cartelle sei e otto');
    await dimenticaLaMemoria(app, chat.id);
    await riapri(app, page, chat.id);
    const bottoni = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: /Creo la cartella/ });
    await expect(bottoni).toHaveCount(2, { timeout: 8_000 });
    await rispondi(page, bottoni.filter({ hasText: 'sei' }), true);
    await page.waitForTimeout(1000);
    await chiedi(page, 'che ore sono?');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Sono le dieci' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    console.log('C TERZA', JSON.stringify((await chiamateAlModello(app))[2]).slice(-1500));
    await rispondi(page, bottoni.filter({ hasText: 'otto' }), true);
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatta anche la otto' })).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    const ch = await chiamateAlModello(app);
    console.log('C N', ch.length);
    console.log('C ULTIMA', JSON.stringify(ch[ch.length - 1]).slice(-2000));
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});
