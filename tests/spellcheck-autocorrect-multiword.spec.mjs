// Feedback #397 — le correzioni automatiche di PIÙ parole ("x es" → "per esempio")
// venivano salvate ma non scattavano mai: tryAutocorrect risaliva al solo token
// prima del confine e cercava quella singola parola nella mappa, quindi una
// chiave con uno spazio dentro era irraggiungibile.
//
// Questi test asseriscono il SUCCESSO della sostituzione (il testo cambia
// davvero), non l'assenza di un errore. Senza il fix il primo test è ROSSO:
// digitando "x es " la textarea resta "x es ".

import { test, expect } from './fixtures/electron.mjs';

const URL_SPELLCHECK = 'filo://spellcheck/spellcheck.html';

const TA_PAGE = `<!doctype html><html><body style="margin:0">
  <textarea id="ta" style="font:16px monospace;padding:8px;width:400px;height:120px"></textarea>
</body></html>`;

async function openSpellcheckPage(openTab) {
  const page = await openTab(URL_SPELLCHECK);
  await page.waitForFunction(() => {
    const el = document.getElementById('addAutocorrect');
    return el && el.textContent.length > 0;
  }, null, { timeout: 8_000 });
  return page;
}

async function addAutocorrect(page, trigger, correction) {
  await page.fill('#newWord', trigger);
  await page.fill('#newCorrection', correction);
  const before = await page.locator('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)').count();
  await page.click('#addAutocorrect');
  await page.waitForFunction((n) => {
    const rows = document.querySelectorAll('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)');
    return rows.length >= n;
  }, before + 1, { timeout: 4_000 });
}

// ---------------------------------------------------------------------------
// tryAutocorrect: una chiave multi-parola scatta durante la digitazione
// ---------------------------------------------------------------------------
test('correzione automatica multi-parola: "x es " diventa "per esempio "', async ({ openTab, testServer }) => {
  // 1) Configura le regole PRIMA di aprire la pagina web: il content script le
  //    legge da storage all'init.
  const settingsPage = await openSpellcheckPage(openTab);
  await addAutocorrect(settingsPage, 'x es', 'per esempio');
  await addAutocorrect(settingsPage, 'cmq', 'comunque');

  // 2) Apri una pagina esterna con una textarea e attendi i content script.
  const url = testServer.html(TA_PAGE);
  const page = await openTab(url);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentReady === '1',
    null, { timeout: 8000 },
  );
  // loadAutocorrect() è async e non attesa dall'init: lascia che si assesti.
  await page.waitForTimeout(500);

  // 3) Focus (aggancia il watcher) e digita la scorciatoia multi-parola + spazio.
  await page.click('#ta');
  await page.type('#ta', 'x es ');

  // ASSERISCE IL SUCCESSO: la sostituzione multi-parola è avvenuta.
  await expect.poll(
    () => page.locator('#ta').inputValue(),
    { timeout: 3000 },
  ).toBe('per esempio ');

  // 4) Regressione: la scorciatoia a parola singola continua a funzionare,
  //    anche subito dopo l'espansione multi-parola.
  await page.type('#ta', 'cmq ');
  await expect.poll(
    () => page.locator('#ta').inputValue(),
    { timeout: 3000 },
  ).toBe('per esempio comunque ');
});

// ---------------------------------------------------------------------------
// Dizionario personale: input multi-parola aggiunto come voci separate
// (una voce con spazi dentro non verrebbe mai confrontata con un token).
// ---------------------------------------------------------------------------
test('dizionario personale: "New York" viene aggiunto come due voci separate', async ({ openTab }) => {
  const page = await openTab(URL_SPELLCHECK);
  await page.waitForFunction(() => {
    const el = document.getElementById('addDict');
    return el && el.textContent.length > 0;
  }, null, { timeout: 8_000 });

  await page.fill('#newDictWord', 'New York');
  await page.click('#addDict');

  await page.waitForFunction(() => {
    return document.getElementById('dictList')?.querySelectorAll('.sn-spell-word').length === 2;
  }, null, { timeout: 4_000 });

  const words = await page.locator('#dictList .sn-spell-word').allTextContents();
  const set = new Set(words);
  expect(set.has('New')).toBe(true);
  expect(set.has('York')).toBe(true);

  // Lo storage contiene due parole distinte, non la stringa "New York".
  const stored = await page.evaluate(async () => {
    const d = await chrome.storage.local.get('sn_personal_dict');
    return d.sn_personal_dict || [];
  });
  expect(stored).toContain('New');
  expect(stored).toContain('York');
  expect(stored).not.toContain('New York');
});
