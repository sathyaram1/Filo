// Esplorazione del giro 5 di #1685: si cancella prima del verdetto.
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
async function ok(page) {
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 8_000 });
  if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, (await page.locator(`${CONFIRM_HOST}`).evaluate((h) => !!h.shadowRoot?.querySelector('[data-k="danger"], .danger'))) ? 'danger' : 'ok');
}
const turniVuoti = (storia) => storia.filter((m) => m.role === 'assistant' && !(Array.isArray(m.tool_calls) && m.tool_calls.length)
  && (!String(typeof m.content === 'string' ? m.content : '').trim() || m.content === '(nessun testo)'));
const dump = (x) => console.log(JSON.stringify(x, null, 1).slice(0, 6000));

test('X1 comando fallito dopo l\'OK: il modello riceve l\'esito e lo dice', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: 'ls /cartella_che_non_esiste_v1685', spiegazione: 'Elenco la cartella' }) }] },
    { text: 'NON È ANDATO: la cartella non esiste.' },
  ]);
  await chiedi(page, 'elenca la cartella che non esiste');
  await ok(page);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'NON È ANDATO' })).toBeVisible({ timeout: 10_000 });
  const ch = await chiamateAlModello(app);
  console.log('X1 chiamate', ch.length);
  dump(ch[ch.length - 1].slice(-3));
  await page.screenshot({ path: 'tests/.shots/v1685-g5-x1.png' });
  await ripristina(app);
});

test('X2 OK a un comando lento, poi /clear: esito e ripresa nella conversazione dove è nato', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('v1685g5-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [
      { text: 'Creo la cartella.', toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `sleep 4 && mkdir "${join(dir, 'lenta')}"`, spiegazione: 'Creo la cartella lenta' }) }] },
      { text: 'RIPRESA: cartella creata.' },
      { text: 'Prego.' },
    ]);
    await chiedi(page, 'crea la cartella lenta');
    await ok(page);
    await page.waitForTimeout(500);
    await chiedi(page, '/clear');
    await page.waitForTimeout(7000);
    expect(existsSync(join(dir, 'lenta'))).toBe(true);
    const nata = await chatCon(app, 'crea la cartella lenta');
    console.log('X2 nata', JSON.stringify(nata.messages.map((m) => ({ r: m.role, t: (m.text || '').slice(0, 60), e: (m.esiti || []).map((v) => v.esito + ':' + (v.riga || '')) }))));
    const altre = (await chatsDellaHome(app)).filter((c) => c.id !== nata.id);
    console.log('X2 altre', JSON.stringify(altre.map((c) => c.messages.map((m) => ({ r: m.role, t: (m.text || '').slice(0, 60), e: (m.esiti || []).length })))));
    console.log('X2 bolle a schermo', await page.locator('.dash-bubble').allInnerTexts());
    await page.screenshot({ path: 'tests/.shots/v1685-g5-x2.png' });
    await chiedi(page, 'grazie');
    await page.waitForTimeout(2500);
    const tutte = await chatsDellaHome(app);
    console.log('X2 dopo grazie', JSON.stringify(tutte.map((c) => ({ id: c.id, m: c.messages.map((m) => m.role + ':' + (m.text || '').slice(0, 40)) }))));
    const ch = await chiamateAlModello(app);
    console.log('X2 ultima chiamata', JSON.stringify(ch[ch.length - 1].map((m) => m.role + ':' + String(m.content || '').slice(0, 120))));
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

