// Spec Playwright: i registri del canale delle routine nella scheda "Log" della
// dashboard di gestione (#477.1).
//
// COSA VERIFICA (comportamento, non stringhe d'errore)
//   Un tentativo respinto dal server e una differenza fra la scelta delle
//   routine e quella del server DEVONO comparire all'owner: se restano solo nel
//   database, "registrato e visibile all'owner" è vero a metà — e la metà che
//   manca è quella che conta, perché un lavoratore che prova azioni fuori dal
//   suo perimetro è il segnale che qualcuno l'ha manipolato.
//
// PRE-CONDIZIONE: senza il blocco nuovo nella pagina questi assert falliscono
// (la sezione non esiste, quindi non contiene nessuna riga).

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const REJECTIONS = [
  { id: 'r1', at: '2026-08-17T10:00:00.000Z', slug: 'notturna', role: 'secaudit', reason: 'role_forbids', action: 'status' },
  { id: 'r2', at: '2026-08-17T09:00:00.000Z', slug: 'notturna', role: 'verifier', reason: 'branch_mismatch', action: 'verdict' },
];
const COMPARISONS = [
  { id: 'c1', at: '2026-08-17T09:30:00.000Z', slug: 'notturna', same: true, git: { role: 'new-work', num: '#500' }, server: { role: 'new-work', num: '#500' } },
  { id: 'c2', at: '2026-08-17T08:00:00.000Z', slug: 'notturna', same: false, git: { role: 'verifier', num: '#490' }, server: { role: 'new-work', num: '#500' }, serverBlindToBranchState: true },
];

test('i rifiuti del canale compaiono all owner, col motivo in chiaro e la routine che li ha causati', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderChannelLog);
  // La scheda va aperta: il blocco vive dentro il pannello "Log".
  await page.locator('.mg-tab[data-tab="log"]').click();

  await page.evaluate(({ rej, cmp }) => window.__mgTest.renderChannelLog(rej, cmp), { rej: REJECTIONS, cmp: COMPARISONS });

  const section = page.locator('#mgChannelSection');
  await expect(section).toBeVisible();

  const rows = page.locator('#mgChannelList .mg-log-row');
  await expect(rows).toHaveCount(4);

  // Le righe sono in ordine cronologico inverso: il rifiuto delle 10:00 è la prima.
  await expect(rows.nth(0)).toContainText('Respinto');
  await expect(rows.nth(0)).toContainText('azione fuori dal ruolo');
  await expect(rows.nth(0)).toContainText('notturna');
  // Il motivo grezzo del codice non arriva mai all'owner.
  await expect(page.locator('#mgChannelList')).not.toContainText('role_forbids');
  await expect(page.locator('#mgChannelList')).not.toContainText('branch_mismatch');
  await expect(page.locator('#mgChannelList')).toContainText('ramo diverso da quello assegnato');

  // Un rifiuto si distingue a colpo d'occhio da un confronto.
  await expect(rows.nth(0).locator('.mg-log-role--deny')).toHaveCount(1);
});

test('i confronti dicono quando le due strade scelgono lo stesso lavoro e quando no', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderChannelLog);
  // La scheda va aperta: il blocco vive dentro il pannello "Log".
  await page.locator('.mg-tab[data-tab="log"]').click();

  await page.evaluate(({ rej, cmp }) => window.__mgTest.renderChannelLog(rej, cmp), { rej: [], cmp: COMPARISONS });

  const rows = page.locator('#mgChannelList .mg-log-row');
  await expect(rows).toHaveCount(2);

  // Accordo: una riga sola col lavoro scelto.
  await expect(rows.nth(0)).toContainText('Accordo');
  await expect(rows.nth(0)).toContainText('Nuovo lavoro');
  await expect(rows.nth(0)).toContainText('#500');

  // Disaccordo: si vedono ENTRAMBE le scelte, e il perché la differenza è attesa.
  await expect(rows.nth(1)).toContainText('Scelte diverse');
  await expect(rows.nth(1)).toContainText('Verifica');
  await expect(rows.nth(1)).toContainText('#490');
  await expect(rows.nth(1)).toContainText('Nuovo lavoro');
  await expect(rows.nth(1)).toContainText('il server non vede ancora lo stato dei rami');

  // Mai il nome interno del ruolo.
  await expect(page.locator('#mgChannelList')).not.toContainText('new-work');
});

test('senza rifiuti e senza confronti il blocco lo dice, invece di restare vuoto', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderChannelLog);
  // La scheda va aperta: il blocco vive dentro il pannello "Log".
  await page.locator('.mg-tab[data-tab="log"]').click();

  await page.evaluate(() => window.__mgTest.renderChannelLog([], []));

  await expect(page.locator('#mgChannelSection')).toBeVisible();
  await expect(page.locator('#mgChannelEmpty')).toBeVisible();
  await expect(page.locator('#mgChannelList')).toBeHidden();
});

// #958: una prova degli unit sulla fusione che manca sempre non protegge niente. Le richieste senza prova si vedono
// una per una, e quando il server le giudica frequenti un avviso sta in cima al blocco.
const PROVE = {
  righe: [
    { at: '2026-10-04T10:00:00.000Z', via: 'routine', slug: 'notturna', branch: 'worker/42', esito: 'non_provata',
      motivo: 'fusione di prova non riuscita (fatal: refusing to merge unrelated histories)', storia: { superficiale: true, approfondito: 0, intera: false } },
    { at: '2026-10-04T09:00:00.000Z', via: 'routine', slug: 'notturna', branch: 'worker/41', esito: 'verde', mainSha: 'b'.repeat(40) },
    { at: '2026-10-04T08:00:00.000Z', via: 'locale', branch: 'claude/x', esito: 'assente' },
  ],
  riepilogo: { ultime: 3, senzaProva: 2, frequente: true },
};

test('le fusioni senza prova degli unit compaiono all owner, e quando sono frequenti un avviso sta in cima', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderChannelLog);
  await page.locator('.mg-tab[data-tab="log"]').click();

  await page.evaluate((prove) => window.__mgTest.renderChannelLog([], [], prove), PROVE);
  const rows = page.locator('#mgChannelList .mg-log-row');
  // L'avviso più le due richieste senza prova: quella provata non è una notizia.
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('2 delle ultime 3 richieste di fusione');
  await expect(rows.nth(0).locator('.mg-log-role--deny')).toHaveCount(1);
  await expect(rows.nth(1)).toContainText('Senza prova');
  await expect(rows.nth(1)).toContainText('worker/42');
  await expect(rows.nth(1)).toContainText('unrelated histories');
  await expect(rows.nth(1)).toContainText('clone poco profondo');
  await expect(rows.nth(2)).toContainText('fusione locale');
  await expect(rows.nth(2)).toContainText('strumenti senza la prova degli unit');
  await expect(page.locator('#mgChannelList')).not.toContainText('non_provata');
  await expect(page.locator('#mgChannelList')).not.toContainText('worker/41');

  // Rare: le righe restano, l'avviso no.
  await page.evaluate((prove) => window.__mgTest.renderChannelLog([], [], { ...prove, riepilogo: { ultime: 20, senzaProva: 2, frequente: false } }), PROVE);
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#mgChannelList')).not.toContainText('delle ultime');
});
