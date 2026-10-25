// #851: un giudice che non ha votato perché nessun host del suo modello dichiara la ritenzione zero lo dice, col
// modello da cambiare, invece della frase generica «scaduto il tempo, credito esaurito o modello non configurato».

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

const FB = {
  _id: 'fb-zdr-851',
  text: 'Il tasto destro non apre il menu.',
  name: 'Menu del tasto destro',
  seq: 851, subSeq: 0, status: 'new',
  clientId: 'tester@example.com', createdAt: '2026-10-25T10:00:00Z',
  pipeline: {
    action: 'human_review', l1Category: 'clean', l2Class: 'aligned', l2Unfiltered: true, stage: 'L2',
    expectedJudges: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'],
    missingJudges: ['fixed_2'],
    verdicts: [
      { judge: 'fixed_1', class: 'aligned', reasoning: 'Bug reale.', model: 'deepseek/deepseek-v4-pro' },
      { judge: 'fixed_3', class: 'aligned', reasoning: 'Allineato.', model: 'moonshotai/kimi-k2.6' },
      { judge: 'dynamic', class: 'aligned', reasoning: 'Ok.', model: 'anthropic/claude-haiku-4.5' },
    ],
    judgeFailures: [
      { judge: 'fixed_2', kind: 'zdr', model: 'z-ai/glm-5.2', message: 'nessun host a ritenzione zero per z-ai/glm-5.2' },
    ],
    decidedAt: '2026-10-25T10:01:00Z',
  },
};

async function apri(openTab, fb) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW && window.filo);
  await page.evaluate((f) => { window.__mgTest.setAdmin(true); window.__mgTest.setData([f]); }, fb);
  await page.evaluate((id) => window.__mgTest.openDetail(id), fb._id);
  await expect(page.locator('#mgLivelliRow .mg-dot')).toHaveCount(4);
  return page;
}

test('il giudice senza host a ritenzione zero dice perché non ha votato e quale modello cambiare', async ({ openTab }) => {
  const page = await apri(openTab, FB);
  await page.locator('#mgLivelliRow .mg-dot--empty').click();
  const testo = page.locator('#mgSide .mg-liv-testo');
  await expect(testo).toContainText('Nessun host di «z-ai/glm-5.2» si impegna a non conservare i dati');
  await expect(testo).toContainText('Modelli di supporto');
  await expect(testo).not.toContainText('scaduto il tempo');
  await page.locator('#mgSide').screenshot({ path: 'tests/.shots/851-giudice-ritenzione-zero.png' });
});

test('senza una causa registrata resta la frase di sempre', async ({ openTab }) => {
  const { judgeFailures, ...pipeline } = FB.pipeline; // eslint-disable-line no-unused-vars
  const page = await apri(openTab, { ...FB, _id: 'fb-zdr-851-b', pipeline });
  await page.locator('#mgLivelliRow .mg-dot--empty').click();
  await expect(page.locator('#mgSide .mg-liv-testo')).toContainText('scaduto il tempo, credito esaurito o modello non configurato');
});
