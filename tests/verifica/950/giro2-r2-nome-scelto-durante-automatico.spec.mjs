// #950 giro 2, rilievo 2: col nome automatico degli scaricamenti acceso, il nome scritto a mano mentre Filo
// sta ancora leggendo il file appena scaricato resta quello scelto, non viene sostituito dal nome automatico.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

test('nome scritto a mano mentre il nome automatico è ancora in arrivo: resta quello scritto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILE_NAME]: 'gemma' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => {
      await new Promise((r) => setTimeout(r, 4000));
      return { text: 'Bolletta automatica', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });
  const pref = await openTab('filo://preferences/preferences.html');
  await pref.locator('#nomiSensatiScaricamenti').check();
  await expect.poll(() => app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    return !!(s.nomiSensati && s.nomiSensati.scaricamenti);
  })).toBe(true);

  const corpo = Buffer.from('Bolletta della luce di marzo');
  const srv = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="scan_00555.txt"' }); res.end(corpo); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/scan_00555.txt`;
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body><a id="dl" href="${url}">Scarica</a></body></html>`);
    await page.locator('#dl').click();
    let rec = null;
    await expect.poll(async () => {
      const r = await shell.evaluate(() => window.filoShell.downloads.list());
      rec = ((r && r.items) || []).find((it) => it.url === url) || null;
      return rec ? rec.state : null;
    }, { timeout: 20000 }).toBe('completed');

    // Filo sta ancora leggendo il file (quattro secondi): l'utente gli dà un nome suo dagli Scaricamenti.
    const dl = await openTab('filo://downloads/downloads.html');
    const voce = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'scan_00555.txt' }) });
    await voce.click({ button: 'right' });
    await dl.locator('.dl-ctxmenu .sn-select-option', { hasText: 'Dai un nome sensato' }).click();
    const campo = dl.locator('.sn-rinomina-campo');
    await campo.fill('Luce marzo scelto da me');
    await campo.press('Enter');
    await expect(dl.locator('.sn-rinomina-esito-testo')).toHaveText('Rinominato: Luce marzo scelto da me.txt', { timeout: 15000 });

    const scelto = join(rec.savePath, '..', 'Luce marzo scelto da me.txt');
    // Passato il tempo della lettura automatica, il nome scelto dall'utente è ancora lì.
    await dl.waitForTimeout(6000);
    expect(existsSync(join(rec.savePath, '..', 'Bolletta automatica.txt'))).toBe(false);
    expect(existsSync(scelto)).toBe(true);
  } finally { await new Promise((r) => srv.close(r)); }
});
