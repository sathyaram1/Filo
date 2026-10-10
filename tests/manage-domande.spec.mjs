// #1150 (SPEC-DOMANDE §2.1, §3): la sezione Domande. Con una domanda bloccante Gestione si apre lì; senza, sui
// Ricevuti se non sono vuoti; un clic dell'utente vince sulla scelta automatica. Fase uno: elenco semplice,
// e finché il server non pubblica le domande la pagina lo dice senza numeri.
import { test, expect } from './fixtures/electron.mjs';

const MANAGE = 'filo://manage/manage.html';
const base = { clientId: 'tester@example.com', createdAt: '2026-10-01T08:00:00Z', images: [], subSeq: 0, text: 'x' };
const RICEVUTO = { ...base, _id: 'i1', seq: 11, name: 'Da guardare', status: 'unlabeled' };
const ora = Date.now();
const BLOCCANTE = { id: 'D-7', numero: 7, stato: 'aperta', priorita: 'bloccante', titolo: 'Serve una scelta sul login', creataIl: ora };
const IMPORTANTE = { id: 'D-8', numero: 8, stato: 'aperta', priorita: 'importante', titolo: 'Colore dei pulsanti', creataIl: ora };
const IN_LAVORO = { id: 'D-9', numero: 9, stato: 'in_lavorazione', priorita: 'importante', titolo: 'Già presa', creataIl: ora };

async function apri(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
}

test('senza domande pubblicate il pannello lo dice e la sezione non ha numero', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  await expect(page.locator('#panel-domande')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('#mgDomandeStato')).toContainText('non sono ancora disponibili');
  await expect(page.locator('.mg-sezione[data-sezione="domande"] .mg-sezione-count')).toHaveText('');
  await expect(page.locator('#mgDomandeRiprova')).toBeHidden();
});

test('con una bloccante aperta Gestione si apre su Domande, anche con i Ricevuti pieni', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate((items) => window.__mgTest.setData(items), [RICEVUTO]);
  await page.evaluate((d) => window.__mgTest.setDomande(d), [IMPORTANTE, BLOCCANTE, IN_LAVORO]);
  const scelta = await page.evaluate(() => window.__mgTest.sceltaApertura());
  expect(scelta).toMatchObject({ sezione: 'domande', scheda: 'domande', motivo: 'bloccante' });

  await expect(page.locator('.mg-sezione[data-sezione="domande"]')).toHaveClass(/mg-sezione--active/);
  await expect(page.locator('.mg-sezione[data-sezione="domande"]')).toHaveClass(/mg-sezione--urgente/);
  await expect(page.locator('.mg-sezione[data-sezione="domande"] .mg-sezione-count')).toHaveText('(2)');
  await expect(page.locator('.mg-tab[data-tab="domande"]')).toHaveText('Da rispondere (2)');
  await expect(page.locator('.mg-tab[data-tab="domande-lavoro"]')).toHaveText('In lavorazione (1)');
  await expect(page.locator('.mg-tab[data-tab="domande-archivio"]')).toHaveText('Archivio (0)');
  const righe = page.locator('#mgDomandeLista .mg-domanda');
  await expect(righe).toHaveCount(2);
  await expect(page.locator('#mgDomandeLista .mg-domanda[data-priorita="bloccante"]')).toContainText('D-7');
  await expect(page.locator('#mgDomandeLista .mg-domanda[data-priorita="bloccante"]')).toContainText('Serve una scelta sul login');

  await page.locator('.mg-tab[data-tab="domande-lavoro"]').click();
  await expect(righe).toHaveCount(1);
  await expect(righe.first()).toContainText('Già presa');
  await page.locator('.mg-tab[data-tab="domande-archivio"]').click();
  await expect(righe).toHaveCount(0);
  await expect(page.locator('#mgDomandeStato')).toHaveText('Nessuna domanda in archivio.');
});

test('senza bloccante si apre sui Ricevuti se non sono vuoti', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.locator('.mg-sezione[data-sezione="routine"]').click();
  await page.evaluate((items) => window.__mgTest.setData(items), [RICEVUTO]);
  await page.evaluate((d) => window.__mgTest.setDomande(d), [IMPORTANTE]);
  expect((await page.evaluate(() => window.__mgTest.sceltaApertura())).motivo).toBe('ricevuti');
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveClass(/mg-tab--active/);
  await expect(page.locator('#panel-list')).toHaveClass(/mg-panel--active/);
});

test('dopo un clic dell’utente la scelta d’apertura non cambia sezione', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.locator('.mg-sezione[data-sezione="routine"]').click();
  await page.evaluate((d) => window.__mgTest.setDomande(d), [BLOCCANTE]);
  expect(await page.evaluate(() => window.__mgTest.sceltaApertura({ comeAvvio: true }))).toBeNull();
  await expect(page.locator('.mg-sezione[data-sezione="routine"]')).toHaveClass(/mg-sezione--active/);
  await expect(page.locator('#panel-automation')).toHaveClass(/mg-panel--active/);
});

test('il titolo di una domanda è testo, mai codice; un guasto si dice e si riprova', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate(() => window.__mgTest.setDomande([{
    id: 'D-3', numero: 3, stato: 'aperta', priorita: 'quando_puoi', titolo: '<img src=x onerror="window.__xss=1">', creataIl: Date.now(),
  }]));
  await page.locator('.mg-sezione[data-sezione="domande"]').click();
  const riga = page.locator('#mgDomandeLista .mg-domanda');
  await expect(riga).toContainText('<img src=x');
  await expect(riga.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();

  await page.evaluate(() => window.__mgTest.setDomande(null, { errore: 'rete giù' }));
  await expect(page.locator('#mgDomandeStato')).toContainText('Non riesco a leggere le domande: rete giù');
  await expect(page.locator('#mgDomandeRiprova')).toBeVisible();
  await expect(page.locator('.mg-sezione[data-sezione="domande"] .mg-sezione-count')).toHaveText('');
});
