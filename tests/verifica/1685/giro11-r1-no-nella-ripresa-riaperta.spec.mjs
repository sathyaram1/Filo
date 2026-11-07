// Verifica #1685 giro 11, rilievo 1: riaperta la chat, due conferme in sospeso nella stessa risposta, OK alla prima e
// no alla seconda: la ripresa deve dire al modello che la seconda ha avuto un no, non che aspetta ancora la conferma.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, scrollConfirmToEnd, fillConfirmInput, CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const chatsDellaHome = (app) => app.evaluate(() => globalThis.SN_FILO_CHATS.list().then((l) => l.filter((c) => !c.app)));
const chatCon = async (app, testo) => (await chatsDellaHome(app)).find((c) => c.messages.some((m) => m.text === testo)) || null;
async function rispondi(page, bottone, ok) {
  await bottone.click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
  if (ok && await page.locator(`${CONFIRM_HOST} input`).count()) await fillConfirmInput(page, 'conferma');
  if (ok) await scrollConfirmToEnd(page);
  await clickConfirm(page, ok ? 'ok' : 'cancel');
}
const mkdir = (id, dir, nome) => ({ id, name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `mkdir "${join(dir, nome)}"`, spiegazione: `Creo la cartella ${nome}` }) });

test('r1 riaperta, OK a un comando e no all\'altro della stessa risposta: la ripresa dice al modello il no', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('giro11-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [
      { text: 'Creo le due cartelle.', toolCalls: [mkdir('c1', dir, 'sei'), mkdir('c2', dir, 'otto')] },
      { text: 'Aspetto i tuoi OK.' },
      { text: 'Fatta la sei.' },
    ]);
    await chiedi(page, 'crea le cartelle sei e otto');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Aspetto i tuoi OK' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const chat = await chatCon(app, 'crea le cartelle sei e otto');
    // Come dopo un riavvio: al modello resta solo quello che l'archivio ha scritto su disco.
    await app.evaluate((_e, c) => globalThis.SN_CONTESTO_FILO.dimentica(c), chat.id);
    await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), chat.id);
    await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);

    const bottoni = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: /Creo la cartella/ });
    await expect(bottoni).toHaveCount(2, { timeout: 8_000 });
    await rispondi(page, bottoni.filter({ hasText: 'sei' }), true);
    await expect(bottoni.filter({ hasText: 'sei' })).toHaveText(/^✓/, { timeout: 10_000 });
    await rispondi(page, bottoni.filter({ hasText: 'otto' }), false);
    await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatta la sei' })).toBeVisible({ timeout: 10_000 });
    expect(existsSync(join(dir, 'otto')), 'il no non crea la cartella').toBe(false);

    const ch = await chiamateAlModello(app);
    expect(ch, 'una ripresa sola, dopo che hanno risposto tutti e due').toHaveLength(3);
    const ripresa = JSON.stringify(ch[2]);
    expect(ripresa, 'la ripresa non racconta il comando rifiutato come ancora in attesa del sì')
      .not.toMatch(/NON fatta: chiesta la conferma all'utente, che allora non l'aveva ancora data: Creo la cartella otto/);
    expect(ripresa, 'il modello che riparte sa che sulla cartella otto l\'utente ha detto no')
      .toMatch(/otto[^"]*detto no alla conferma|detto NO alla conferma[^"]*otto/i);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});
