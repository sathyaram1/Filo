// Esplorazione della verifica di #1791: Gestione → Domande col nuovo ciclo.
import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE, PRATICHE, RIFERIMENTI, domanda, mainFinto, aspettaAvvio } from '../../helpers/gestioneMainFinto.mjs';

const riga = (page, id) => page.locator(`#mgDomandeLista .mg-domanda[data-id="${id}"]`);
const dq = (page, id) => page.locator(`#mgDomandaDettaglio .mg-dq[data-id="${id}"]`);
const tab = (page, t) => page.locator(`.mg-tab[data-tab="${t}"]`);

async function apriDomande(page) {
  await aspettaAvvio(page);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await expect(page.locator('#panel-domande')).toHaveClass(/mg-panel--active/);
}

async function registraInvii(app) {
  await app.evaluate(({ ipcMain }) => {
    const sotto = ipcMain._invokeHandlers.get('filo:message');
    globalThis.__mandati = [];
    ipcMain.removeHandler('filo:message');
    ipcMain.handle('filo:message', async (event, msg) => {
      if (msg && /^domand/.test(String(msg.type)) && msg.type !== 'domande_elenco') globalThis.__mandati.push(msg);
      return sotto(event, msg);
    });
  });
}

const DUE = (n, over = {}) => domanda(n, Object.assign({
  opzioni: [
    { testo: 'Caldo', pro: 'Come Filo.', contro: 'Poco contrasto.', azione: { tipo: 'riprendi', feedbackId: 'fb-813' } },
    { testo: 'Freddo', pro: 'Contrasto.', contro: 'Non è Filo.', azione: { tipo: 'archivia', feedbackId: 'fb-813' } },
  ],
  consiglio: { opzione: 0, perche: 'È lo stile.' },
}, over));

test('bozza mandata con un pulsante d’opzione', async ({ app, openTab }) => {
  await mainFinto(app, { feedbacks: PRATICHE, riferimenti: RIFERIMENTI, domande: [DUE(70), DUE(71)] });
  await registraInvii(app);
  const page = await openTab(MANAGE);
  await apriDomande(page);
  await riga(page, 'D-70').click();
  const d = dq(page, 'D-70');
  await expect(d.locator('.mg-dq-applica')).toHaveCount(1);
  await expect(d.locator('.mg-dq-parole')).toBeVisible();
  await d.locator('.mg-dq-testo').fill('scritto a mano');
  await d.locator('.mg-dq-azione[data-scelta="1"]').click();
  await expect(d.locator('.mg-dq-msg')).toHaveText(/^Mandata/);
  const m = await app.evaluate(() => globalThis.__mandati);
  expect(m[0]).toMatchObject({ type: 'domanda_rispondi', id: 'D-70', scelta: 1, testo: 'scritto a mano' });
  expect(await page.evaluate(() => localStorage.getItem('filo.gestione.bozzeDomande'))).toBeNull();
  await page.screenshot({ path: 'tests/.shots/v1791-mandata.png' });
});

test('in smistamento: sola lettura', async ({ app, openTab }) => {
  await mainFinto(app, {
    feedbacks: PRATICHE, riferimenti: RIFERIMENTI,
    domande: [DUE(80, { stato: 'in_smistamento', legata: 'fb-813', blocca: true, notePerAgenti: 'testo vero' }), DUE(81)],
  });
  const page = await openTab(MANAGE);
  await apriDomande(page);
  await expect(tab(page, 'domande-smistamento')).toContainText('(1)');
  await expect(tab(page, 'domande')).toContainText('(1)');
  await tab(page, 'domande-smistamento').click();
  await expect(riga(page, 'D-80')).toContainText('ferma #813');
  await riga(page, 'D-80').click();
  const d = dq(page, 'D-80');
  await expect(d.locator('.mg-dq-testo')).toHaveCount(0);
  await expect(d.locator('.mg-dq-azione')).toHaveCount(0);
  await expect(d.locator('.mg-dq-applica')).toHaveCount(0);
  await expect(d.locator('.mg-dq-tasti button')).toHaveText(['Archivia']);
  await page.screenshot({ path: 'tests/.shots/v1791-smistamento.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await page.screenshot({ path: 'tests/.shots/v1791-smistamento-scuro.png' });
});

test('lista corta: un arrivo sopra non sposta la riga sotto il puntatore', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  const base = [domanda(100, { creataIl: 1e12 }), domanda(101, { creataIl: 1e12 + 1000 }), domanda(102, { creataIl: 1e12 + 2000 })];
  await page.evaluate((l) => window.__mgTest.setDomande(l, {}), base);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  const bersaglio = riga(page, 'D-102');
  const box = await bersaglio.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate((l) => window.__mgTest.setDomande(l, {}), [domanda(99, { creataIl: 1 }), ...base]);
  await expect(riga(page, 'D-99')).toHaveCount(1);
  const dopo = await bersaglio.boundingBox();
  console.log('PRIMA', box.y, 'DOPO', dopo.y);
  // Cosa c'è sotto il puntatore adesso?
  const sotto = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.mg-domanda')?.dataset.id, [box.x + box.width / 2, box.y + box.height / 2]);
  console.log('SOTTO', sotto);
  expect(sotto).toBe('D-102');
});

function fbVivo(id, seq, status, extra = {}) {
  return {
    _id: id, _updateTime: 'v1', seq, subSeq: 0, name: `Segnalazione ${seq}`, text: `Testo ${seq}`, status,
    statusReason: extra.statusReason || null, clientId: 'tester@example.com',
    createdAt: new Date(Date.UTC(2026, 7, 1) + seq * 3600e3).toISOString(), images: [], ...extra,
  };
}
test('Ricevuti corti: un arrivo dal vivo in cima non sposta la riga sotto il puntatore', async ({ openTab }) => {
  const docs = [fbVivo('f800', 800, 'todo')];
  for (let n = 760; n > 757; n -= 1) docs.push(fbVivo(`f${n}`, n, 'design', { statusReason: 'clarify' }));
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((docs) => {
    window.__srv = { docs: {} };
    for (const d of docs) window.__srv.docs[d._id] = d;
    const piuNuovi = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt));
    window.__mgTest.setLiveSources({
      listVersions: async () => Object.values(window.__srv.docs).sort(piuNuovi).map((d) => ({ _id: d._id, _updateTime: d._updateTime })),
      getMany: async (ids) => ids.map((id) => window.__srv.docs[id]).filter(Boolean).map((d) => ({ ...d })),
    });
    window.__mgTest.setAdmin(true);
    window.__mgTest.setLiveTiming({ pollMs: 800, rientroMs: 300, clockMs: 200 });
    window.__mgTest.setData(docs.map((d) => ({ ...d })), { dalVivo: true });
    window.__mgTest.setSortMode('num');
    window.__mgTest.setTab('inbox');
  }, docs);
  await expect(page.locator('#mgList .mg-item')).toHaveCount(3);
  const bersaglio = page.locator('.mg-item[data-id="f758"]');
  const box = await bersaglio.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => { const d = window.__srv.docs.f800; window.__srv.docs.f800 = { ...d, status: 'design', statusReason: 'l5', _updateTime: 'v2' }; });
  await expect(page.locator('#mgList .mg-item')).toHaveCount(4, { timeout: 10_000 });
  const sotto = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.mg-item')?.dataset.id, [box.x + box.width / 2, box.y + box.height / 2]);
  console.log('SOTTO', sotto, 'Y', box.y, (await bersaglio.boundingBox()).y);
  expect(sotto).toBe('f758');
});
