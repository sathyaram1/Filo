// Verifica #1685 giro 8: esplorazione.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;
const accoda = (id, file, spieg) => ({ id, name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `echo x >> "${file}"`, spiegazione: spieg }) });
const righe = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0);
async function okAlBottone(page, bottone) {
  await bottone.click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
}

test('esc sul popup', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('g8-');
  const f = join(dir, 'conta.txt');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ text: '', toolCalls: [{ id: 'f1', name: 'INVIA_FEEDBACK', arguments: '{"testo":"Il timer non suona.","titolo":"Timer muto"}' }] }, { text: 'RIPRESO' }, { text: 'ok' }]);
    await chiedi(page, 'accoda una riga');
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    console.log('POPUP dopo esc', await page.locator(CONFIRM_HOST).count());
    console.log('BOTTONI', await page.locator('.dash-bubble-filo .dash-action-btn').allTextContents());
    console.log('RIGHE', await page.locator('.dash-activity-row').allTextContents());
    const c = await chatCon(app, 'accoda una riga');
    console.log('ESITI', JSON.stringify(c.messages.flatMap((m) => m.esiti || [])));
    console.log('CHIAMATE', (await chiamateAlModello(app)).length);
    await app.evaluate((_e, id) => globalThis.SN_CONTESTO_FILO.dimentica(id), c.id);
    await app.evaluate((_e, id) => globalThis.SN_CLOSE_FILO_CHAT(id), c.id);
    await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(c.id)}`);
    await page.waitForTimeout(2000);
    console.log('RIAP BOTTONI', await page.locator('.dash-bubble-filo .dash-action-btn').allTextContents());
    console.log('RIAP RIGHE', await page.locator('.dash-activity-row').allTextContents());
  } finally { await ripristina(app); togliCartella(dir); }
});

test('due home: bottone in sospeso cliccato in entrambe', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('g8-');
  const f = join(dir, 'conta.txt');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ text: 'Accodo.', toolCalls: [accoda('c1', f, 'Accodo una riga')] }, { text: 'Aspetto.' }, { text: 'RIPRESO' }, { text: 'RIPRESO2' }]);
    await chiedi(page, 'accoda una riga');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    console.log('A BOTTONI dopo annulla', await page.locator('.dash-bubble-filo .dash-action-btn').allTextContents());
    const b = await openTab('filo://newtab/');
    await expect(b.locator('.dash-bubble-user', { hasText: 'accoda una riga' })).toBeVisible({ timeout: 10_000 });
    const btnB = b.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Accodo una riga' });
    console.log('B BOTTONI', await b.locator('.dash-bubble-filo .dash-action-btn').allTextContents());
    await shell.locator('.tab').first().click();
    const btnA = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Accodo una riga' });
    await okAlBottone(page, btnA);
    await expect.poll(() => righe(f), { timeout: 8_000 }).toBe(1);
    await page.waitForTimeout(1500);
    await shell.locator('.tab').nth(1).click();
    console.log('B BOTTONI dopo OK in A', await b.locator('.dash-bubble-filo .dash-action-btn').allTextContents());
    if (await btnB.count() && !/^✓/.test(await btnB.first().textContent())) {
      await btnB.first().click();
      await page.waitForTimeout(800);
      console.log('POPUP in B', await b.locator(CONFIRM_HOST).count());
      if (await b.locator(CONFIRM_HOST).count()) {
        if (await b.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(b, 'conferma');
        await scrollConfirmToEnd(b);
        await clickConfirm(b, 'ok');
        await page.waitForTimeout(2000);
      }
    }
    console.log('RIGHE NEL FILE', righe(f));
    console.log('CHIAMATE', (await chiamateAlModello(app)).length);
    const c = await chatCon(app, 'accoda una riga');
    console.log('MESSAGGI', JSON.stringify(c.messages.map((m) => [m.role, m.text, (m.esiti || []).map((v) => v.esito)])));
  } finally { await ripristina(app); togliCartella(dir); }
});

test('due home: OK in B dopo /clear in A', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('g8-');
  const f = join(dir, 'conta.txt');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ text: 'Accodo.', toolCalls: [accoda('c1', f, 'Accodo una riga')] }, { text: 'Aspetto.' }, { text: 'RIPRESO DOPO OK' }, { text: 'altro' }]);
    await chiedi(page, 'accoda una riga');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const nata = (await chatCon(app, 'accoda una riga')).id;
    const b = await openTab('filo://newtab/');
    await expect(b.locator('.dash-bubble-user', { hasText: 'accoda una riga' })).toBeVisible({ timeout: 10_000 });
    await shell.locator('.tab').first().click();
    await chiedi(page, '/clear');
    await expect.poll(async () => (await chatsDellaHome(app)).find((c) => c.id === nata)?.finita, { timeout: 8_000 }).toBe(true);
    await shell.locator('.tab').nth(1).click();
    await page.waitForTimeout(1000);
    console.log('B testo', (await b.locator('#chat, body').first().innerText()).slice(0, 600));
    const btnB = b.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Accodo una riga' });
    console.log('B BOTTONI', await b.locator('.dash-bubble-filo .dash-action-btn').allTextContents());
    if (await btnB.count()) {
      await okAlBottone(b, btnB.first());
      await expect.poll(() => righe(f), { timeout: 8_000 }).toBe(1);
      await page.waitForTimeout(2500);
    }
    console.log('CHIAMATE', (await chiamateAlModello(app)).length);
    for (const c of await chatsDellaHome(app)) console.log('CHAT', c.id === nata ? 'NATA' : 'altra', c.finita, JSON.stringify(c.messages.map((m) => [m.role, m.text, (m.esiti || []).map((v) => v.esito)])));
    console.log('B BOLLE', await b.locator('.dash-bubble-filo, .dash-bubble-user').allTextContents());
    await chiedi(b, 'e ora?');
    await page.waitForTimeout(2500);
    for (const c of await chatsDellaHome(app)) console.log('CHAT2', c.id === nata ? 'NATA' : 'altra', c.finita, JSON.stringify(c.messages.map((m) => [m.role, m.text])));
  } finally { await ripristina(app); togliCartella(dir); }
});

test('doppio clic rapido sul bottone ridato', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('g8-');
  const f = join(dir, 'conta.txt');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ text: 'Accodo.', toolCalls: [accoda('c1', f, 'Accodo una riga')] }, { text: 'Aspetto.' }, { text: 'RIPRESO' }, { text: 'RIPRESO2' }]);
    await chiedi(page, 'accoda una riga');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const c = await chatCon(app, 'accoda una riga');
    await app.evaluate((_e, id) => globalThis.SN_CLOSE_FILO_CHAT(id), c.id);
    await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(c.id)}`);
    const btn = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Accodo una riga' });
    await expect(btn).toBeVisible({ timeout: 8_000 });
    await okAlBottone(page, btn);
    await page.waitForTimeout(300);
    console.log('BOTTONE dopo OK', await btn.textContent());
    await btn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(800);
    if (await page.locator(CONFIRM_HOST).count()) { await scrollConfirmToEnd(page); await clickConfirm(page, 'ok'); }
    await page.waitForTimeout(2500);
    console.log('RIGHE NEL FILE', righe(f), 'CHIAMATE', (await chiamateAlModello(app)).length);
    console.log('BOLLE', await page.locator('.dash-bubble-filo').allTextContents());
    // seconda riapertura
    await app.evaluate((_e, id) => globalThis.SN_CONTESTO_FILO.dimentica(id), c.id);
    await app.evaluate((_e, id) => globalThis.SN_CLOSE_FILO_CHAT(id), c.id);
    await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(c.id)}`);
    await page.waitForTimeout(1500);
    console.log('RIAPERTA', await page.locator('.dash-bubble-filo').allTextContents());
    console.log('BOTTONI RIAPERTA', await page.locator('.dash-bubble-filo .dash-action-btn').allTextContents());
    const c2 = await chatCon(app, 'accoda una riga');
    console.log('MESSAGGI', JSON.stringify(c2.messages.map((m) => [m.role, m.text, (m.esiti || []).map((v) => `${v.esito}|${v.riga}`)])));
  } finally { await ripristina(app); togliCartella(dir); }
});
