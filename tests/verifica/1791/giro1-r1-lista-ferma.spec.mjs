// Verifica #1791, giro 1, rilievo 1: con una lista corta (che non scorre) un arrivo sopra sposta ancora la riga sotto il
// puntatore, nelle Domande e nei Ricevuti, e un clic a metà va perso.
import { test, expect } from '../../fixtures/electron.mjs';
import { MANAGE, domanda } from '../../helpers/gestioneMainFinto.mjs';

const riga = (page, id) => page.locator(`#mgDomandeLista .mg-domanda[data-id="${id}"]`);
const sottoIlPuntatore = (page, sel, p) => page.evaluate(([x, y, s]) => document.elementFromPoint(x, y)?.closest(s)?.dataset.id || '', [p.x, p.y, sel]);

async function domandeCorte(openTab) {
  const page = await openTab(MANAGE);
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  const base = [domanda(100, { creataIl: 1e12 }), domanda(101, { creataIl: 1e12 + 1000 }), domanda(102, { creataIl: 1e12 + 2000 })];
  await page.evaluate((l) => window.__mgTest.setDomande(l, {}), base);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await expect(riga(page, 'D-102')).toBeVisible();
  return { page, base };
}

test('r1 Domande, lista corta: un arrivo sopra lascia sotto il puntatore la stessa riga', async ({ openTab }) => {
  const { page, base } = await domandeCorte(openTab);
  const box = await riga(page, 'D-102').boundingBox();
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(p.x, p.y);
  await page.evaluate((l) => window.__mgTest.setDomande(l, {}), [domanda(99, { creataIl: 1 }), ...base]);
  await expect(riga(page, 'D-99')).toHaveCount(1);
  expect(await sottoIlPuntatore(page, '.mg-domanda', p)).toBe('D-102');
});

test('r1 Domande, lista corta: il clic cominciato su una riga apre quella anche se a metà ne arriva una sopra', async ({ openTab }) => {
  const { page, base } = await domandeCorte(openTab);
  const box = await riga(page, 'D-102').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.evaluate((l) => window.__mgTest.setDomande(l, {}), [domanda(99, { creataIl: 1 }), ...base]);
  await expect(riga(page, 'D-99')).toHaveCount(1);
  await page.mouse.up();
  await expect(riga(page, 'D-102')).toHaveClass(/mg-domanda--aperta/);
});

function fbVivo(id, seq, status, extra = {}) {
  return {
    _id: id, _updateTime: 'v1', seq, subSeq: 0, name: `Segnalazione ${seq}`, text: `Testo ${seq}`, status,
    statusReason: extra.statusReason || null, clientId: 'tester@example.com',
    createdAt: new Date(Date.UTC(2026, 7, 1) + seq * 3600e3).toISOString(), images: [], ...extra,
  };
}

test('r1 Ricevuti, lista corta: un arrivo dal vivo in cima lascia sotto il puntatore la stessa riga', async ({ openTab }) => {
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
  const box = await page.locator('.mg-item[data-id="f758"]').boundingBox();
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(p.x, p.y);
  await page.evaluate(() => { const d = window.__srv.docs.f800; window.__srv.docs.f800 = { ...d, status: 'design', statusReason: 'l5', _updateTime: 'v2' }; });
  await expect(page.locator('#mgList .mg-item')).toHaveCount(4, { timeout: 10_000 });
  expect(await sottoIlPuntatore(page, '.mg-item', p)).toBe('f758');
});
