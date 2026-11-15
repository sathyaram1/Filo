// #2542 (SPEC-DOMANDE §3.6): l'assorbimento lascia le domande superate legate a quella che le assorbe, nei due sensi:
// la superata dice in quale è finita e la apre, quella che assorbe elenca le assorbite e le apre. Il main è finto.
import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const ora = Date.now();

function domanda(numero, over) {
  return Object.assign({
    id: `D-${numero}`, numero, stato: 'aperta', priorita: 'importante', fiducia: 'fidato',
    titolo: `Domanda ${numero}`, creataIl: ora - numero * 1000, modificataIl: ora - numero * 1000,
    opzioni: [], consiglio: null, conversazione: [],
  }, over);
}

async function apriDomande(page, lista) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((l) => window.__mgTest.setDomande(l, { riferimenti: {} }), lista);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await expect(page.locator('#panel-domande')).toHaveClass(/mg-panel--active/);
}

const DENTRO = domanda(40, { titolo: 'Ripensare la coda dei lavori fermi', assorbite: ['D-41', 'D-42'] });
const ASSORBITA = domanda(41, { stato: 'superata', titolo: 'Il lavoro fermo da due giorni si archivia?', esito: { ok: true, superata: 'assorbita in D-40', superataDa: 'D-40' } });
// Assorbita prima che il server scrivesse il legame: lo porta solo il motivo.
const VECCHIA = domanda(42, { stato: 'superata', titolo: 'E quello fermo da una settimana?', esito: { ok: true, superata: 'assorbita in D-40' } });
const SOSTITUITA = domanda(43, { stato: 'superata', titolo: 'Domanda rifatta', esito: { ok: true, superataDa: 'D-44' } });
const SENZA = domanda(45, { stato: 'superata', titolo: 'Superata e basta', esito: { ok: true, superata: 'il lavoro è andato avanti' } });

test('la superata dice in quale domanda è stata assorbita e la apre; quella che assorbe elenca le assorbite e le apre', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apriDomande(page, [DENTRO, ASSORBITA, VECCHIA, SOSTITUITA, SENZA]);

  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-40"]').click();
  const dentro = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-40"]');
  const sez = dentro.locator('.mg-dq-assorbite-sez');
  await expect(sez.locator('.mg-dq-h')).toHaveText('Assorbe 2 domande');
  await expect(sez.locator('.mg-dq-legame')).toHaveText(['D-41', 'D-42']);
  await dentro.screenshot({ path: 'tests/.shots/manage-domande-assorbe.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-sn-theme', 'dark'));
  await dentro.screenshot({ path: 'tests/.shots/manage-domande-assorbe-scuro.png' });
  await page.evaluate(() => document.documentElement.removeAttribute('data-sn-theme'));

  await sez.locator('.mg-dq-legame[data-domanda="D-41"]').click();
  const assorbita = page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-41"]');
  await expect(assorbita.locator('.mg-dq-esito')).toHaveText('Assorbita in D-40.');
  await expect(page.locator('.mg-tab[data-tab="domande-archivio"]')).toHaveClass(/active/);
  await assorbita.screenshot({ path: 'tests/.shots/manage-domande-assorbita.png' });
  await assorbita.locator('.mg-dq-esito .mg-dq-legame[data-domanda="D-40"]').click();
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-40"]')).toBeVisible();

  await page.locator('.mg-tab[data-tab="domande-archivio"]').click();
  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-42"]').click();
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-42"] .mg-dq-esito')).toHaveText('Assorbita in D-40.');
  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-43"]').click();
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-43"] .mg-dq-esito')).toHaveText('Superata da D-44.');
  await page.locator('#mgDomandeLista .mg-domanda[data-id="D-45"]').click();
  await expect(page.locator('#mgDomandaDettaglio .mg-dq[data-id="D-45"] .mg-dq-esito')).toHaveText('Superata da un’altra domanda.');
});
