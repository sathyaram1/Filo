// Verifica #1685 giro 8, rilievo 2: riaperta la chat, due conferme rimaste in sospeso nella stessa risposta valgono
// come un passo solo anche coi bottoni ridati: Filo riprende dopo il secondo OK, una volta, con tutti e due gli esiti.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;
const accoda = (id, file, spiegazione) => ({ id, name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `echo x >> "${file}"`, spiegazione }) });
const righe = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter((r) => r.trim()).length : 0);
async function okAlBottone(page, bottone) {
  await bottone.click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
  await expect(bottone).toHaveText(/^✓/, { timeout: 10_000 });
}

test('r2 riaperta la chat, due conferme ridate della stessa risposta: Filo riprende solo dopo il secondo OK', async ({ app }) => {
  test.setTimeout(90_000);
  const dir = cartellaTemporanea('giro8-ridate-');
  const f = join(dir, 'conta.txt');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [
      { text: 'Accodo due righe.', toolCalls: [accoda('c1', f, 'Accodo la prima'), accoda('c2', f, 'Accodo la seconda')] },
      { text: 'Aspetto il tuo OK.' }, { text: 'RIPRESO' }, { text: 'RIPRESO DI NUOVO' },
    ]);
    await chiedi(page, 'accoda due righe');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const chat = await chatCon(app, 'accoda due righe');
    await app.evaluate((_e, id) => globalThis.SN_CONTESTO_FILO.dimentica(id), chat.id);
    await app.evaluate((_e, id) => globalThis.SN_CLOSE_FILO_CHAT(id), chat.id);
    await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
    const prima = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Accodo la prima' });
    const seconda = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Accodo la seconda' });
    await expect(prima).toBeVisible({ timeout: 8_000 });
    await expect(seconda).toBeVisible({ timeout: 8_000 });
    const n0 = (await chiamateAlModello(app)).length;

    await okAlBottone(page, prima);
    await page.waitForTimeout(2000);
    expect((await chiamateAlModello(app)).length - n0, 'con la seconda ancora da confermare il lavoro non riparte').toBe(0);

    await okAlBottone(page, seconda);
    await expect.poll(() => righe(f), { timeout: 8_000 }).toBe(2);
    await expect.poll(async () => (await chiamateAlModello(app)).length - n0, { timeout: 8_000 }).toBe(1);
    const ch = await chiamateAlModello(app);
    expect((JSON.stringify(ch[ch.length - 1]).match(/fatta: Comando eseguito/g) || []).length, 'la ripresa porta tutti e due gli esiti')
      .toBeGreaterThanOrEqual(2);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});
