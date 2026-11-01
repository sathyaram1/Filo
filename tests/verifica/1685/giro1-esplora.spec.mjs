// Esplorazione della verifica di #1685, giro 1.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;
const dimentica = (app, id) => app.evaluate((_e, c) => globalThis.SN_CONTESTO_FILO.dimentica(c), id);
async function riapri(app, page, id) {
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
}
const turniVuoti = (storia) => storia.filter((m) => m.role === 'assistant' && !(Array.isArray(m.tool_calls) && m.tool_calls.length)
  && (!String(typeof m.content === 'string' ? m.content : '').trim() || m.content === '(nessun testo)'));
const terminaleSpento = (app) => app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: false } }));
const TERMINALE = { id: 'p1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"modalita_terminale","valore":true}' };
async function confermaScritta(page) {
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'danger');
}

test('E1 accendi il terminale e poi lancia ls: il modello chiede solo il primo passo, dopo l\'OK riprende', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await terminaleSpento(app);
  await modelloFinto(app, [
    { text: 'Prima ti chiedo di accendere il terminale, poi lancio ls.', toolCalls: [TERMINALE] },
    { text: 'RIPRESO DA SOLO.' },
  ]);
  await chiedi(page, 'accendi il terminale e poi lancia ls');
  await confermaScritta(page);
  await expect(page.locator('.dash-action-btn', { hasText: /^✓/ })).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 8_000 }).toBeGreaterThan(1);
  await ripristina(app);
});

test('E2 risposta vuota del modello: il turno dopo non manda turni vuoti', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [{ text: '' }, { text: 'Seconda.' }]);
  await chiedi(page, 'prima domanda vuota');
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  await chiedi(page, 'seconda domanda');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Seconda.' })).toBeVisible({ timeout: 10_000 });
  const ch = await chiamateAlModello(app);
  console.log('E2 storia', JSON.stringify(ch[ch.length - 1].slice(-4)));
  expect(turniVuoti(ch[ch.length - 1])).toEqual([]);
  await ripristina(app);
});

test('E3 turno fermato col quadrato: il turno dopo non manda turni vuoti', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'tardi', ritardoMs: 5000 }, { text: 'Dopo lo stop.' }]);
  await chiedi(page, 'domanda che fermo');
  await expect(page.locator('#stopBtn')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(1200);
  await page.locator('#stopBtn').click();
  await page.waitForTimeout(6000);
  await chiedi(page, 'altra domanda');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Dopo lo stop.' })).toBeVisible({ timeout: 10_000 });
  const ch = await chiamateAlModello(app);
  console.log('E3 storia', JSON.stringify(ch[ch.length - 1].slice(-4)));
  expect(turniVuoti(ch[ch.length - 1])).toEqual([]);
  await ripristina(app);
});

test('E4 un nome scritto dal modello con markup si mostra come testo nella chat riaperta', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 't1', name: 'TIMER', arguments: JSON.stringify({ secondi: 300, etichetta: '<img src=x id=xss onerror="window.__xss=1">Pasta' }) }] },
    { text: 'Partito.' },
  ]);
  await chiedi(page, 'timer pasta strano');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Partito.' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  const chat = await chatCon(app, 'timer pasta strano');
  await dimentica(app, chat.id);
  await riapri(app, page, chat.id);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Partito.' })).toBeVisible({ timeout: 8_000 });
  const righe = await page.locator('.dash-bubble-filo .dash-activity-row').allTextContents();
  console.log('E4 righe', righe);
  expect(await page.locator('#xss').count()).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await ripristina(app);
});

test('E5 chiusa con /clear in una home, l\'altra home già aperta non ci scrive', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Ciao a te.' }, { text: 'Di niente.' }]);
  await chiedi(page, 'ciao filo');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ciao a te.' })).toBeVisible({ timeout: 10_000 });
  const b = await openTab('filo://newtab/');
  await expect(b.locator('.dash-bubble-user', { hasText: 'ciao filo' })).toBeVisible({ timeout: 10_000 });
  await shell.locator('.tab').first().click();
  await chiedi(page, '/clear');
  const chiusa = (await chatCon(app, 'ciao filo')).id;
  await expect.poll(async () => (await chatsDellaHome(app)).find((c) => c.id === chiusa)?.finita, { timeout: 5_000 }).toBe(true);
  await shell.locator('.tab').nth(1).click();
  await chiedi(b, 'grazie');
  await expect(b.locator('.dash-bubble-filo', { hasText: 'Di niente.' })).toBeVisible({ timeout: 10_000 });
  const dove = await chatCon(app, 'grazie');
  expect(dove && dove.id).not.toBe(chiusa);
  const ch = await chiamateAlModello(app);
  expect(JSON.stringify(ch[ch.length - 1])).not.toContain('ciao filo');
  await ripristina(app);
});

test('E6 chiusa col bottone, l\'altra home scrive SUBITO senza passare per altro', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Ciao a te.' }, { text: 'Di niente.' }]);
  await chiedi(page, 'ciao filo due');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ciao a te.' })).toBeVisible({ timeout: 10_000 });
  const b = await openTab('filo://newtab/');
  await expect(b.locator('.dash-bubble-user', { hasText: 'ciao filo due' })).toBeVisible({ timeout: 10_000 });
  // Chiusa da main, come una home in sottofondo che la chiude.
  const chiusa = (await chatCon(app, 'ciao filo due')).id;
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c, { fine: true }), chiusa);
  await shell.locator('.tab').first().click();
  await page.locator('.dash-action-btn', { hasText: 'Chiudi la conversazione' }).click().catch(() => {});
  await shell.locator('.tab').nth(1).click();
  await chiedi(b, 'grazie due');
  await expect(b.locator('.dash-bubble-filo', { hasText: 'Di niente.' })).toBeVisible({ timeout: 10_000 });
  const dove = await chatCon(app, 'grazie due');
  expect(dove && dove.id).not.toBe(chiusa);
  await ripristina(app);
});
