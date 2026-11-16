// Esplorazione del giro 2 (#2270): il riquadro degli assorbiti nei due temi, con titoli lunghi e con markup.
import { mkdirSync } from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';
import { apriScheda } from '../../helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';
const SHOTS = 'tests/.shots';

function fb(id, seq, status, extra) {
  return {
    _id: id, text: `Testo di ${seq}`, name: `Titolo di ${seq}`, seq, subSeq: 0, clientId: 'tester@example.com',
    createdAt: '2026-11-10T10:00:00Z', images: [], status, ...(extra || {}),
  };
}
const LUNGO = 'Quando apro il menu del tasto destro su una scheda con tanti elementi la finestra si blocca per qualche secondo e poi si chiude da sola senza dire niente';
const DATI = [
  fb('p', 300, 'todo', { name: 'Pacchetto di 3 segnalazioni', unisce: [{ id: 'a1', num: '#101' }, { id: 'a2', num: '#102' }, { id: 'a3', num: '#103' }, { id: 'zz', num: '#999' }] }),
  fb('a1', 101, 'archived', { name: LUNGO, unitoIn: 'p' }),
  fb('a2', 102, 'archived', { name: '<img src=x onerror="window.__xss=1"><b>grassetto</b>', unitoIn: 'p' }),
  fb('a3', 103, 'archived', { name: '', unitoIn: 'p' }),
];

for (const tema of ['light', 'dark']) {
  test(`riquadro degli assorbiti, tema ${tema}`, async ({ openTab }) => {
    const page = await openTab(URL);
    await page.emulateMedia({ colorScheme: tema });
    await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_FEEDBACK && window.filo);
    await page.evaluate(() => window.__mgTest.whenReady());
    await page.evaluate(() => window.__mgTest.setAdmin(true));
    await page.evaluate((items) => window.__mgTest.setData(items), DATI);
    await apriScheda(page, 'queue');
    await page.locator('.mg-item[data-id="p"]').click();
    await expect(page.locator('#mgAssorbite')).toBeVisible();
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/v2270-assorbiti-${tema}.png` });
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await page.locator('#mgAssorbite .mg-attesa-num', { hasText: '#101' }).hover();
    await page.screenshot({ path: `${SHOTS}/v2270-assorbiti-${tema}-hover.png` });
  });
}
