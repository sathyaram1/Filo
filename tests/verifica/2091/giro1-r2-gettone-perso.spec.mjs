// Verifica #2091 giro 1, rilievo 2: un gettone che esce dal campo e ci torna (Annulla dopo Backspace, Taglia e
// Incolla per spostarlo) torna gettone, con la sua scheda; mai i segni ⟦ ⟧ senza scheda.

import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const ARTICOLO = `<!doctype html><html><head><meta charset="utf-8"><title>Articolo sulla Tesla volante</title></head>
  <body style="font:16px sans-serif;padding:40px"><p>Testo-segreto-2091 della pagina.</p></body></html>`;

async function lasciaNellaHome(app, shell, casa, id) {
  const r = await casa.locator('#input').boundingBox();
  const b = await app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    return tm.tabs.find((x) => x.id === tm.activeId).view.getBounds();
  });
  await shell.evaluate((d) => window.filoShell.schedaFuori(d), { fase: 'lascia', id, x: b.x + r.x + 20, y: b.y + r.y + r.height / 2 });
}

async function campoConGettone(app, shell, openTab, testServer) {
  await testServer.openReady(openTab, ARTICOLO);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  const nuova = await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab'));
  const casa = await home(app, { scheda: nuova?.id });
  await casa.locator('#input').fill('guarda');
  await lasciaNellaHome(app, shell, casa, id);
  await expect.poll(() => casa.evaluate(() => document.getElementById('input')._snGettoni?.schede().length || 0)).toBe(1);
  await casa.locator('#input').focus();
  return casa;
}

const stato = (casa) => casa.evaluate(() => ({ v: document.getElementById('input').value, n: document.getElementById('input')._snGettoni.schede().length }));

test('r2 Annulla dopo Backspace: il gettone torna gettone', async ({ app, shell, openTab, testServer }) => {
  const casa = await campoConGettone(app, shell, openTab, testServer);
  await casa.keyboard.press('End');
  await casa.keyboard.press('Backspace');
  await casa.keyboard.press('Backspace');
  await expect.poll(async () => (await stato(casa)).n).toBe(0);
  await casa.keyboard.press('Control+z');
  await expect.poll(async () => (await stato(casa)).v).toContain('⟦');
  expect((await stato(casa)).n).toBe(1);
});

test('r2 Taglia e Incolla per spostare un gettone: resta un gettone', async ({ app, shell, openTab, testServer }) => {
  const casa = await campoConGettone(app, shell, openTab, testServer);
  await casa.evaluate(() => { const t = document.getElementById('input'); t.setSelectionRange(t.value.indexOf('⟦'), t.value.indexOf('⟧') + 1); });
  await casa.keyboard.press('Control+x');
  await casa.keyboard.press('Home');
  await casa.keyboard.press('Control+v');
  await expect.poll(async () => (await stato(casa)).v).toContain('⟦');
  expect((await stato(casa)).n).toBe(1);
});
