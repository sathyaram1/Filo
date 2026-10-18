// Verifica locale cancello-storia, giro 1: in Gestione, scheda Log, le fusioni partite senza gli unit sul risultato
// si vedono una per una, e quando sono frequenti un avviso in cima lo dice.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';
const ora = Date.now();
const at = (min) => new Date(ora - min * 60000).toISOString();

const RIGHE = [
  { at: at(1), esito: 'non_provata', via: 'routine', slug: 'notturna', branch: 'claude/a', motivo: 'non riesco a scaricare la storia che manca (timeout)', storia: { superficiale: true, approfondito: 1250, intera: true } },
  { at: at(2), esito: 'verde', via: 'routine', slug: 'notturna', branch: 'claude/b', mainSha: 'a'.repeat(40), storia: { superficiale: true, approfondito: 50, intera: false } },
  { at: at(3), esito: 'assente', via: 'routine', slug: 'diurna', branch: 'claude/c' },
  { at: at(4), esito: 'non_provata', via: 'locale', branch: 'claude/d', motivo: '<img src=x onerror="window.__xss=1">' },
];
const PROVE = { righe: RIGHE, riepilogo: { ultime: 4, senzaProva: 3, superficiali: 2, storiaIntera: 1, soglia: 3, frequente: true } };

async function apri(openTab) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.renderChannelLog);
  await page.locator('.mg-tab[data-tab="log"]').click();
  return page;
}

test('le fusioni senza prova si vedono, con l avviso in cima quando sono frequenti', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate((p) => window.__mgTest.renderChannelLog([], [], p), PROVE);
  const rows = page.locator('#mgChannelList .mg-log-row');
  await expect(rows.first()).toBeVisible();
  await expect(rows.first()).toContainText('3 delle ultime 4 richieste di fusione');
  const lista = page.locator('#mgChannelList');
  await expect(lista).toContainText('claude/a');
  await expect(lista).toContainText('claude/c');
  await expect(lista).toContainText('claude/d');
  await expect(lista).toContainText('clone poco profondo, storia scaricata tutta');
  // la prova riuscita non è una riga «senza prova»
  await expect(lista).not.toContainText('claude/b');
  await expect(lista).toContainText('<img src=x');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await page.screenshot({ path: 'tests/.shots/verifica-cancello-storia-log.png' });
});

test('sotto la soglia niente avviso, ma le righe senza prova restano', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate((p) => window.__mgTest.renderChannelLog([], [], p), { righe: RIGHE.slice(0, 2), riepilogo: { ultime: 2, senzaProva: 1, soglia: 3, frequente: false } });
  const lista = page.locator('#mgChannelList');
  await expect(lista).toContainText('claude/a');
  await expect(lista).not.toContainText('richieste di fusione sono partite');
});

test('senza proveFusione la scheda funziona come prima', async ({ openTab }) => {
  const page = await apri(openTab);
  await page.evaluate(() => window.__mgTest.renderChannelLog([{ id: 'r', at: new Date().toISOString(), reason: 'bad_ticket' }], [], null));
  await expect(page.locator('#mgChannelList .mg-log-row')).toHaveCount(1);
});
