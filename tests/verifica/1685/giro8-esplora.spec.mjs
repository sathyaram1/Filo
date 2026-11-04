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

test('due home: conversazione cancellata, B scrive', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await modelloFinto(app, [{ text: 'Ciao a te.' }, { text: 'Di niente.' }]);
  await chiedi(page, 'ciao filo');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ciao a te' })).toBeVisible({ timeout: 10_000 });
  const id = (await chatCon(app, 'ciao filo')).id;
  const b = await openTab('filo://newtab/');
  await expect(b.locator('.dash-bubble-user', { hasText: 'ciao filo' })).toBeVisible({ timeout: 10_000 });
  await app.evaluate((_e, c) => globalThis.SN_FILO_CHATS.remove(c), id);
  await b.waitForTimeout(1500);
  console.log('B dopo cancellazione', await b.locator('.dash-bubble-user, .dash-bubble-filo').allTextContents());
  await chiedi(b, 'grazie');
  await expect(b.locator('.dash-bubble-filo', { hasText: 'Di niente.' })).toBeVisible({ timeout: 10_000 });
  for (const c of await chatsDellaHome(app)) console.log('CHAT', c.id === id ? 'CANCELLATA' : 'altra', JSON.stringify(c.messages.map((m) => [m.role, m.text])));
  const ch = await chiamateAlModello(app);
  console.log('ULTIMA', JSON.stringify(ch[ch.length - 1].map((m) => [m.role, String(m.content).slice(-80)])));
  await ripristina(app);
});

test('comando lento confermato, poi /clear e un messaggio nuovo', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('g8-');
  const f = join(dir, 'conta.txt');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    const lento = { id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `sleep 4 && echo x >> "${f}"`, spiegazione: 'Accodo piano' }) };
    await modelloFinto(app, [{ text: 'Accodo.', toolCalls: [lento] }, { text: 'Aspetto.' }, { text: 'RISPOSTA A1', ritardoMs: 100 }, { text: 'RISPOSTA B' }, { text: 'RISPOSTA C' }]);
    await chiedi(page, 'accoda piano');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const nata = (await chatCon(app, 'accoda piano')).id;
    await okAlBottone(page, page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Accodo piano' }));
    await page.waitForTimeout(500);
    await chiedi(page, '/clear');
    await page.waitForTimeout(300);
    await chiedi(page, 'nuovo argomento');
    await expect.poll(() => righe(f), { timeout: 15_000 }).toBe(1);
    await page.waitForTimeout(3000);
    console.log('BOLLE', await page.locator('.dash-bubble-user, .dash-bubble-filo').allTextContents());
    for (const c of await chatsDellaHome(app)) console.log('CHAT', c.id === nata ? 'NATA' : 'altra', JSON.stringify(c.messages.map((m) => [m.role, m.text, (m.esiti || []).map((v) => v.esito)])));
    const ch = await chiamateAlModello(app);
    console.log('N CHIAMATE', ch.length);
    console.log('ULTIMA', JSON.stringify(ch[ch.length - 1].map((m) => [m.role, String(m.content).slice(-160)])));
  } finally { await ripristina(app); togliCartella(dir); }
});

for (const [nome, call] of [
  ['memoria', { id: 'm1', name: 'CANCELLA_MEMORIA', arguments: '{}' }],
  ['pagine', { id: 'p1', name: 'CANCELLA_PAGINE', arguments: '{"periodo":"tutto"}' }],
  ['pref', { id: 'q1', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"modalita_terminale","valore":true}' }],
]) {
  test(`pendente mai toccato: ${nome}`, async ({ app }) => {
    test.setTimeout(60_000);
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: false } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ text: '', toolCalls: [call] }, { text: 'Aspetto.' }, { text: 'ok' }]);
    await chiedi(page, `fai ${nome}`);
    await page.waitForTimeout(2500);
    const popup = await page.locator(CONFIRM_HOST).count();
    console.log(nome, 'POPUP', popup, 'BOTTONI', await page.locator('.dash-bubble-filo .dash-action-btn').allTextContents(), 'RIGHE', await page.locator('.dash-activity-row').allTextContents());
    const c = await chatCon(app, `fai ${nome}`);
    await app.evaluate((_e, id) => globalThis.SN_CONTESTO_FILO.dimentica(id), c.id);
    await app.evaluate((_e, id) => globalThis.SN_CLOSE_FILO_CHAT(id), c.id);
    await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(c.id)}`);
    await page.waitForTimeout(2000);
    console.log(nome, 'RIAP BOTTONI', await page.locator('.dash-bubble-filo .dash-action-btn').allTextContents(), 'RIAP RIGHE', await page.locator('.dash-activity-row').allTextContents());
    await chiedi(page, 'allora?');
    await page.waitForTimeout(2000);
    const ch = await chiamateAlModello(app);
    const u = ch[ch.length - 1];
    console.log(nome, 'MODELLO', JSON.stringify(u.filter((m) => m.role !== 'system').map((m) => String(m.content).slice(0, 300))).slice(0, 1500));
    await ripristina(app);
  });
}

test('due conferme ridate dopo la riapertura', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('g8-');
  const f = join(dir, 'conta.txt');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ text: 'Accodo due volte.', toolCalls: [accoda('c1', f, 'Accodo la prima'), accoda('c2', f, 'Accodo la seconda')] }, { text: 'Aspetto.' }, { text: 'RIPRESO' }, { text: 'RIPRESO2' }]);
    await chiedi(page, 'accoda due righe');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const c = await chatCon(app, 'accoda due righe');
    await app.evaluate((_e, id) => globalThis.SN_CONTESTO_FILO.dimentica(id), c.id);
    await app.evaluate((_e, id) => globalThis.SN_CLOSE_FILO_CHAT(id), c.id);
    await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(c.id)}`);
    const b1 = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Accodo la prima' });
    const b2 = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Accodo la seconda' });
    await expect(b1).toBeVisible({ timeout: 8_000 });
    await expect(b2).toBeVisible({ timeout: 8_000 });
    const n0 = (await chiamateAlModello(app)).length;
    await okAlBottone(page, b1);
    await page.waitForTimeout(2500);
    console.log('dopo primo OK chiamate +', (await chiamateAlModello(app)).length - n0, await page.locator('.dash-bubble-filo').allTextContents());
    await okAlBottone(page, b2);
    await page.waitForTimeout(2500);
    console.log('dopo secondo OK chiamate +', (await chiamateAlModello(app)).length - n0, 'righe', righe(f));
    const ch = await chiamateAlModello(app);
    console.log('ULTIMA', JSON.stringify(ch[ch.length - 1].slice(-2).map((m) => [m.role, String(m.content).slice(-400)])));
    const c2 = await chatCon(app, 'accoda due righe');
    console.log('MESSAGGI', JSON.stringify(c2.messages.map((m) => [m.role, m.text, (m.esiti || []).map((v) => v.esito)])));
  } finally { await ripristina(app); togliCartella(dir); }
});
