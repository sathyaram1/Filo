// Verifica #1685 giro 5, rilievo 1: un OK dato al bottone dopo il turno, riaperta la chat dopo un riavvio, si legge
// come fatto: la riga non dice «Conferma chiesta» o «proposto», e il modello non legge «non l'aveva ancora data».
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;
async function riapriDopoRiavvio(app, page, id) {
  await app.evaluate((_e, c) => globalThis.SN_CONTESTO_FILO.dimentica(c), id);
  await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), id);
  await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(id)}`);
}
async function okAlBottone(page, bottone) {
  await expect(bottone).toBeVisible({ timeout: 10_000 });
  await bottone.click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  if (await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
}

test('r1 comando confermato al bottone: riaperta dopo un riavvio, la chat e il modello sanno che è fatto', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('v1685g5-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [
      { text: 'Creo la cartella.', toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `mkdir "${join(dir, 'nuova')}"`, spiegazione: 'Creo la cartella nuova' }) }] },
      { text: '' },
      { text: 'Ok.' },
    ]);
    await chiedi(page, 'crea la cartella nuova');
    await okAlBottone(page, page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Creo la cartella nuova' }));
    await expect(page.locator('.dash-bubble-filo .dash-action-btn', { hasText: /^✓/ })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const chat = await chatCon(app, 'crea la cartella nuova');
    await riapriDopoRiavvio(app, page, chat.id);
    const bolla = page.locator('.dash-bubble-filo', { hasText: 'Creo la cartella.' });
    await expect(bolla).toBeVisible({ timeout: 8_000 });
    await expect(bolla, 'riaperta, un comando fatto non si legge come una conferma ancora da dare').not.toContainText('Conferma chiesta');

    await chiedi(page, 'l\'hai creata?');
    await chiedi(page, 'sicuro?');
    await expect.poll(async () => (await chiamateAlModello(app)).length, { timeout: 10_000 }).toBeGreaterThan(2);
    const ch = await chiamateAlModello(app);
    expect(JSON.stringify(ch[ch.length - 1]), 'dopo un riavvio il modello non legge che la conferma non era stata data').not.toMatch(/non l'aveva ancora data/);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});

test('r1 evento aggiunto col bottone: riaperta, la chat non lo dice di nuovo «proposto»', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await modelloFinto(app, [
    { text: 'Ecco l\'evento.', toolCalls: [{ id: 'e1', name: 'EVENTO_CALENDARIO', arguments: '{"data":"2026-12-01","ora":"10:00","titolo":"Dentista"}' }] },
    { text: 'Ok.' },
  ]);
  await chiedi(page, 'metti il dentista il primo dicembre alle 10');
  const bottone = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'calendario' });
  await expect(bottone).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
  await bottone.click();
  if (await page.locator(CONFIRM_HOST).count()) await clickConfirm(page, 'ok');
  await expect(bottone).toHaveText(/^✓/, { timeout: 10_000 });
  const chat = await chatCon(app, 'metti il dentista il primo dicembre alle 10');
  await riapriDopoRiavvio(app, page, chat.id);
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'Ecco l\'evento.' });
  await expect(bolla).toBeVisible({ timeout: 8_000 });
  await expect(bolla, 'un evento aggiunto col bottone resta aggiunto').not.toContainText('proposto');
  await ripristina(app);
});
