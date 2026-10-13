// #532: un lavoro che rientra dopo una fusione fallita (riallineamento) non si confonde con una bocciatura del
// verificatore: scheda in coda, dettaglio, pannello dello stato, pagina dei feedback, scheda Log e barre per
// mestiere. Il segno lo scrive il server (`statusReason`, `caso` nel registro): qui arriva da dati finti.
import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const FEEDBACK = 'filo://feedback/feedback.html';
const GIORNO = 24 * 60 * 60 * 1000;
const g = (n) => new Date(Date.now() - n * GIORNO).toISOString();

const RIALLINEATO = {
  _id: 'r-riall', text: 'Il ramo aveva passato verifica e audit, poi la fusione è andata in conflitto.',
  name: 'Lavoro da rifare su main', seq: 509, subSeq: 0, status: 'revision_capability',
  statusReason: 'riallineamento', branch: 'worker/r-riall', priority: 0, createdAt: '2026-09-01T10:00:00Z', images: [],
};
const BOCCIATO = {
  _id: 'r-boc', text: 'Il verificatore ha trovato un difetto.', name: 'Lavoro bocciato', seq: 510, subSeq: 0,
  status: 'revision_capability', branch: 'worker/r-boc', priority: 0, createdAt: '2026-09-02T10:00:00Z', images: [],
};

async function apriGestione(openTab) {
  const page = await openTab(MANAGE);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_MANAGE_REVIEW);
  await page.evaluate(() => window.__mgTest.whenReady());
  return page;
}

