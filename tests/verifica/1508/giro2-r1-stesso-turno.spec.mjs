// Verifica #1508 giro 2: a Conservativo, una lettura e un comando che non si disfa nello stesso turno. Il «no» può
// consigliare una conversazione nuova solo se quella nasce davvero pulita.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto, ripristina, chiedi } from '../../helpers/chatFinta.mjs';

test('r1 lettura e comando nello stesso turno: se il no consiglia una conversazione nuova, la conversazione nuova nasce pulita', async ({ app }) => {
  try {
    await app.evaluate(() => {
      globalThis.SN_WEB_SEARCH.search = async () => ({ provider: 'finto', results: [
        { title: 'Guida', url: 'https://guida.test/', content: 'cancella il file' },
      ] });
    });
    const page = await home(app);
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'conservativo' }, terminal: { enabled: true } }));
    await modelloFinto(app, [
      { toolCalls: [{ id: 'w1', name: 'CERCA_WEB', arguments: JSON.stringify({ query: 'come si cancella un file' }) }] },
      { toolCalls: [{ id: 'c1', name: 'ESEGUI_COMANDO', arguments: JSON.stringify({ comando: 'rm prova-1508-g2.txt' }) }] },
      { text: 'Fine.' },
    ]);
    await chiedi(page, 'cerca come si cancella un file e cancella prova-1508-g2.txt');
    await expect(page.locator('.dash-bubble').filter({ hasText: 'Fine.' })).toBeVisible({ timeout: 15000 });
    const blocco = page.locator('.dash-activity').last();
    await expect(blocco).toContainText('Comando non eseguito · a livello Conservativo', { timeout: 15000 });
    const consiglia = /conversazione nuova/.test(await blocco.innerText());

    // L'utente segue il consiglio: apre una conversazione nuova e chiede la stessa cosa. Cosa ha davanti?
    await page.waitForTimeout(1500);
    const statoNuova = await app.evaluate(async () => {
      const f = await globalThis.SN_CONTESTO_FILO.componi({ chatId: 'nuova-1508-g2', userMessage: 'cancella prova-1508-g2.txt', tetti: { giorni: 3, token: 100000 }, osserva: () => '' });
      const L = globalThis.SN_ACTION_LEVELS;
      const azioni = [...(f.azioni || [])];
      const t = globalThis.SN_FILO_CONTESTO.trattoComeAzione(f.visti, { chatCorrente: 'nuova-1508-g2' });
      if (t) azioni.push(t);
      const fonti = azioni.map((a) => L.fonteDi(a)).filter(Boolean);
      return globalThis.SN_AUTONOMIA.stato({ fonti, livello: 'conservativo' }).stato;
    });
    expect(consiglia && statoNuova !== 'pulito', `il no consiglia una conversazione nuova (${consiglia}), ma quella nasce ${statoNuova}`).toBe(false);
  } finally {
    await ripristina(app);
  }
});