test('X3 comando proposto senza testo, popup chiuso con Esc, scheda ricaricata: la proposta resta e il modello la sa', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: 'echo ciao-v1685 <b>x</b> 🙂', spiegazione: 'Saluto <img src=x onerror=alert(1)> 🙂' }) }] },
    { text: 'Ok.' },
  ]);
  await chiedi(page, 'saluta nel terminale');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  console.log('X3 popup dopo Esc', await page.locator(CONFIRM_HOST).count());
  const chat = await chatCon(app, 'saluta nel terminale');
  console.log('X3 archivio', JSON.stringify(chat.messages.map((m) => ({ r: m.role, t: m.text, e: m.esiti }))));
  await dimentica(app, chat.id);
  await riapri(app, page, chat.id);
  await page.waitForTimeout(1500);
  console.log('X3 riaperta', await page.locator('.dash-bubble').allInnerTexts());
  console.log('X3 bottoni', await page.locator('.dash-action-btn').allInnerTexts());
  await page.screenshot({ path: 'tests/.shots/v1685-g5-x3.png' });
  const prima = (await chiamateAlModello(app)).length;
  await chiedi(page, 'invece scrivi addio');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBeGreaterThan(prima);
  const ch = await chiamateAlModello(app);
  const storia = ch[ch.length - 1];
  console.log('X3 contesto', JSON.stringify(storia.filter((m) => m.role !== 'system').map((m) => m.role + ':' + String(m.content || '').slice(0, 300))));
  console.log('X3 vuoti', turniVuoti(storia).length);
  await ripristina(app);
});

test('X4 «dimentica tutto» mai confermato: riaperta non dice che è fatto', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 'm1', name: 'CANCELLA_MEMORIA', arguments: '{}' }] },
    { text: 'Ok.' },
  ]);
  await chiedi(page, 'dimentica tutto quello che sai di me');
  await page.waitForTimeout(1500);
  console.log('X4 popup', await page.locator(CONFIRM_HOST).count());
  if (await page.locator(CONFIRM_HOST).count()) await clickConfirm(page, 'cancel');
  const chat = await chatCon(app, 'dimentica tutto quello che sai di me');
  await dimentica(app, chat.id);
  await riapri(app, page, chat.id);
  await page.waitForTimeout(1500);
  console.log('X4 riaperta', await page.locator('.dash-bubble').allInnerTexts());
  const prima = (await chiamateAlModello(app)).length;
  await chiedi(page, 'l\'hai fatto?');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBeGreaterThan(prima);
  const ch = await chiamateAlModello(app);
  console.log('X4 contesto', JSON.stringify(ch[ch.length - 1].filter((m) => m.role !== 'system').map((m) => m.role + ':' + String(m.content || '').slice(0, 300))));
  await ripristina(app);
});

test('X5 evento aggiunto col bottone dove nessun programma apre gli inviti: diario e modello', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [
    { text: 'Ecco l\'evento.', toolCalls: [{ id: 'e1', name: 'EVENTO_CALENDARIO', arguments: '{"data":"2026-12-01","ora":"10:00","titolo":"Dentista"}' }] },
    { text: 'Ok.' },
  ]);
  await chiedi(page, 'metti il dentista il primo dicembre alle 10');
  await page.waitForTimeout(1500);
  console.log('X5 bottoni', await page.locator('.dash-action-btn').allInnerTexts());
  const b = page.locator('.dash-bubble-filo .dash-action-btn').first();
  await b.click();
  await page.waitForTimeout(500);
  if (await page.locator(CONFIRM_HOST).count()) await ok(page);
  await page.waitForTimeout(4000);
  console.log('X5 dopo clic', await page.locator('.dash-bubble').allInnerTexts());
  console.log('X5 bottoni dopo', await page.locator('.dash-action-btn').allInnerTexts());
  await page.screenshot({ path: 'tests/.shots/v1685-g5-x5.png' });
  const chat = await chatCon(app, 'metti il dentista il primo dicembre alle 10');
  console.log('X5 archivio', JSON.stringify(chat.messages.map((m) => ({ r: m.role, t: (m.text || '').slice(0, 80), e: m.esiti }))));
  await dimentica(app, chat.id);
  await riapri(app, page, chat.id);
  await page.waitForTimeout(1500);
  console.log('X5 riaperta', await page.locator('.dash-bubble').allInnerTexts());
  const prima = (await chiamateAlModello(app)).length;
  await chiedi(page, 'è in calendario?');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBeGreaterThan(prima);
  const ch = await chiamateAlModello(app);
  console.log('X5 contesto', JSON.stringify(ch[ch.length - 1].filter((m) => m.role !== 'system').map((m) => m.role + ':' + String(m.content || '').slice(0, 400))));
  await ripristina(app);
});
