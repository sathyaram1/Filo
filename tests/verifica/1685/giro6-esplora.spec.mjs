// Verifica #1685 giro 6: esplorazione (si cancella prima del verdetto).
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
async function okAlBottone(page, bottone, which = 'ok') {
  await expect(bottone).toBeVisible({ timeout: 10_000 });
  await bottone.click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  if (which !== 'cancel' && await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
  if (which !== 'cancel') await scrollConfirmToEnd(page);
  await clickConfirm(page, which);
}
const mkdir = (id, dir, nome, prima = '') => ({ id, name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `${prima}mkdir "${join(dir, nome)}"`, spiegazione: `Creo la cartella ${nome}` }) });
const log = (k, v) => console.log(`### ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
const righe = (page) => page.locator('.dash-activity-row').allTextContents();
function coda(storia) {
  return storia.slice(-6).map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}${m.tool_calls ? ' TOOLS' + JSON.stringify(m.tool_calls) : ''}`).join('\n---\n');
}

test('P1 segnalazione confermata nel popup: diario e chat riaperta', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: '{"testo":"Il timer non suona.","titolo":"Timer muto"}' }] }, { text: '' }, { text: 'Ok.' }]);
  await chiedi(page, 'segnala che il timer non suona');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  log('P1 diretta', await righe(page));
  const chat = await chatCon(app, 'segnala che il timer non suona');
  log('P1 salvata', chat.messages.map((m) => ({ r: m.role, t: m.text, e: m.esiti })));
  await dimentica(app, chat.id);
  await riapri(app, page, chat.id);
  await page.waitForTimeout(1500);
  log('P1 riaperta', await righe(page));
  await chiedi(page, 'è partita?');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(3);
  log('P1 modello', coda((await chiamateAlModello(app))[2]));
  await ripristina(app);
});

test('P2 due comandi: OK al primo, no al secondo; riaperta dopo riavvio', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('v1685g6-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [
      { text: 'Creo le due cartelle.', toolCalls: [mkdir('c1', dir, 'uno'), mkdir('c2', dir, 'due')] },
      { text: 'RIPRESA dopo i bottoni.' },
      { text: 'Ok.' },
    ]);
    await chiedi(page, 'crea le cartelle uno e due');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const bottoni = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: /Creo la cartella/ });
    await okAlBottone(page, bottoni.filter({ hasText: 'uno' }));
    await page.waitForTimeout(1000);
    await okAlBottone(page, bottoni.filter({ hasText: 'due' }), 'cancel');
    await page.waitForTimeout(3000);
    log('P2 chiamate dopo i bottoni', (await chiamateAlModello(app)).length);
    if ((await chiamateAlModello(app)).length > 1) log('P2 ripresa riceve', coda((await chiamateAlModello(app))[1]));
    log('P2 diretta', await righe(page));
    log('P2 bottoni', await page.locator('.dash-bubble-filo .dash-action-btn').allTextContents());
    log('P2 cartelle', { uno: existsSync(join(dir, 'uno')), due: existsSync(join(dir, 'due')) });
    const chat = await chatCon(app, 'crea le cartelle uno e due');
    log('P2 salvata', chat.messages.map((m) => ({ r: m.role, t: m.text, e: m.esiti })));
    await dimentica(app, chat.id);
    await riapri(app, page, chat.id);
    await page.waitForTimeout(1500);
    log('P2 riaperta', await righe(page));
    log('P2 riaperta bottoni', await page.locator('.dash-bubble-filo .dash-action-btn').allTextContents());
    const n = (await chiamateAlModello(app)).length;
    await chiedi(page, 'le hai create tutte e due?');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBe(n + 1);
    log('P2 modello', coda((await chiamateAlModello(app))[n]));
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

test('P3 comando mai confermato: riaperta, bottone e righe', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('v1685g6-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ text: 'Creo la cartella.', toolCalls: [mkdir('c1', dir, 'tre')] }, { text: 'Aspetto.' }, { text: 'RIPRESA.' }, { text: 'Ok.' }]);
    await chiedi(page, 'crea la cartella tre');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(800);
    log('P3 diretta', await righe(page));
    const chat = await chatCon(app, 'crea la cartella tre');
    await dimentica(app, chat.id);
    await riapri(app, page, chat.id);
    await page.waitForTimeout(1500);
    log('P3 riaperta', await righe(page));
    const btn = page.locator('.dash-bubble-filo .dash-action-btn');
    log('P3 riaperta bottoni', await btn.allTextContents());
    if (await btn.count()) {
      await okAlBottone(page, btn.first());
      await page.waitForTimeout(3000);
      log('P3 dopo OK riaperta', { cartella: existsSync(join(dir, 'tre')), chiamate: (await chiamateAlModello(app)).length, righe: await righe(page) });
      const c2 = await chatCon(app, 'crea la cartella tre');
      log('P3 salvata dopo OK', c2.messages.map((m) => ({ r: m.role, t: m.text, e: m.esiti })));
    }
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

test('P4 comando lento confermato e /clear subito dopo', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('v1685g6-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ text: 'Creo la cartella.', toolCalls: [mkdir('c1', dir, 'lenta', 'sleep 4 && ')] }, { text: 'RIPRESA DOPO LENTO.' }, { text: 'NUOVA RISPOSTA.' }]);
    await chiedi(page, 'crea la cartella lenta');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    await okAlBottone(page, page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'lenta' }));
    await page.waitForTimeout(500);
    await chiedi(page, '/clear');
    await page.waitForTimeout(7000);
    log('P4 nuova home bolle', await page.locator('.dash-bubble').allTextContents());
    log('P4 chiamate', (await chiamateAlModello(app)).length);
    const tutte = await chatsDellaHome(app);
    log('P4 chat', tutte.map((c) => ({ id: c.id, chiusa: c.closed || c.chiusa, m: c.messages.map((m) => ({ r: m.role, t: m.text, e: (m.esiti || []).map((x) => x.riga + ':' + x.esito) })) })));
    await chiedi(page, 'ciao');
    await page.waitForTimeout(3000);
    log('P4 dopo ciao bolle', await page.locator('.dash-bubble').allTextContents());
    const ch = await chiamateAlModello(app);
    log('P4 ultima chiamata', coda(ch[ch.length - 1]));
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

test('P5 timer a Conservativo confermato al bottone/popup: riaperta', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [{ text: 'Ecco.', toolCalls: [{ id: 's1', name: 'SVEGLIA', arguments: '{"ora":"07:30","etichetta":"Lavoro"}' }] }, { text: '' }, { text: 'Ok.' }]);
  await chiedi(page, 'sveglia alle 7 e mezza per il lavoro');
  await page.waitForTimeout(2500);
  const popup = await page.locator(CONFIRM_HOST).count();
  const btn = page.locator('.dash-bubble-filo .dash-action-btn');
  log('P5 popup/bottoni', { popup, bottoni: await btn.allTextContents() });
  if (popup) { await scrollConfirmToEnd(page); await clickConfirm(page, 'ok'); } else if (await btn.count()) await okAlBottone(page, btn.first());
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  log('P5 diretta', await righe(page));
  const chat = await chatCon(app, 'sveglia alle 7 e mezza per il lavoro');
  await dimentica(app, chat.id);
  await riapri(app, page, chat.id);
  await page.waitForTimeout(1500);
  log('P5 riaperta', await righe(page));
  await ripristina(app);
});
