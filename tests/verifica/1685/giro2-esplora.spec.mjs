// Esplorazione verifica #1685 giro 2.
import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;
const TERMINALE = { id: 'p1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"modalita_terminale","valore":true}' };
async function confermaScritta(page) {
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'danger');
}

test('T1 conferma data, ripresa con testo, riavvio: la chat e il modello sanno che è fatta', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: false } }));
  await modelloFinto(app, [{ text: '', toolCalls: [TERMINALE] }, { text: 'Ora lancio ls.' }, { text: 'Sì.' }]);
  await chiedi(page, 'accendi il terminale e poi lancia ls');
  await confermaScritta(page);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ora lancio ls' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(800);
  const chat = await chatCon(app, 'accendi il terminale e poi lancia ls');
  console.log('ARCHIVIO', JSON.stringify(chat.messages.map((m) => ({ role: m.role, text: m.text, esiti: m.esiti, confermaDopo: m.confermaDopo })), null, 1));
  await app.evaluate((_e, c) => globalThis.SN_CONTESTO_FILO.dimentica(c), chat.id);
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), chat.id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ora lancio ls' })).toBeVisible({ timeout: 8_000 });
  console.log('RIAPERTA', JSON.stringify(await page.locator('#bubbles, .dash-bubbles').first().innerText()));
  await page.screenshot({ path: 'tests/.shots/v1685-t1.png' });
  const prima = (await chiamateAlModello(app)).length;
  await chiedi(page, 'il terminale è acceso?');
  await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBeGreaterThan(prima);
  const ch = await chiamateAlModello(app);
  console.log('MODELLO', JSON.stringify(ch[ch.length - 1].filter((m) => m.role !== 'system'), null, 1));
  await ripristina(app);
});

test('T2 due comandi da confermare a mano: dopo il primo OK, il secondo', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [
    { text: 'Lancio i due comandi.', toolCalls: [
      { id: 'c1', name: 'ESEGUI_COMANDO', arguments: '{"comando":"echo uno","spiegazione":"Scrivo uno"}' },
      { id: 'c2', name: 'ESEGUI_COMANDO', arguments: '{"comando":"echo due","spiegazione":"Scrivo due"}' },
    ] },
    { text: 'RIPRESA A.', ritardoMs: 1500 },
    { text: 'RIPRESA B.' },
    { text: 'RIPRESA C.' },
  ]);
  await chiedi(page, 'scrivi uno e due nel terminale');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Lancio i due comandi' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
  const bottoni = page.locator('.dash-bubble-filo .dash-action-btn');
  console.log('BOTTONI', JSON.stringify(await bottoni.allInnerTexts()));
  console.log('POPUP SUBITO', await page.locator(CONFIRM_HOST).isVisible());
  await bottoni.nth(0).click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, (await page.locator(`${CONFIRM_HOST} [data-act="danger"], ${CONFIRM_HOST} .danger`).count()) ? 'danger' : 'ok');
  await page.waitForTimeout(400);
  console.log('CHIAMATE DOPO 1', (await chiamateAlModello(app)).length);
  console.log('BOTTONI DOPO 1', JSON.stringify(await page.locator('.dash-bubble-filo .dash-action-btn').allInnerTexts()));
  const secondo = page.locator('.dash-bubble-filo .dash-action-btn:not([disabled])', { hasText: /due|Esegui|echo/ }).first();
  if (await secondo.count()) {
    await secondo.click();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
    if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
    await scrollConfirmToEnd(page);
    await clickConfirm(page, (await page.locator(`${CONFIRM_HOST} [data-act="danger"], ${CONFIRM_HOST} .danger`).count()) ? 'danger' : 'ok');
  }
  await page.waitForTimeout(4000);
  const ch = await chiamateAlModello(app);
  console.log('CHIAMATE FINE', ch.length);
  for (const c of ch.slice(1)) console.log('ULTIMO', JSON.stringify(c[c.length - 1]).slice(0, 900));
  console.log('BOLLE', JSON.stringify(await page.locator('.dash-bubble-filo').allInnerTexts()));
  await page.screenshot({ path: 'tests/.shots/v1685-t2.png' });
  await ripristina(app);
});

test('T3 /clear in una home, l\'altra già aperta sulla stessa conversazione non ci scrive più', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Ciao a te.' }, { text: 'Di niente.' }]);
  await chiedi(page, 'ciao filo');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ciao a te' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  const b = await openTab('filo://newtab/');
  await expect(b.locator('.dash-bubble-user', { hasText: 'ciao filo' })).toBeVisible({ timeout: 10_000 });
  await shell.locator('.tab').first().click();
  await chiedi(page, '/clear');
  const chiusa = (await chatCon(app, 'ciao filo')).id;
  await expect.poll(async () => (await chatsDellaHome(app)).find((c) => c.id === chiusa)?.finita, { timeout: 8_000 }).toBe(true);
  await shell.locator('.tab').nth(1).click();
  await page.waitForTimeout(500);
  console.log('NOTA B', JSON.stringify(await b.locator('.dash-bubble-note').allInnerTexts()));
  await chiedi(b, 'grazie');
  await expect(b.locator('.dash-bubble-filo', { hasText: 'Di niente.' })).toBeVisible({ timeout: 10_000 });
  const dove = await chatCon(app, 'grazie');
  expect(dove.id).not.toBe(chiusa);
  await b.screenshot({ path: 'tests/.shots/v1685-t3.png' });
  await ripristina(app);
});
