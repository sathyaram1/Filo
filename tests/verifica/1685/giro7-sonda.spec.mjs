// Sonda della verifica #1685 giro 7 (esplorazione: si rinomina o si cancella prima del verdetto).
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;
const dimentica = (app, id) => app.evaluate((_e, c) => globalThis.SN_CONTESTO_FILO.dimentica(c), id);
async function riapri(app, page, id) {
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
}
const TERMINALE = { id: 'p1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"modalita_terminale","valore":true}' };
const mkdir = (id, dir, nome) => ({ id, name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `mkdir "${join(dir, nome)}"`, spiegazione: `Creo la cartella ${nome}` }) });
const turniVuoti = (storia) => storia.filter((m) => m.role === 'assistant' && !(Array.isArray(m.tool_calls) && m.tool_calls.length)
  && (!String(typeof m.content === 'string' ? m.content : '').trim() || m.content === '(nessun testo)'));

test('T1 popup lasciato aperto e chat riaperta: la proposta ha il suo bottone', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: false } }));
  await modelloFinto(app, [{ text: '', toolCalls: [TERMINALE] }, { text: 'Fatto.' }]);
  await chiedi(page, 'accendi il terminale');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  const chat = await chatCon(app, 'accendi il terminale');
  console.log('ESITI-PRIMA', JSON.stringify(chat.messages.map((m) => [m.role, m.text, m.esiti])));
  await dimentica(app, chat.id);
  await riapri(app, page, chat.id);
  await expect(page.locator('.dash-bubble-user', { hasText: 'accendi il terminale' })).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(1000);
  console.log('RIGHE', JSON.stringify(await page.locator('.dash-bubble-filo').allInnerTexts()));
  console.log('BOTTONI', JSON.stringify(await page.locator('.dash-bubble-filo .dash-action-btn').allInnerTexts()));
  await page.screenshot({ path: 'tests/.shots/g7-t1.png' });
  await ripristina(app);
});

test('T2 bottone ridato alla riapertura: un no resta un no e non richiama il modello', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('g7-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ text: 'Creo la cartella.', toolCalls: [mkdir('c1', dir, 'quattro')] }, { text: 'Aspetto.' }, { text: 'RIPARTITO' }]);
    await chiedi(page, 'crea la cartella quattro');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const chat = await chatCon(app, 'crea la cartella quattro');
    await dimentica(app, chat.id);
    await riapri(app, page, chat.id);
    const bottone = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Creo la cartella quattro' });
    await expect(bottone).toBeVisible({ timeout: 8_000 });
    const prima = (await chiamateAlModello(app)).length;
    await bottone.click();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
    await clickConfirm(page, 'cancel');
    await page.waitForTimeout(2000);
    console.log('T2 BOTTONE', await bottone.innerText().catch(() => 'sparito'));
    console.log('T2 ESITI', JSON.stringify((await chatCon(app, 'crea la cartella quattro')).messages.map((m) => [m.role, m.text, m.esiti])));
    console.log('T2 CHIAMATE', prima, (await chiamateAlModello(app)).length);
    expect(existsSync(join(dir, 'quattro'))).toBe(false);
    await dimentica(app, chat.id);
    await riapri(app, page, chat.id);
    await page.waitForTimeout(1000);
    console.log('T2 RIGHE2', JSON.stringify(await page.locator('.dash-bubble-filo').allInnerTexts()));
  } finally { await ripristina(app); togliCartella(dir); }
});

test('T3 azione non riuscita senza conferma: il perché resta dopo un riavvio', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await livelloAutonomia(app, 'normale');
  await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'x1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"non_esiste_proprio","valore":3}' }] }, { text: 'Non ci sono riuscito.' }, { text: 'Ok.' }]);
  await chiedi(page, 'imposta la cosa strana');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  console.log('T3 LIVE', JSON.stringify(await page.locator('.dash-bubble-filo').allInnerTexts()));
  console.log('T3 CALL2', JSON.stringify((await chiamateAlModello(app))[1]?.slice(-2)));
  const chat = await chatCon(app, 'imposta la cosa strana');
  console.log('T3 ESITI', JSON.stringify(chat.messages.map((m) => [m.role, m.esiti])));
  await dimentica(app, chat.id);
  await riapri(app, page, chat.id);
  await page.waitForTimeout(1500);
  console.log('T3 RIAPERTA', JSON.stringify(await page.locator('.dash-bubble-filo').allInnerTexts()));
  await chiedi(page, 'è andata?');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(3);
  console.log('T3 CTX', JSON.stringify((await chiamateAlModello(app))[2].slice(-4)));
  await ripristina(app);
});

test('T4 ripresa muta in diretta: il messaggio dopo non porta turni vuoti', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('g7-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ text: '', toolCalls: [mkdir('c1', dir, 'cinque')] }, { text: '' }, { text: '' }, { text: 'Ok.' }]);
    await chiedi(page, 'crea la cartella cinque');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const bottone = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Creo la cartella cinque' });
    await bottone.click();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
    if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
    await scrollConfirmToEnd(page);
    await clickConfirm(page, 'ok');
    await expect(bottone).toHaveText(/^✓/, { timeout: 10_000 });
    await page.waitForTimeout(2000);
    const n = (await chiamateAlModello(app)).length;
    await chiedi(page, 'grazie');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(n + 1);
    const ch = await chiamateAlModello(app);
    console.log('T4 N', n, 'CTX', JSON.stringify(ch[ch.length - 1].slice(1)));
    expect(turniVuoti(ch[ch.length - 1])).toEqual([]);
    console.log('T4 BOLLE', JSON.stringify(await page.locator('.dash-bubble-filo').allInnerTexts()));
  } finally { await ripristina(app); togliCartella(dir); }
});
