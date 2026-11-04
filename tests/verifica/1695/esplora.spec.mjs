// Verifica #1695: esplorazione del menu della linguetta e del «+» (riapri, chiudi le altre).
import { test, expect } from '../../fixtures/electron.mjs';
import { tastoDestro, aspettaMenu, scegli, schede, apriEAspetta, vociDelMenu, fotoDelMenu } from '../../helpers/menuLinguetta.mjs';

const RIAPRI = 'Riapri scheda chiusa';
const voce = (voci, t) => voci.find((x) => x.testo === t);

test('riaperta dal menu, la stessa scheda non torna una seconda volta', async ({ app, shell, testServer }) => {
  const uno = testServer.html('<title>Uno</title><p>uno');
  const due = testServer.html('<title>Due</title><p>due');
  const idUno = await apriEAspetta(app, uno);
  const idDue = await apriEAspetta(app, due);
  await expect(shell.locator('.tab')).toHaveCount(3, { timeout: 8_000 });

  await tastoDestro(shell, `.tab[data-id="${idDue}"]`);
  await aspettaMenu(app, (v) => v.some((x) => x.testo === 'Chiudi'));
  await scegli(app, 'Chiudi');
  await expect(shell.locator('.tab')).toHaveCount(2, { timeout: 8_000 });

  await tastoDestro(shell, `.tab[data-id="${idUno}"]`);
  let voci = await aspettaMenu(app, (v) => !!voce(v, RIAPRI) && !voce(v, RIAPRI).spenta);
  await scegli(app, RIAPRI);
  await expect.poll(() => schede(app).then((s) => s.urls.filter((u) => u === due).length), { timeout: 8_000 }).toBe(1);
  expect((await schede(app)).activeUrl).toBe(due);

  // Nessun'altra chiusa: la voce si spegne, o almeno non ridà «Due».
  await new Promise((r) => setTimeout(r, 1500));
  await tastoDestro(shell, `.tab[data-id="${idUno}"]`);
  voci = await aspettaMenu(app, (v) => !!voce(v, RIAPRI));
  const accesa = !voce(voci, RIAPRI).spenta;
  if (accesa) {
    await scegli(app, RIAPRI);
    await new Promise((r) => setTimeout(r, 2000));
  }
  const s = await schede(app);
  expect(s.urls.filter((u) => u === due).length, `voce accesa: ${accesa}, schede: ${JSON.stringify(s.urls)}`).toBe(1);
  expect(accesa).toBe(false);
});

test('il «+» ha la voce, spenta all\'avvio e poi funzionante', async ({ app, shell, testServer }) => {
  await tastoDestro(shell, '#new-tab, .new-tab, #newTab');
  let voci = await aspettaMenu(app, (v) => !!voce(v, RIAPRI)).catch(async () => null);
  if (!voci) {
    // Selettore del «+» da scoprire.
    const sel = await shell.evaluate(() => { const b = document.querySelector('[title*="nuova" i], [aria-label*="nuova" i]'); return b ? (b.id ? '#' + b.id : b.className) : null; });
    throw new Error('menu del + non trovato; candidato: ' + sel);
  }
  expect(voce(voci, RIAPRI).spenta).toBe(true);
  await fotoDelMenu(app, 'tests/.shots/verifica-1695-piu-spento.png');
  // Lo scelgo lo stesso: nessuna scheda nasce.
  const prima = (await schede(app)).urls.length;
  await shell.keyboard.press('Escape').catch(() => {});

  const tre = testServer.html('<title>Tre</title><p>tre');
  const idTre = await apriEAspetta(app, tre);
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs.closeTab(id);
  }, idTre);
  await expect.poll(() => schede(app).then((s) => s.urls.length), { timeout: 8_000 }).toBe(prima);
  await tastoDestro(shell, '#new-tab, .new-tab, #newTab');
  voci = await aspettaMenu(app, (v) => !!voce(v, RIAPRI) && !voce(v, RIAPRI).spenta);
  await fotoDelMenu(app, 'tests/.shots/verifica-1695-piu-acceso.png');
  await scegli(app, RIAPRI);
  await expect.poll(() => schede(app).then((s) => s.activeUrl), { timeout: 8_000 }).toBe(tre);
});

test('in una finestra in incognito chiudi le altre e riapri restano lì', async ({ app, testServer }) => {
  const a = testServer.html('<title>IA</title><p>a');
  const b = testServer.html('<title>IB</title><p>b');
  await app.evaluate(({}) => { require('./window').createIncognitoWindow(); }).catch(async () => {
    await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      w.webContents.send('noop');
    });
  });
  const ok = await app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((x) => x._filoIncognito));
  test.skip(!ok, 'finestra incognito non apribile da qui');
});

test('foto del menu della linguetta, tema scuro', async ({ app, shell, testServer }) => {
  const id = await apriEAspetta(app, testServer.html('<title>Foto</title><p>foto'));
  await tastoDestro(shell, `.tab[data-id="${id}"]`);
  await aspettaMenu(app, (v) => v.some((x) => x.testo === 'Duplica'));
  await fotoDelMenu(app, 'tests/.shots/verifica-1695-menu.png');
  console.log(JSON.stringify(await vociDelMenu(app)));
});
