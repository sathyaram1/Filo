// Una pagina che si riscrive da capo (document.open) non spegne Filo: il tasto
// destro apre ancora il menu, col suo stile e il suo tema, e le voci funzionano.
// Regola: patterns/un-documento-riscritto-non-spegne-filo.md (#686.1 giro 7).

import { test, expect } from './fixtures/electron.mjs';

async function percentOf(app, page) {
  const url = await page.evaluate(() => location.href);
  const f = await app.evaluate(({ webContents }, u) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here === u) return wc.getZoomFactor();
    }
    return null;
  }, url);
  return f == null ? null : Math.round(f * 100);
}

async function ctrlPiu(app, page) {
  const url = await page.evaluate(() => location.href);
  await app.evaluate(({ webContents }, u) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here !== u) continue;
      wc.sendInputEvent({ type: 'keyDown', keyCode: '=', modifiers: ['control'] });
      wc.sendInputEvent({ type: 'keyUp', keyCode: '=', modifiers: ['control'] });
    }
  }, url);
}

const RISCRITTURE = {
  'in un colpo solo': () => {
    document.open();
    document.write('<!doctype html><html><body style="height:4000px"><h1>riscritta</h1></body></html>');
    document.close();
  },
  'due volte di fila': () => {
    for (let i = 0; i < 2; i++) {
      document.open();
      document.write(`<!doctype html><html><body style="height:4000px"><h1>riscritta ${i}</h1></body></html>`);
      document.close();
    }
  },
  'aprendo prima e scrivendo dopo': () => new Promise((fatto) => {
    document.open();
    setTimeout(() => {
      document.write('<!doctype html><html><body style="height:4000px"><h1>riscritta</h1></body></html>');
      document.close();
      fatto();
    }, 50);
  }),
};

for (const [nome, riscrivi] of Object.entries(RISCRITTURE)) {
  test(`pagina riscritta ${nome}: il tasto destro apre il menu di Filo e la dimensione reale funziona`, async ({ app, openTab, testServer }) => {
    const page = await testServer.openReady(openTab, '<!doctype html><html><body style="height:4000px"><h1>un sito</h1></body></html>');
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
    const tema = await page.evaluate(() => document.documentElement.dataset.snTheme || '');
    expect(tema, 'Filo non ha segnato il tema sulla pagina').not.toBe('');

    await page.evaluate(riscrivi);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.documentElement.dataset.snTheme || ''), 'la pagina riscritta ha perso il tema di Filo').toBe(tema);
    await ctrlPiu(app, page);
    await ctrlPiu(app, page);
    await expect.poll(async () => percentOf(app, page)).toBe(120);

    await page.locator('h1').click({ button: 'right' });
    const menu = page.locator('.sn-menu');
    await expect(menu, 'il tasto destro non apre il menu di Filo').toBeVisible();
    expect(await menu.evaluate((m) => getComputedStyle(m).position), 'il menu è senza il suo stile').toBe('fixed');
    await menu.getByText(/Dimensione reale \(ora 120%\)/).click();
    await expect.poll(async () => percentOf(app, page)).toBe(100);
  });
}

test('il pannello Aiuto aperto se ne va con la pagina riscritta, e si riapre', async ({ shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, '<!doctype html><html><body style="height:4000px"><h1>un sito</h1></body></html>');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await expect(page.locator('.sn-sidebar')).toBeVisible({ timeout: 8000 });

  await page.evaluate(() => {
    document.open();
    document.write('<!doctype html><html><body style="height:4000px"><h1>riscritta</h1></body></html>');
    document.close();
  });
  await expect(page.locator('.sn-sidebar')).toHaveCount(0);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await expect(page.locator('.sn-sidebar'), 'Aiuto non si riapre sulla pagina riscritta').toBeVisible({ timeout: 8000 });
});
