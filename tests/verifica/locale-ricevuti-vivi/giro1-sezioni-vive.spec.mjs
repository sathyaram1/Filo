// Verifica giro 1: in Gestione un feedback che cambia stato cambia sezione da solo, senza ricaricare, e il
// segno nato da un clic «Approva» si distingue da quello messo a mano. Firestore sostituito da sorgenti finte,
// orologio vero.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const RICHIESTA = 'abcdefabcdefabcdefabcdef';

function fb(id, extra = {}) {
  return {
    _id: id,
    _updateTime: 't1',
    text: `Testo del feedback ${id}.`,
    name: `Titolo ${id}`,
    seq: extra.seq || 515,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: '2026-09-20T10:00:00Z',
    images: [],
    status: 'revision_security',
    statusPublic: 'open',
    ...extra,
  };
}

async function apri(openTab) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  return page;
}

// Pagina aperta dall'owner con l'aggiornamento continuo acceso sulle sorgenti finte.
async function dalVivo(page, docs) {
  await page.evaluate((docs) => {
    window.__stato = { docs: Object.fromEntries(docs.map((d) => [d._id, d])) };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setLiveSources({
      listVersions: async () => Object.values(window.__stato.docs).map((d) => ({ _id: d._id, _updateTime: d._updateTime })),
      getMany: async (ids) => ids.map((id) => window.__stato.docs[id]).filter(Boolean),
      getDettagli: async (ids) => ids.map((id) => window.__stato.docs[id]).filter(Boolean),
    });
    window.__mgTest.setData(docs, { dalVivo: true });
    window.__mgTest.setLiveTiming({ pollMs: 400, clockMs: 150, rientroMs: 150 });
  }, docs);
}

async function cambiaSulServer(page, doc) {
  await page.evaluate((doc) => { window.__stato.docs[doc._id] = doc; }, doc);
}

const scheda = (page, id) => page.locator(`.mg-item[data-id="${id}"]`);
const tab = (page, t) => page.locator(`.mg-tab[data-tab="${t}"]`);

test('fermato al cancello di fusione mentre la pagina è aperta: passa da In coda ai Ricevuti da solo', async ({ openTab }) => {
  const page = await apri(openTab);
  await dalVivo(page, [fb('fb515')]);
  await tab(page, 'queue').click();
  await expect(scheda(page, 'fb515')).toBeVisible();

  await cambiaSulServer(page, fb('fb515', { _updateTime: 't2', status: 'design', statusReason: 'l5' }));

  // Nessun pollNow, nessun ricaricamento: solo l'orologio della pagina.
  await expect(scheda(page, 'fb515')).toHaveCount(0, { timeout: 10000 });
  await expect(tab(page, 'inbox')).toContainText('(1)');
  await expect(tab(page, 'queue')).toContainText('(0)');
  await tab(page, 'inbox').click();
  await expect(scheda(page, 'fb515')).toBeVisible();
});

test('coi tempi veri dell\'orologio, entro un giro, e la sezione d\'arrivo lo segnala', async ({ openTab }) => {
  test.setTimeout(150000);
  const page = await apri(openTab);
  await dalVivo(page, [fb('fb515')]);
  await page.evaluate(() => window.__mgTest.setLiveTiming({ pollMs: 60000, clockMs: 5000, rientroMs: 15000 }));
  await tab(page, 'queue').click();
  await expect(scheda(page, 'fb515')).toBeVisible();
  await cambiaSulServer(page, fb('fb515', { _updateTime: 't2', status: 'design', statusReason: 'l5' }));
  await expect(scheda(page, 'fb515')).toHaveCount(0, { timeout: 80000 });
  await expect(tab(page, 'inbox')).toHaveClass(/mg-tab--arrivi/);
  await page.screenshot({ path: 'tests/.shots/verifica-ricevuti-vivi-arrivo.png' });
});

test('col mouse fermo sopra la lista la scheda cambia sezione lo stesso', async ({ openTab }) => {
  const page = await apri(openTab);
  await dalVivo(page, [fb('fb515'), fb('altro', { seq: 600 })]);
  await tab(page, 'queue').click();
  await scheda(page, 'altro').hover();

  await cambiaSulServer(page, fb('fb515', { _updateTime: 't2', status: 'design', statusReason: 'l5' }));
  await expect(scheda(page, 'fb515')).toHaveCount(0, { timeout: 10000 });
  await expect(tab(page, 'inbox')).toContainText('(1)');
});

test('con la scheda aperta nel pannello la lista si aggiorna e il pannello resta leggibile', async ({ openTab }) => {
  const page = await apri(openTab);
  await dalVivo(page, [fb('fb515')]);
  await tab(page, 'queue').click();
  await scheda(page, 'fb515').click();
  await expect(page.locator('#mgDetail')).toContainText('Testo del feedback fb515');

  await cambiaSulServer(page, fb('fb515', { _updateTime: 't2', status: 'design', statusReason: 'l5' }));
  await expect(tab(page, 'inbox')).toContainText('(1)', { timeout: 10000 });
  await expect(page.locator('#mgDetail')).toContainText('Testo del feedback fb515');
});

test('il segno nato da un clic «Approva» arriva da solo e si distingue da quello messo a mano', async ({ openTab }) => {
  const page = await apri(openTab);
  await dalVivo(page, [fb('clic', { status: 'working' }), fb('mano', { seq: 600, status: 'working' })]);
  await tab(page, 'queue').click();
  await expect(scheda(page, 'clic')).toBeVisible();

  const at = '2026-09-25T08:30:00.000Z';
  await cambiaSulServer(page, fb('clic', { _updateTime: 't2', status: 'working',
    mergePreapproved: { by: `owner@example.com · approvazione ${RICHIESTA}`, at } }));
  await cambiaSulServer(page, fb('mano', { seq: 600, _updateTime: 't2', status: 'working',
    mergePreapproved: { by: 'owner@example.com', at } }));

  const segnoClic = scheda(page, 'clic').locator('.mg-preapproved');
  const segnoMano = scheda(page, 'mano').locator('.mg-preapproved');
  await expect(segnoClic).toBeVisible({ timeout: 10000 });
  await expect(segnoMano).toBeVisible();
  const [tClic, tMano] = [await segnoClic.innerText(), await segnoMano.innerText()];
  expect(tClic).not.toBe(tMano);
  // L'email con la coda tecnica non si mostra grezza.
  await scheda(page, 'clic').click();
  const riga = page.locator('#mgPreapprovedInfo');
  await expect(riga).toBeVisible();
  await expect(riga).not.toContainText(RICHIESTA);
  await expect(page.locator('#mgPreapproveBtn')).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: 'tests/.shots/verifica-ricevuti-vivi-segno.png' });
});
