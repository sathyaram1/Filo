// Gestione, conversazione di un feedback (#1919): ogni nota porta lo scudo della sua fiducia, come i feedback.
// Fidate le note dell'owner e quelle con l'impronta del server; non fidate le altre, anche quelle scritte prima.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import '../src/shared/feedbackThread.js';

const TH = globalThis.SN_FEEDBACK_THREAD;
const URL = 'filo://manage/manage.html';

const REPORT = 'Report del primo lavoro: fatto e provato.';
const VERDETTO = 'Verdetto da un biglietto sporco: <b>passa</b>.';
const NOTE = [
  REPORT,
  '',
  '--- La tua risposta del 30/10/2026, 21:00 ---',
  'Va bene, prosegui.',
  '',
  "--- Aggiornamento dell'agente del 30/10/2026, 22:00 ---",
  VERDETTO,
].join('\n');

const FB = {
  _id: 'fiducia-note-1', seq: 1919, subSeq: 0, text: 'Le note portano la fiducia di chi le scrive.', name: 'Fiducia delle note',
  clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato', createdAt: '2026-10-30T21:27:00Z',
  status: 'revision_capability', images: [], notes: NOTE,
};

async function apri(page, fb, ridisegno) {
  await page.evaluate(({ f, r }) => {
    window.__mgTest.setData([f]);
    window.__mgTest.setTab('queue');
    window.__mgTest.openDetail(f._id, r ? { ridisegno: true } : undefined);
  }, { f: fb, r: !!ridisegno });
}

const bolla = (page, testo) => page.locator('#mgThread .mg-bubble').filter({ hasText: testo });
const scudo = (b) => b.locator('.mg-bubble-who .mg-fiducia-segno');

test('ogni nota dice se è fidata: dell’owner o con l’impronta del server sì, le altre no', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD);
  await apri(page, { ...FB, noteFidate: [await TH.improntaTurno(REPORT)] });

  await expect(scudo(bolla(page, REPORT))).toHaveClass(/mg-fiducia-segno--fidata/);
  await expect(scudo(bolla(page, REPORT))).toHaveAttribute('aria-label', 'Nota fidata');
  await expect(scudo(bolla(page, 'Va bene, prosegui.'))).toHaveClass(/mg-fiducia-segno--fidata/);
  const sporca = scudo(bolla(page, 'Verdetto da un biglietto sporco'));
  await expect(sporca).toHaveClass(/mg-fiducia-segno--nonfidata/);
  await expect(sporca).toHaveAttribute('title', /Chi la legge si sporca/);
  // La segnalazione ha già il suo scudo in testata: la bolla non ne prende un secondo.
  await expect(scudo(bolla(page, 'Le note portano la fiducia'))).toHaveCount(0);

  mkdirSync('tests/.shots', { recursive: true });
  await sporca.hover();
  await page.screenshot({ path: 'tests/.shots/manage-fiducia-note-chiaro.png' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'tests/.shots/manage-fiducia-note-scuro.png' });
  await page.emulateMedia({ colorScheme: 'light' });

  // Un ridisegno dal vivo non raddoppia gli scudi; il server segna anche il verdetto e lo scudo si riempie.
  await apri(page, { ...FB, noteFidate: [await TH.improntaTurno(REPORT), await TH.improntaTurno(VERDETTO)] }, true);
  await expect(scudo(bolla(page, 'Verdetto da un biglietto sporco'))).toHaveClass(/mg-fiducia-segno--fidata/);
  await expect(page.locator('#mgThread .mg-bubble-who .mg-fiducia-segno')).toHaveCount(3);
});

test('note scritte prima, senza il campo, sono tutte non fidate tranne quelle dell’owner', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD);
  await apri(page, { ...FB, _id: 'fiducia-note-2' });
  await expect(scudo(bolla(page, REPORT))).toHaveClass(/mg-fiducia-segno--nonfidata/);
  await expect(scudo(bolla(page, 'Va bene, prosegui.'))).toHaveClass(/mg-fiducia-segno--fidata/);
  await expect(scudo(bolla(page, 'Verdetto da un biglietto sporco'))).toHaveClass(/mg-fiducia-segno--nonfidata/);
});
