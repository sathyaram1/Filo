// Esplorazione del giro 12 di #1685: conferma lenta che finisce dopo /clear, doppio clic sul bottone.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;
const cmd = (id, comando, spiegazione) => ({ id, name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando, spiegazione }) });

test('esplora: conferma lenta, /clear mentre il comando gira', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('esplora12-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    const f = join(dir, 'fine.txt');
    await modelloFinto(app, [
      { text: 'Lancio il comando lungo.', toolCalls: [cmd('c1', `sleep 5; echo fatto > "${f}"`, 'Comando lungo')] },
      { text: 'Aspetto il tuo OK.' },
      { text: 'RIPRESO dopo il comando lungo.' },
      { text: 'Risposta nella nuova.' },
    ]);
    await chiedi(page, 'lancia il comando lungo');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const nata = await chatCon(app, 'lancia il comando lungo');
    const bottone = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Comando lungo' });
    await bottone.click();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
    if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
    await scrollConfirmToEnd(page);
    await clickConfirm(page, 'ok');
    await page.waitForTimeout(800);
    await chiedi(page, '/clear');
    await expect.poll(() => existsSync(f), { timeout: 15_000 }).toBe(true);
    await page.waitForTimeout(4000);
    const tutte = await chatsDellaHome(app);
    console.log('CHIAMATE', (await chiamateAlModello(app)).length);
    for (const c of tutte) console.log('CHAT', c.id, c.id === nata.id ? '(nata)' : '', JSON.stringify(c.messages.map((m) => ({ r: m.role, t: m.text, e: (m.esiti || []).map((v) => `${v.esito}:${v.riga}`) }))));
    console.log('SCHERMO', await page.locator('#messages, .dash-thread').first().innerText().catch(() => '?'));
    await page.screenshot({ path: 'tests/.shots/esplora12-lenta.png' });
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

test('esplora: doppio clic sul bottone di conferma', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('esplora12-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    const f = join(dir, 'righe.txt');
    await modelloFinto(app, [
      { text: 'Accodo la riga.', toolCalls: [cmd('c1', `echo riga >> "${f}"`, 'Accodo una riga')] },
      { text: 'Aspetto il tuo OK.' },
      { text: '' },
    ]);
    await chiedi(page, 'accoda una riga');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const bottone = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Accodo una riga' });
    await bottone.dblclick();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
    console.log('POPUP', await page.locator(CONFIRM_HOST).count());
    if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
    await scrollConfirmToEnd(page);
    await clickConfirm(page, 'ok');
    await page.waitForTimeout(1500);
    console.log('POPUP DOPO', await page.locator(CONFIRM_HOST).count(), await page.locator(CONFIRM_HOST).isVisible().catch(() => false));
    if (await page.locator(CONFIRM_HOST).isVisible().catch(() => false)) {
      await scrollConfirmToEnd(page);
      await clickConfirm(page, 'ok').catch(() => {});
    }
    await page.waitForTimeout(2500);
    console.log('RIGHE', existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0);
    console.log('CHIAMATE', (await chiamateAlModello(app)).length);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});
