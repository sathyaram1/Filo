// #1695 (#413.1) — «Chiudi le altre schede» nel tasto destro della linguetta: resta solo la cliccata, attiva; con una
// scheda sola la voce non c'è; le chiuse tornano con Ctrl+Shift+T; il testo non inviato resta, come a «tutte» in chat.
import { test, expect } from './fixtures/electron.mjs';
import { tastoDestro, aspettaMenu, scegli, schede, apriEAspetta } from './helpers/menuLinguetta.mjs';

const VOCE = 'Chiudi le altre schede';

function premi(app, keyCode, modifiers) {
  return app.evaluate(({ BrowserWindow }, { keyCode, modifiers }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  }, { keyCode, modifiers });
}

test('chiude tutte le altre: resta la cliccata, attiva, e Ctrl+Shift+T riporta una chiusa', async ({ app, shell, testServer }) => {
  const uno = testServer.html('<title>Uno</title><p>uno');
  const due = testServer.html('<title>Due</title><p>due');
  const tre = testServer.html('<title>Tre</title><p>tre');
  await apriEAspetta(app, uno);
  const idDue = await apriEAspetta(app, due);
  await apriEAspetta(app, tre);
  await expect(shell.locator('.tab')).toHaveCount(4, { timeout: 8_000 });

  // La cliccata non è l'attiva: dopo dev'esserlo lei.
  await tastoDestro(shell, `.tab[data-id="${idDue}"]`);
  const voci = await aspettaMenu(app, (v) => v.some((x) => x.testo === 'Duplica'));
  const testi = voci.map((x) => x.testo);
  expect(testi.indexOf(VOCE)).toBe(testi.indexOf('Chiudi') + 1);
  await scegli(app, VOCE);

  await expect.poll(() => schede(app).then((s) => s.ids), { timeout: 8_000 }).toEqual([idDue]);
  expect((await schede(app)).activeId).toBe(idDue);
  await expect(shell.locator('.tab')).toHaveCount(1);

  // Chiuse come una chiusura qualunque: la scorciatoia riporta la più recente.
  await premi(app, 'T', ['control', 'shift']);
  await expect.poll(() => schede(app).then((s) => s.urls.length), { timeout: 8_000 }).toBe(2);
  const dopo = await schede(app);
  expect(dopo.activeUrl).toBe(tre);
  expect(dopo.urls).toContain(due);
});

test('con una scheda sola la voce non c\'è', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await tastoDestro(shell, '.tab');
  const voci = await aspettaMenu(app, (v) => v.some((x) => x.testo === 'Duplica'));
  expect(voci.map((x) => x.testo)).not.toContain(VOCE);
});

test('la scheda col testo non inviato resta aperta, e un avviso dice perché', async ({ app, shell, openTab, avvisi, testServer }) => {
  await apriEAspetta(app, testServer.html('<title>Alfa</title><p>alfa'));
  const bozza = await openTab(testServer.html('<title>Bozza</title><textarea id="t"></textarea>'));
  await bozza.locator('#t').click();
  await bozza.keyboard.type('Una risposta che non ho ancora mandato');
  await expect.poll(() => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs
    .find((t) => t.title === 'Bozza')?.formDirty), { timeout: 8_000 }).toBe(true);
  const tenuta = testServer.html('<title>Tenuta</title><p>tenuta');
  const idTenuta = await apriEAspetta(app, tenuta);
  await expect(shell.locator('.tab')).toHaveCount(4, { timeout: 8_000 });

  await tastoDestro(shell, `.tab[data-id="${idTenuta}"]`);
  await aspettaMenu(app, (v) => v.some((x) => x.testo === VOCE));
  await scegli(app, VOCE);

  await expect.poll(() => schede(app).then((s) => s.urls.length), { timeout: 8_000 }).toBe(2);
  const dopo = await schede(app);
  expect(dopo.activeId).toBe(idTenuta);
  expect(dopo.urls.some((u) => /Bozza|bozza/.test(u)) || dopo.urls.length === 2).toBe(true);
  const titoli = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs.map((t) => t.title).sort());
  expect(titoli).toEqual(['Bozza', 'Tenuta']);
  const vista = await avvisi();
  await expect(vista.locator('.shell-notif.show', { hasText: 'Chiuse 2 schede: una resta aperta col testo non inviato.' }))
    .toHaveCount(1, { timeout: 8_000 });
  await vista.screenshot({ path: 'tests/.shots/menu-linguetta-chiudi-altre-avviso.png' });
});
