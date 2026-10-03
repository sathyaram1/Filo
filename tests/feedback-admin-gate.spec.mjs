// Il vero cancello del triage e dell'interruttore dell'autonomia sta nel main:
// anche aggirando la UI, senza un amministratore loggato (userData pulito) le
// scritture tornano ok:false. Prima del gating un non-admin poteva spostare un
// feedback o ATTIVARE l'autonomia per tutti.

import { test, expect } from './fixtures/electron.mjs';

const MANAGE_URL = 'filo://manage/manage.html';

async function pagina(openTab) {
  const page = await openTab(MANAGE_URL);
  await page.waitForFunction(() => window.filo && typeof window.filo.message === 'function');
  return page;
}

test('feedback: il main rifiuta feedback_update da utente non admin', async ({ openTab }) => {
  const page = await pagina(openTab);
  const res = await page.evaluate(() =>
    window.filo.message({ type: 'feedback_update', id: 'non-esiste', status: 'todo' })
  );
  expect(res).toBeTruthy();
  expect(res.ok).toBe(false);
  expect(String(res.error || '')).toMatch(/amministrator/i);
});

test('automazione: il main rifiuta automation_get/set da utente non admin', async ({ openTab }) => {
  const page = await pagina(openTab);

  const get = await page.evaluate(() => window.filo.message({ type: 'automation_get' }));
  expect(get).toBeTruthy();
  expect(get.ok).toBe(false);
  expect(String(get.error || '')).toMatch(/amministrator/i);

  const set = await page.evaluate(() => window.filo.message({ type: 'automation_set', enabled: true }));
  expect(set).toBeTruthy();
  expect(set.ok).toBe(false);
  expect(String(set.error || '')).toMatch(/amministrator/i);
});
