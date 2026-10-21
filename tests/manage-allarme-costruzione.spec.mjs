// #1334 (#1002, #1035): l'allarme della pubblicazione (agent:costruzione con la prova del server) in Gestione ha il
// suo mittente, il suo posto «per creatore» e il suo filtro (nelle statistiche è la classe `server`, §10); il solo
// nome non è un allarme. In Automazioni gli interruttori sono per fiducia: allarmi ed esplorazione entrano comunque.

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';

const URL = 'filo://manage/manage.html';
const GIORNO = 24 * 60 * 60 * 1000;
const g = (n) => new Date(Date.now() - n * GIORNO).toISOString();

const ALLARME = Object.freeze({
  _id: 'al-1', seq: 1000, subSeq: 0, priority: 3, priorityManual: true,
  name: 'Controlli automatici rossi (statoSistema.test.mjs)',
  text: 'not ok 3 - tests/unit/statoSistema.test.mjs:54\n  ENOENT: nome di file con «:»',
  status: 'todo', statusPublic: 'open',
  clientId: 'agent:costruzione', senderProof: 'server', fiducia: 'fidato',
  pipeline: { skipped: 'routine_proven', verdicts: [], l1Category: null, l2Class: null, action: 'candidate_change', stage: 'nascita' },
  createdAt: g(1), images: [],
});

function fb(over = {}) {
  return Object.assign({
    _id: 'x-' + Math.random().toString(36).slice(2), seq: 1, subSeq: 0, priority: 1,
    name: 'titolo', text: 'testo', status: 'todo', statusPublic: 'open', createdAt: g(1), images: [],
  }, over);
}

async function apri(page, lista, tab) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo && window.SN_FEEDBACK_THREAD);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate((l) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); }, lista);
  await page.evaluate((t) => window.__mgTest.setTab(t), tab);
}

test('l’allarme della pubblicazione si legge col suo mittente, non come «Claude (ruolo non indicato)»', async ({ openTab }) => {
  const page = await openTab(URL);
  const finto = fb({ _id: 'al-2', seq: 1001, name: 'Finto allarme', clientId: 'agent:costruzione', status: 'aligned' });
  await apri(page, [ALLARME, finto], 'queue');

  const autore = page.locator('.mg-item[data-id="al-1"] .mg-item-author');
  await expect(autore).toHaveText('🏗️');
  await expect(autore).toHaveAttribute('title', 'Scritto da: Allarme della pubblicazione');

  await page.evaluate(() => window.__mgTest.openDetail('al-1'));
  const link = page.locator('#senderLink');
  await expect(link).toHaveText('🏗️ Allarme della pubblicazione');
  await expect(link).toHaveAttribute('title', 'agent:costruzione');
  await expect(page.locator('#mgThread')).toContainText('Allarme aperto dal server: i giudici non servono.');
  await page.screenshot({ path: 'tests/.shots/manage-allarme-1334.png' });

  // Lo stesso nome senza la prova del server è un utente qualunque.
  await page.evaluate(() => window.__mgTest.setTab('inbox'));
  const finta = page.locator('.mg-item[data-id="al-2"] .mg-item-author');
  await expect(finta).toHaveText('👤');
  await expect(finta).toHaveAttribute('title', 'Scritto da: Utente');
  await page.evaluate(() => window.__mgTest.openDetail('al-2'));
  await expect(page.locator('#senderLink')).not.toContainText('Allarme');
  await expect(page.locator('#mgThread')).not.toContainText('Allarme aperto dal server');
});

test('«per creatore» mette l’allarme fra le routine, dopo l’esplorazione e prima delle automazioni senza ruolo', async ({ openTab }) => {
  const page = await openTab(URL);
  await apri(page, [
    fb({ _id: 'F', seq: 4, clientId: 'filo:chat', createdAt: g(1) }),
    fb({ _id: 'C', seq: 3, clientId: 'agent:gemma-4', senderProof: 'admin', createdAt: g(2) }),
    { ...ALLARME, _id: 'A', seq: 2, createdAt: g(3) },
    fb({ _id: 'P', seq: 1, clientId: 'routine:prober', senderProof: 'server', createdAt: g(4) }),
  ], 'queue');
  await expect(page.locator('.mg-item')).toHaveCount(4);

  await page.locator('#mgSortBtn').click();
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Per creatore' }).click();
  await expect(page.locator('.mg-item .mg-item-author')).toHaveText(['🔍', '🏗️', '🤖', '🧵']);
});

