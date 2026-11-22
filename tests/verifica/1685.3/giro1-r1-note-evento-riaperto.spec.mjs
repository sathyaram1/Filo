// Verifica #1685.3 giro 1, rilievo 1: riaperta la chat, «Aggiungi al calendario» mette nel calendario lo stesso evento
// della proposta in diretta, note comprese: andate a capo e testo oltre i 500 caratteri restano.
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { home, modelloFinto, chiedi, ripristina } from '../../helpers/chatFinta.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;
// La DESCRIPTION del file .ics, con le sue righe di continuazione, come la legge il programma di calendario.
const descrizioni = async (app) => (await app.evaluate(() => globalThis.__icsAperti || [])).map((f) => {
  const testo = readFileSync(f, 'utf8').replace(/\r?\n[ \t]/g, '');
  return ((testo.match(/^DESCRIPTION:([^\r\n]*)/m) || [])[1] || '').replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
});

const NOTE = `Portare:\n- passaporto\n- biglietti\n${'Ritrovo davanti alla stazione, binario 4. '.repeat(20).trim()}`;

test('r1 riaperta, il bottone del calendario porta le note intere, con le andate a capo', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate(({ shell }) => {
    globalThis.__openPathVero = shell.openPath;
    globalThis.__icsAperti = [];
    shell.openPath = async (f) => { globalThis.__icsAperti.push(f); return ''; };
  });
  try {
    const args = { data: '2026-12-10', ora: '09:00', titolo: 'Partenza', dettagli: NOTE };
    await modelloFinto(app, [{ text: 'Ecco.', toolCalls: [{ id: 'e1', name: 'EVENTO_CALENDARIO', arguments: JSON.stringify(args) }] }, { text: '' }]);
    await chiedi(page, 'segna la partenza del 10 dicembre alle 9 con le note');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const bottone = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Aggiungi al calendario' });
    await bottone.first().click();
    await expect.poll(async () => (await descrizioni(app)).length, { timeout: 10_000 }).toBe(1);
    const [inDiretta] = await descrizioni(app);
    expect(inDiretta, 'in diretta le note arrivano intere').toBe(NOTE);

    // Una seconda proposta uguale, lasciata lì: riaperta la chat, il suo bottone deve portare le stesse note.
    await modelloFinto(app, [{ text: 'Ecco di nuovo.', toolCalls: [{ id: 'e2', name: 'EVENTO_CALENDARIO', arguments: JSON.stringify(args) }] }, { text: '' }]);
    await chiedi(page, 'proponimela di nuovo');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const chat = await chatCon(app, 'segna la partenza del 10 dicembre alle 9 con le note');
    await app.evaluate((_e, c) => globalThis.SN_CONTESTO_FILO.dimentica(c), chat.id);
    await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), chat.id);
    await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
    await expect(bottone, 'riaperta, la proposta lasciata lì ha ancora il suo bottone').toHaveCount(1, { timeout: 8_000 });
    await bottone.first().click();
    await expect.poll(async () => (await descrizioni(app)).length, { timeout: 10_000 }).toBe(2);
    const [, riaperta] = await descrizioni(app);
    expect(riaperta, 'dal bottone della chat riaperta le note sono le stesse della diretta').toBe(NOTE);
  } finally {
    await app.evaluate(({ shell }) => { if (globalThis.__openPathVero) shell.openPath = globalThis.__openPathVero; });
    await ripristina(app);
  }
});
