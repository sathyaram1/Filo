// Verifica #2091 giro 1, rilievo 1: il messaggio con una scheda, riletto dal filo (home nuova, home ricaricata), tiene il
// gettone e non mostra i segni ⟦ ⟧.

import { test, expect } from '../../fixtures/electron.mjs';
import { home, modelloFinto } from '../../helpers/chatFinta.mjs';

const ARTICOLO = `<!doctype html><html><head><meta charset="utf-8"><title>Articolo sulla Tesla volante</title></head>
  <body style="font:16px sans-serif;padding:40px"><p>Testo-segreto-2091 della pagina.</p></body></html>`;

// Il rilascio sul campo della home dalla stessa strada della barra: la shell dice al main dove ha lasciato la scheda.
async function lasciaNellaHome(app, shell, casa, id) {
  const r = await casa.locator('#input').boundingBox();
  const b = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    return tm.tabs.find((x) => x.id === tm.activeId).view.getBounds();
  });
  await shell.evaluate((d) => window.filoShell.schedaFuori(d), { fase: 'lascia', id, x: b.x + r.x + 20, y: b.y + r.y + r.height / 2 });
}

test('r1 il messaggio con una scheda riletto da una home nuova e dalla home ricaricata tiene il gettone', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await testServer.openReady(openTab, ARTICOLO);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await modelloFinto(app, [{ text: 'Risposta finta.' }]);
  const nuova = await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab'));
  const casa = await home(app, { scheda: nuova?.id });
  await casa.locator('#input').fill('di cosa parla');
  await lasciaNellaHome(app, shell, casa, id);
  await expect.poll(() => casa.evaluate(() => document.getElementById('input')._snGettoni?.schede().length || 0)).toBe(1);
  await casa.locator('#sendBtn').click();
  await expect(casa.locator('.sn-bolla-gettone')).toHaveCount(1);
  await expect(casa.getByText('Risposta finta.')).toBeVisible();

  const altra = await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab'));
  const casa2 = await home(app, { scheda: altra?.id });
  await expect(casa2.getByText('Risposta finta.')).toBeVisible({ timeout: 10_000 });
  await expect(casa2.locator('.sn-bolla-gettone')).toHaveCount(1, { timeout: 10_000 });
  await expect(casa2.locator('.dash-bubble-user').filter({ hasText: 'di cosa parla' })).not.toContainText('⟦');

  await casa.reload();
  await casa.waitForLoadState('domcontentloaded');
  await expect(casa.getByText('Risposta finta.')).toBeVisible({ timeout: 10_000 });
  await expect(casa.locator('.sn-bolla-gettone')).toHaveCount(1, { timeout: 10_000 });
  await expect(casa.locator('.dash-bubble-user').filter({ hasText: 'di cosa parla' })).not.toContainText('⟦');
});
