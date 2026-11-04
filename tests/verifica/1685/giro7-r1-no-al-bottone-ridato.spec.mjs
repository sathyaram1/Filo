// Verifica #1685 giro 7, rilievo 1: riaperta la chat, un no al bottone ridato a una conferma rimasta in sospeso resta
// un no come in diretta: il lavoro non riparte, e il modello non viene invitato a continuare senza sapere del no.
import { test, expect } from '../../fixtures/electron.mjs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from '../../helpers/chatFinta.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, CONFIRM_HOST } from '../../helpers/confirm.mjs';
import { cartellaTemporanea, togliCartella } from '../../helpers/percorsi.mjs';

const chatCon = (app, testo) => app.evaluate((_e, t) => globalThis.SN_FILO_CHATS.list()
  .then((l) => l.filter((c) => !c.app).find((c) => c.messages.some((m) => m.text === t)) || null), testo);
const mkdir = (dir, nome) => ({ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: `mkdir "${join(dir, nome)}"`, spiegazione: `Creo la cartella ${nome}` }) });

test('r1 riaperta la chat, un no al bottone ridato non fa ripartire il lavoro', async ({ app }) => {
  test.setTimeout(60_000);
  const dir = cartellaTemporanea('verifica-1685-');
  try {
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: true } }));
    await livelloAutonomia(app, 'conservativo');
    await modelloFinto(app, [{ text: 'Creo la cartella.', toolCalls: [mkdir(dir, 'sette')] }, { text: 'Aspetto il tuo OK.' }, { text: 'RIPARTITO DOPO IL NO' }]);
    await chiedi(page, 'crea la cartella sette');
    await expect(page.locator('#sendBtn')).toBeVisible({ timeout: 10_000 });
    const chat = await chatCon(app, 'crea la cartella sette');
    await app.evaluate((_e, c) => globalThis.SN_CLOSE_FILO_CHAT(c), chat.id);
    await page.goto(`filo://dashboard/dashboard.html?chat=${encodeURIComponent(chat.id)}`);
    const bottone = page.locator('.dash-bubble-filo .dash-action-btn', { hasText: 'Creo la cartella sette' });
    await expect(bottone).toBeVisible({ timeout: 8_000 });
    const prima = (await chiamateAlModello(app)).length;
    await bottone.click();
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 5_000 });
    await clickConfirm(page, 'cancel');
    await expect.poll(async () => (await chatCon(app, 'crea la cartella sette')).messages.flatMap((m) => m.esiti || []).map((v) => `${v.esito}:${v.motivo || ''}`), { timeout: 8_000 })
      .toEqual(['fallito:detto no alla conferma']);
    await page.waitForTimeout(2500);
    expect(existsSync(join(dir, 'sette'))).toBe(false);
    const dopo = await chiamateAlModello(app);
    expect(dopo.length > prima ? JSON.stringify(dopo[dopo.length - 1].slice(-1)) : '', 'un no non richiama il modello, come in diretta').toBe('');
    await expect(page.locator('.dash-bubble-filo', { hasText: 'RIPARTITO DOPO IL NO' })).toHaveCount(0);
  } finally {
    await ripristina(app);
    togliCartella(dir);
  }
});
