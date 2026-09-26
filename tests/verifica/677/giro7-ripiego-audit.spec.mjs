// Giro 7 (riallineamento) — il ripiego della scheda delle statistiche.
//
// La scheda chiede l'insieme delle segnalazioni; se quella lettura non riesce
// ripiega su quelle già in pagina. Da quando l'elenco è una proiezione, quelle
// righe non portano l'esito del controllo di sicurezza: il riquadro deve dire
// che non lo sa, non scrivere zero.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const GIORNO = 24 * 60 * 60 * 1000;
const g = (n) => new Date(Date.now() - n * GIORNO).toISOString();

function fb(over = {}) {
  return Object.assign({
    _id: 'fs-' + Math.random().toString(36).slice(2),
    seq: 1, subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: g(1),
    status: 'todo',
    text: 'testo', name: 'titolo', images: [],
  }, over);
}

async function apri(page, dati) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.locator('.mg-tab[data-tab="fbstats"]').click();
  await page.evaluate((d) => window.__mgTest.setFsData(d), dati);
  await expect(page.locator('#mgFsBody')).toBeVisible();
}

const tile = (page, id) => page.locator(`[data-fs-id="${id}"] .mg-tile-n`);
const sub  = (page, id) => page.locator(`[data-fs-id="${id}"] .mg-tile-sub`);

const registro = [
  { role: 'new-work', startedAt: g(3), num: '2' },
  { role: 'secaudit', startedAt: g(2), num: '2' },
];

// Il controllo: quello che l'elenco chiede davvero non contiene l'esito
// dell'audit, quindi il ripiego non può conoscerlo.
test('#677 l\'elenco non chiede l\'esito del controllo di sicurezza', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  const campi = await page.evaluate(() => window.SN_FEEDBACK.CAMPI_LISTA.slice());
  expect(campi).not.toContain('livelli');
});

// Il controllo gemello: con la lettura completa riuscita il numero c'è.
test('#677 lettura completa riuscita: il controllo di sicurezza si conta', async ({ openTab }) => {
  const page = await openTab(URL);
  const lavorato = fb({ seq: 2, status: 'done', createdAt: g(4), reviewedAt: g(3), livelli: { l4: { esito: 'pass' } } });
  await apri(page, { feedbacks: [lavorato], workerLog: registro });
  await page.locator('[data-fs-range="7g"]').click();
  await expect(tile(page, 'audit')).toHaveText('1');
});

test('#677 ripiego sulle righe in pagina: l\'audit non si sa, e il riquadro non deve scrivere zero', async ({ openTab }) => {
  const page = await openTab(URL);
  // La stessa segnalazione, ma com'è in pagina: la proiezione dell'elenco non
  // porta l'esito dell'audit, e la riga è marcata come parziale.
  const proiettato = fb({ seq: 2, status: 'done', createdAt: g(4), reviewedAt: g(3), _proiezione: true });
  await apri(page, { feedbacks: [proiettato], workerLog: registro, ripiego: true });
  await page.locator('[data-fs-range="7g"]').click();
  // Il lavoro è stato controllato e l'esito era «passato»: la scheda non deve
  // dichiarare il contrario su un dato che non ha mai letto.
  await expect(tile(page, 'audit')).not.toHaveText('0');
  await expect(sub(page, 'audit')).not.toContainText('0 bocciati · 0 saltati');
});
