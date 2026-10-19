// Esplorazione del verificatore, giro 1 di #997: si cancella prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';
const GIORNO = 864e5;
const g = (n) => new Date(Date.now() - n * GIORNO).toISOString();
const giorno = (n) => new Date(Date.now() - n * GIORNO).toISOString().slice(0, 10);

function fb(over = {}) {
  return Object.assign({
    _id: 'fs-' + Math.random().toString(36).slice(2), seq: 1, subSeq: 0,
    clientId: 'tester@example.com', createdAt: g(1), status: 'todo', text: 'testo', name: 'titolo', images: [],
  }, over);
}

async function apri(page, dati, lista = []) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate((l) => window.__mgTest.setData(l), lista);
  await apriScheda(page, 'fbstats');
  if (dati) await page.evaluate((d) => window.__mgTest.setFsData(d), dati);
}

const lavoro = (over = {}) => fb({ _id: 'w1', seq: 41, status: 'done', createdAt: g(30), livelli: { l4: { esito: 'pass' } }, ...over });
const reg = (num, giorni) => [{ role: 'new-work', startedAt: g(giorni + 1), num }, { role: 'verifier', startedAt: g(giorni), num }, { role: 'secaudit', startedAt: g(giorni), num }];

test('A: con le date scritte a mano il dettaglio del controllo si chiude', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, { feedbacks: [lavoro()], workerLog: reg('41', 20) });
  await page.locator('[data-fs-range="tutto"]').click();
  await page.locator('[data-fs-tile="audit"]').click();
  await expect(page.locator('#mgFsAltro .mg-fs-detail')).toBeVisible();
  await page.locator('[data-fs-range="custom"]').click();
  await expect(page.locator('#mgFsAltro .mg-fs-detail')).toBeVisible();
  await page.locator('#mgFsFrom').fill(giorno(5));
  await page.locator('#mgFsFrom').dispatchEvent('change');
  await expect(page.locator('#mgFsAltro .mg-fs-detail')).toHaveCount(0);
  await expect(page.locator('[data-fs-id="audit"]')).not.toHaveAttribute('data-fs-tile', /./);
});

test('B: ricevuti aperto con filtro che svuota: si aggiorna e si chiude ancora', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, { feedbacks: [fb({ _id: 'a', createdAt: g(2) })], workerLog: [] });
  await page.locator('[data-fs-range="tutto"]').click();
  await page.locator('[data-fs-tile="ricevuti"]').click();
  await page.locator('[data-fs-creator="__routine"]').click();
  await expect(page.locator('#mgFsTiles .mg-fs-detail')).toBeVisible();
  await page.locator('[data-fs-tile="ricevuti"]').click();
  await expect(page.locator('#mgFsTiles .mg-fs-detail')).toHaveCount(0);
  // lanci aperto, registro che cade
  await page.evaluate(() => window.__mgTest.setFsData({ feedbacks: [], workerLog: [{ role: 'prober', startedAt: new Date().toISOString() }] }));
  await page.locator('[data-fs-tile="lanci"]').click();
  await expect(page.locator('#mgFsTiles .mg-fs-detail')).toBeVisible();
  await page.evaluate(() => window.__mgTest.setFsData({ feedbacks: [], workerLog: [], logOk: false }));
  await expect(page.locator('#mgFsTiles .mg-fs-detail')).toHaveCount(0);
});

test('C: «Scegli tu» vuoto ricordato: alla riapertura dice che guarda tutto', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => localStorage.setItem('filo_manage_fs_scelta', JSON.stringify({ range: 'custom', da: '', a: '', creatori: [] })));
  await page.reload();
  await apri(page, { feedbacks: [fb({ createdAt: g(400) }), fb({ createdAt: g(1) })], workerLog: [] });
  await expect(page.locator('#mgFsFinestra')).toBeVisible();
  await expect(page.locator('#mgFsFinestra')).toContainText('Guardi tutto');
  await expect(page.locator('[data-fs-id="ricevuti"] .mg-tile-n')).toHaveText('2');
  // svuotata una data dopo averla scritta
  await page.locator('#mgFsFrom').fill(giorno(5));
  await page.locator('#mgFsFrom').dispatchEvent('change');
  await expect(page.locator('#mgFsFinestra')).toContainText('in poi');
  await page.locator('#mgFsFrom').fill('');
  await page.locator('#mgFsFrom').dispatchEvent('change');
  await expect(page.locator('#mgFsFinestra')).toContainText('Guardi tutto');
  await page.locator('#mgFsRoot').screenshot({ path: 'tests/.shots/v997-scegli-vuoto.png' });
});

