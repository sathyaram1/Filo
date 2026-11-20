// #737.8 giro 2: la finestra di un altro sito che la pagina riporta davanti col clic (w.focus) torna davanti.

import { test, expect } from '../../fixtures/electron.mjs';

const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const url = (t) => { try { return t.view.webContents.getURL(); } catch (_) { return t.url || ''; } };
  const attiva = tm.tabs.find((t) => t.id === tm.activeId);
  return { attiva: attiva ? url(attiva) : '', schede: tm.tabs.map(url), attivaId: tm.activeId, ids: tm.tabs.map((t) => t.id) };
});

const torna = async (app, shell, page) => {
  const s = await stato(app);
  const id = s.ids[s.schede.findIndex((u) => u === page.url())];
  await shell.evaluate((i) => window.filoShell.tabs.activate(i), id);
  await expect.poll(async () => (await stato(app)).attiva).toBe(page.url());
  await page.waitForTimeout(400);
};

for (const [forma, nome, misure] of [['il pagamento in una finestrella', 'pagamento', 'width=500,height=600'], ["l'aiuto in una scheda", 'aiuto', '']]) {
  test(`r1 ${forma} su un altro sito, già aperto e riportato davanti dalla pagina col secondo clic, torna davanti`, async ({ app, shell, openTab, testServer }) => {
    const altrove = testServer.html('<title>ALTROVE</title>', { pubblico: true });
    const page = await openTab(testServer.html(`<script>var w=null;function apri(){if(w&&!w.closed){w.focus();}else{w=window.open(${JSON.stringify(altrove)},${JSON.stringify(nome)},'width=500,height=600');}}</script>
      <button id="a" style="height:40px" onclick="apri()">apri</button>`));
    await page.click('#a');
    await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(altrove);
    const n = (await stato(app)).schede.length;
    await torna(app, shell, page);
    await page.click('#a');
    await expect.poll(async () => (await stato(app)).attiva, { timeout: 8000 }).toBe(altrove);
    expect((await stato(app)).schede.length, 'la stessa finestra di prima').toBe(n);
  });
}