test('in coda il riallineamento ha il suo passo, e la bocciatura resta com\'era', async ({ openTab }) => {
  const page = await apriGestione(openTab);
  await page.evaluate((fbs) => { window.__mgTest.setData(fbs); window.__mgTest.setTab('queue'); }, [RIALLINEATO, BOCCIATO]);

  const riall = page.locator('#mgList .mg-item[data-id="r-riall"]');
  const boc = page.locator('#mgList .mg-item[data-id="r-boc"]');
  await expect(riall.locator('.mg-step--done')).toHaveText(['✓ Implementazione', '✓ Controllo funzionalità']);
  await expect(riall.locator('.mg-step--current')).toHaveText('● Riallineamento');
  await expect(riall.locator('.mg-step--pending')).toHaveText('○ Controllo sicurezza');
  await expect(riall.locator('.mg-step--current')).toHaveAttribute('title', /il codice aveva passato le verifiche/);
  await expect(riall.locator('.mg-item-state')).toContainText('in attesa del riallineamento');
  await expect(riall).toHaveAttribute('title', /il ramo si rifà su main/);

  await expect(boc.locator('.mg-step--current')).toHaveText('● Controllo funzionalità');
  await expect(boc.locator('[data-step="realign"]')).toHaveCount(0);
  await expect(boc.locator('.mg-item-state')).toContainText('in attesa di un verificatore');
  await page.locator('#mgList').screenshot({ path: 'tests/.shots/532-coda-chiaro.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('#mgList').screenshot({ path: 'tests/.shots/532-coda-scuro.png' });
});

test('nel dettaglio la striscia e il pannello dello stato dicono riallineamento, non bocciatura', async ({ openTab }) => {
  const page = await apriGestione(openTab);
  await page.evaluate((fbs) => { window.__mgTest.setData(fbs); window.__mgTest.setTab('queue'); }, [RIALLINEATO, BOCCIATO]);

  await page.evaluate(() => window.__mgTest.openDetail('r-riall'));
  await expect(page.locator('#mgWorkState .mg-step--current')).toHaveText('● Riallineamento');
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l1"]').click();
  const pannello = page.locator('#mgSideBody');
  await expect(pannello).toContainText('Riallineamento — il ramo si rifà su main, il codice aveva passato le verifiche');
  await expect(pannello).toContainText('Non è una bocciatura');
  await page.screenshot({ path: 'tests/.shots/532-dettaglio-chiaro.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  // Le schede cambiano fondo con una transizione breve: la foto aspetta che finisca.
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/532-dettaglio-scuro.png' });
  await page.emulateMedia({ colorScheme: 'light' });

  await page.evaluate(() => window.__mgTest.openDetail('r-boc'));
  await expect(page.locator('#mgWorkState .mg-step--current')).toHaveText('● Controllo funzionalità');
  await page.locator('#mgLivelliRow .mg-forma[data-livello="l1"]').click();
  await expect(page.locator('#mgSideBody')).toContainText('Verifica fix');
  await expect(page.locator('#mgSideBody')).not.toContainText('Riallineamento');
});

test('la pagina dei feedback chiama il riallineamento per nome', async ({ openTab }) => {
  const fb = await openTab(FEEDBACK);
  await fb.waitForLoadState('domcontentloaded');
  await fb.waitForFunction(() => window.__fbTest && window.SN_MANAGE_REVIEW);
  await fb.evaluate((items) => window.__fbTest.setData(items), [RIALLINEATO, BOCCIATO]);
  await fb.locator('#tabs [data-tab="queue"]').click();
  await expect(fb.locator('.fb-card', { hasText: 'Lavoro da rifare su main' }).locator('.fb-state'))
    .toHaveText('Riallineamento — il ramo si rifà su main, il codice aveva passato le verifiche');
  await expect(fb.locator('.fb-card', { hasText: 'Lavoro bocciato' }).locator('.fb-state')).toHaveText('Verifica fix');
});

// Il registro passa dal main vero: owner e Firestore finti, la voce col `caso` scritta come la scrive il server.
async function registroSulServer(app, voci) {
  await app.evaluate(async (electron, voci) => {
    const { createRequire } = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = createRequire(path.join(electron.app.getAppPath(), 'package.json'));
    const auth = req(path.join(electron.app.getAppPath(), 'src/main/auth/google-auth.js'));
    auth.getIdToken = async () => 'finto';
    auth.isAdmin = () => true;
    auth.isSignedIn = () => true;
    auth.getProfile = () => ({ email: 'owner@example.com', name: 'Owner' });
    const mappa = (o) => ({ mapValue: { fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { stringValue: String(v) }])) } });
    const doc = { fields: { workerLog: { arrayValue: { values: voci.map(mappa) } } } };
    const risposta = (ok, corpo, status) => ({ ok, status: status || (ok ? 200 : 404), headers: new Map(), async json() { return corpo; }, async text() { return JSON.stringify(corpo); } });
    globalThis.fetch = async (url) => (/documents\/config\/automation\?/.test(String(url)) ? risposta(true, doc) : risposta(false, {}, 503));
  }, voci);
}

test('la scheda Log chiama per nome riallineamento, ripresa e il loro controllo', async ({ app, openTab }) => {
  await registroSulServer(app, [
    { role: 'fixer', caso: 'riallineamento', startedAt: '2026-09-03T16:50:00.000Z', num: '509' },
    { role: 'verifier', caso: 'riallineamento', startedAt: '2026-09-03T16:40:00.000Z', num: '509' },
    { role: 'fixer', caso: 'ripresa', startedAt: '2026-09-03T16:30:00.000Z', num: '511' },
    { role: 'fixer', startedAt: '2026-09-03T16:20:00.000Z', num: '512' },
    { role: 'verifier', startedAt: '2026-09-03T16:10:00.000Z', num: '513' },
    // Un caso scritto male non diventa un'etichetta.
    { role: 'fixer', caso: '<b>x</b>', startedAt: '2026-09-03T16:00:00.000Z', num: '514' },
  ]);
  const page = await apriGestione(openTab);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.locator('.mg-tab[data-tab="log"]').click();
  await expect(page.locator('#mgLogList .mg-log-role')).toHaveText([
    'Riallineamento', 'Verifica del riallineamento', 'Ripresa', 'Riallineamento o ripresa', 'Verifica', 'Riallineamento o ripresa',
  ]);
  await page.locator('#panel-log').screenshot({ path: 'tests/.shots/532-log.png' });
});

test('le barre per mestiere separano il riallineamento', async ({ openTab }) => {
  const page = await apriGestione(openTab);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate((d) => window.__mgTest.setFsData(d), {
    feedbacks: [],
    workerLog: [
      { role: 'verifier', startedAt: g(3), num: '1' },
      { role: 'fixer', caso: 'riallineamento', startedAt: g(2), num: '1' },
      { role: 'verifier', caso: 'riallineamento', startedAt: g(2), num: '1' },
    ],
  });
  await page.locator('[data-fs-range="30g"]').click();
  await page.locator('[data-fs-tile="lanci"]').click();
  const righe = page.locator('.mg-fs-detail .mg-bar-row');
  await expect(righe).toHaveCount(3);
  await expect(page.locator('.mg-fs-detail')).toContainText('Riallineamento');
  await expect(page.locator('.mg-fs-detail')).toContainText('Verifica del riallineamento');
});