test('il filtro per creatore ha la pasticca dell’allarme, e il gruppo delle routine lo conta', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { window.__mgTest.setAdmin(true); window.__mgTest.setData([]); });
  await apriScheda(page, 'fbstats');
  await page.evaluate((d) => window.__mgTest.setFsData(d), {
    feedbacks: [
      { ...ALLARME, _id: 'a1', seq: 1, createdAt: g(1) },
      { ...ALLARME, _id: 'a2', seq: 2, createdAt: g(2) },
      fb({ seq: 3, clientId: 'routine:prober', senderProof: 'server', createdAt: g(2) }),
      fb({ seq: 4, clientId: 'utente-vero', createdAt: g(2) }),
      // Il finto non conta fra gli allarmi: un `agent:` senza prova è un collaudo (§10).
      fb({ seq: 5, clientId: 'agent:costruzione', createdAt: g(2) }),
    ],
    workerLog: [],
  });
  await expect(page.locator('#mgFsBody')).toBeVisible();
  await page.locator('[data-fs-range="30g"]').click();
  const ricevuti = page.locator('[data-fs-id="ricevuti"] .mg-tile-n');
  await expect(ricevuti).toHaveText('5');

  const chip = page.locator('[data-fs-creator="server"]');
  await expect(chip).toContainText('Allarmi del server');
  await expect(chip.locator('.mg-chip-n')).toHaveText('2');
  await chip.click();
  await expect(ricevuti).toHaveText('2');
  await page.locator('[data-fs-creator="__tutti"]').click();
  await expect(ricevuti).toHaveText('5');

  const routine = page.locator('[data-fs-creator="__routine"]');
  await expect(routine).toHaveAttribute('title', /Allarmi del server/);
  await expect(routine.locator('.mg-chip-n')).toHaveText('4');
  await routine.click();
  await expect(ricevuti).toHaveText('4');
});

test('anche la pagina dei feedback dice «Allarme della pubblicazione», non un modello di nome costruzione', async ({ openTab }) => {
  const page = await openTab('filo://feedback/feedback.html');
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined' && window.__fbTest);
  await page.evaluate((items) => { SN_FEEDBACK.list = async () => items; }, [
    { ...ALLARME, _id: 'fa-1', status: 'unlabeled' },
    { ...ALLARME, _id: 'fa-2', seq: 1001, status: 'unlabeled', senderProof: undefined, fiducia: undefined, name: 'Finto allarme' },
  ]);
  await page.click('#refresh');
  await page.locator('#agentOnly').check();
  const vero = page.locator('.fb-card', { hasText: '#1000' });
  await expect(vero.locator('.fb-badge--model')).toHaveText('🏗️ Allarme della pubblicazione');
  await expect(vero.locator('.fb-badge--model')).toHaveAttribute('title', 'Aperto dal server quando una versione non si costruisce');
  await expect(vero.locator('.fb-title')).toContainText('Controlli automatici rossi');
  // Il nome senza la prova non è un ritrovamento automatico: il filtro non lo pesca.
  await expect(page.locator('.fb-card', { hasText: 'Finto allarme' })).toHaveCount(0);
});

test('in Automazioni niente interruttore per l’esplorazione e gli allarmi: la descrizione dice che entrano comunque', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
  await apriScheda(page, 'automation');

  const blocco = page.locator('#mgAutoApproveBlock');
  await expect(blocco).toBeVisible();
  await expect(blocco.locator('.mg-switch')).toHaveCount(2);
  await expect(blocco).not.toContainText('esplorazione');
  await expect(blocco).not.toContainText('Allarme');
  await expect(page.locator('#mgAutoApproveProber')).toHaveCount(0);
  await expect(page.locator('#mgAutoSwitch + .mg-auto-block-desc'))
    .toContainText('Gli allarmi della pubblicazione e i ritrovamenti dell\'esplorazione entrano in coda comunque.');
  await page.screenshot({ path: 'tests/.shots/manage-automazioni-1334.png' });
});
