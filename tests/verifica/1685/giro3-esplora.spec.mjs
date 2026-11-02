// Esplorazione del giro 3: si cancella prima del verdetto.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;
async function riapri(app, page, id) {
  await app.evaluate((_e, c) => globalThis.SN_CONTESTO_FILO.dimentica(c), id);
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
}
const righe = (page) => page.locator('.dash-bubble-filo .dash-activity-row').evaluateAll((els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
async function ok(page) {
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
}

test('e1 diario in diretta contro chat riaperta', async ({ app }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [
      { id: 'a1', name: 'SVEGLIA', arguments: '{"time":"07:30","label":"palestra"}' },
      { id: 'a2', name: 'SVEGLIA', arguments: '{"time":"zz","label":"rotta"}' },
      { id: 'a3', name: 'ZOOM_PAGINA', arguments: '{"percentuale":150}' },
      { id: 'a4', name: 'VOLUME', arguments: '{"livello":40}' },
      { id: 'a5', name: 'SALVA_APPUNTO', arguments: '{"testo":"comprare il latte","contesto":"spesa"}' },
      { id: 'a6', name: 'NAVIGA', arguments: '{"url":"https://example.com/","etichetta":"Esempio"}' },
      { id: 'a7', name: 'IMPOSTA_ESTETICA', arguments: '{"token":"accent","valore":"#aa5500"}' },
    ] },
    { text: 'Fatto tutto.' },
    { text: 'Ok.' },
  ]);
  await chiedi(page, 'fai tante cose');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto tutto' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1000);
  const live = await righe(page);
  const chat = await chatCon(app, 'fai tante cose');
  console.log('ESITI', JSON.stringify(chat.messages.flatMap((m) => m.esiti || []), null, 1));
  await riapri(app, page, chat.id);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto tutto' })).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(800);
  const dopo = await righe(page);
  console.log('LIVE', JSON.stringify(live, null, 1));
  console.log('DOPO', JSON.stringify(dopo, null, 1));
  await chiedi(page, 'e allora?');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(3);
  const ch = await chiamateAlModello(app);
  console.log('MODELLO', JSON.stringify(ch[2].filter((m) => m.role !== 'system').map((m) => m.content), null, 1).slice(0, 4000));
  await ripristina(app);
});

test('e2 un no, poi riaperta', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: false } }));
  await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'p1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"modalita_terminale","valore":true}' }] }, { text: 'Va bene.' }]);
  await chiedi(page, 'accendi il terminale');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await clickConfirm(page, 'cancel');
  await page.waitForTimeout(1500);
  const live = await righe(page);
  const chat = await chatCon(app, 'accendi il terminale');
  console.log('E2 ESITI', JSON.stringify(chat.messages.flatMap((m) => m.esiti || [])));
  await riapri(app, page, chat.id);
  await expect(page.locator('.dash-bubble-user', { hasText: 'accendi il terminale' })).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(800);
  console.log('E2 LIVE', JSON.stringify(live));
  console.log('E2 DOPO', JSON.stringify(await righe(page)));
  console.log('E2 BOTTONI', await page.locator('.dash-action-btn').count());
  await chiedi(page, 'come va?');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(2);
  const ch = await chiamateAlModello(app);
  console.log('E2 MODELLO', JSON.stringify(ch[1].filter((m) => m.role !== 'system').map((m) => m.content)).slice(0, 2000));
  await ripristina(app);
});

test('e3 fermato prima del testo: niente turno vuoto', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Lungo.', ritardoMs: 5000 }, { text: 'Ecco.' }]);
  await chiedi(page, 'raccontami una storia');
  await page.waitForTimeout(1200);
  await page.locator('#sendBtn').click();
  await page.waitForTimeout(6000);
  await chiedi(page, 'altro');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(2);
  const ch = await chiamateAlModello(app);
  console.log('E3 MODELLO', JSON.stringify(ch[1].filter((m) => m.role !== 'system').map((m) => [m.role, m.content])));
  const chat = await chatCon(app, 'raccontami una storia');
  console.log('E3 CHAT', JSON.stringify(chat.messages.map((m) => [m.role, m.text, m.esiti])));
  await ripristina(app);
});

test('e4 un OK e un no nella stessa risposta', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('v1685e-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [
      { text: 'Creo le due cartelle.', toolCalls: [
        { id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `mkdir "${join(dir, 'uno')}"`, spiegazione: 'Creo la cartella uno' }) },
        { id: 'c2', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `mkdir "${join(dir, 'due')}"`, spiegazione: 'Creo la cartella due' }) },
      ] },
      { text: 'Aspetto i tuoi OK.' },
      { text: 'RIPRESO.' },
    ]);
    await chiedi(page, 'crea le cartelle uno e due');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const bottoni = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: /Creo la cartella/ });
    await expect(bottoni).toHaveCount(2, { timeout: 10_000 });
    await bottoni.filter({ hasText: 'uno' }).click();
    await ok(page);
    await expect(bottoni.filter({ hasText: 'uno' })).toHaveText(/^✓/, { timeout: 10_000 });
    await bottoni.filter({ hasText: 'due' }).click();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
    await clickConfirm(page, 'cancel');
    await page.waitForTimeout(3000);
    console.log('E4 CHIAMATE', (await chiamateAlModello(app)).length, existsSync(join(dir, 'uno')), existsSync(join(dir, 'due')));
    console.log('E4 BOLLE', JSON.stringify(await page.locator('.dash-bubble-filo').allTextContents()));
    console.log('E4 BOTTONI', JSON.stringify(await bottoni.allTextContents()));
    await chiedi(page, 'e quindi?');
    await page.waitForTimeout(2000);
    const ch = await chiamateAlModello(app);
    console.log('E4 MODELLO', JSON.stringify(ch[ch.length - 1].filter((m) => m.role !== 'system').map((m) => [m.role, m.content])).slice(0, 3000));
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});