test('D: lettura completa che fallisce davvero, col caricamento vero', async ({ openTab }) => {
  const page = await openTab(URL);
  const riga = fb({ _id: 'w1', seq: 41, status: 'done', createdAt: g(4), reviewedAt: g(3), name: 'riga', _proiezione: true });
  await apri(page, null, [riga]);
  await page.evaluate(() => {
    window.SN_FEEDBACK.listAllPaged = async () => { throw new Error('rete giù'); };
  });
  await page.evaluate(() => window.__mgTest.loadFsData());
  await expect(page.locator('#mgFsBody')).toBeVisible();
  await page.locator('[data-fs-range="tutto"]').click();
  const nota = await page.locator('#mgFsNota').innerText();
  console.log('NOTA:', nota);
  console.log('AUDIT:', await page.locator('[data-fs-id="audit"]').innerText());
  console.log('RICEVUTI:', await page.locator('[data-fs-id="ricevuti"]').innerText());
  await expect(page.locator('#mgFsNota')).toContainText('Non è riuscita');
  await page.locator('#mgFsRoot').screenshot({ path: 'tests/.shots/v997-ripiego-vero.png' });
});

test('E: fetta 3+ dal tasto destro e da tastiera mostra le critiche; titoli con HTML', async ({ openTab }) => {
  const page = await openTab(URL);
  const ver = (num, n) => Array.from({ length: n }, () => ({ role: 'verifier', startedAt: g(2), num }));
  await apri(page, {
    feedbacks: [
      fb({ _id: 'c3', seq: 30, status: 'done', createdAt: g(5), name: '<b>tre</b><img src=x onerror="document.title=\'X\'">' }),
      fb({ _id: 'c12', seq: 12, status: 'done', createdAt: g(5), name: 'dodici '.repeat(30) }),
    ],
    workerLog: [...ver('30', 4), ...ver('12', 13)],
  });
  await page.locator('[data-fs-range="tutto"]').click();
  await page.locator('#mgFsLegend li[data-group="g3"]').click({ button: 'right' });
  const voci = page.locator('.mg-ctxmenu .sn-select-option');
  console.log('MENU:', await voci.allInnerTexts());
  await voci.first().click();
  await expect(page.locator('#mgFsDrillList [data-fs-open="c12"] .mg-fs-drill-giri')).toHaveText('12 critiche');
  await expect(page.locator('#mgFsDrillList [data-fs-open="c3"] .mg-fs-drill-giri')).toHaveText('3 critiche');
  expect(await page.title()).not.toBe('X');
  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.locator('#mgFsDrill').screenshot({ path: `tests/.shots/v997-g3-${tema}.png` });
  }
  await page.keyboard.press('Escape');
  await page.locator('#mgFsLegend li[data-group="g3"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#mgFsDrillList [data-fs-open="c12"] .mg-fs-drill-giri')).toHaveText('12 critiche');
});

test('F: un solo conto sotto i filtri, nei due temi, e col filtro', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, {
    feedbacks: [
      fb({ _id: 'sd', seq: 2, createdAt: '', name: 'senza data' }),
      fb({ _id: 'mi', seq: 3, createdAt: g(1), clientId: '[cifrato — chiave privata non configurata]', name: 'cifrata' }),
      fb({ _id: 'mj', seq: 4, createdAt: g(1), clientId: '[cifrato — chiave privata non configurata]', name: 'cifrata 2' }),
    ],
    workerLog: [],
  });
  await page.locator('[data-fs-range="tutto"]').click();
  const sd = page.locator('#mgFsNota [data-fs-esito="senzaData"]');
  await expect(sd).toHaveText('Una segnalazione');
  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await sd.hover();
    await page.locator('#mgFsRoot').screenshot({ path: `tests/.shots/v997-nota-${tema}.png` });
  }
  await sd.click();
  await expect(page.locator('#mgFsDrill [data-fs-open]')).toHaveCount(1);
  // cambio filtro con l'elenco aperto: si chiude
  await page.locator('[data-fs-creator="__routine"]').click();
  await expect(page.locator('#mgFsDrill')).toBeHidden();
  console.log('NOTA FILTRO ROUTINE:', await page.locator('#mgFsNota').innerText());
  await page.locator('#mgFsNota [data-fs-esito="mittentiIgnoti"]').click();
  await expect(page.locator('#mgFsDrill [data-fs-open]')).toHaveCount(2);
});
