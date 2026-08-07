// VERIFIER #397 stress — non committare come sorgente feature (traccia di run).
import { test, expect } from './fixtures/electron.mjs';

const URL_SPELLCHECK = 'filo://spellcheck/spellcheck.html';

const TA_PAGE = `<!doctype html><html><body style="margin:0">
  <textarea id="ta" style="font:16px monospace;padding:8px;width:500px;height:160px"></textarea>
  <div id="ce" contenteditable="true" style="font:16px monospace;padding:8px;width:500px;min-height:80px;border:1px solid #ccc"></div>
</body></html>`;

async function openSettings(openTab) {
  const page = await openTab(URL_SPELLCHECK);
  await page.waitForFunction(() => {
    const el = document.getElementById('addAutocorrect');
    return el && el.textContent.length > 0;
  }, null, { timeout: 8000 });
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
  }, before + 1, { timeout: 4000 });
}

async function openWebPage(openTab, testServer) {
  const url = testServer.html(TA_PAGE);
  const page = await openTab(url);
  await page.waitForFunction(
    () => document.documentElement.dataset.filoContentReady === '1',
    null, { timeout: 8000 });
  await page.waitForTimeout(500);
  return page;
}

test('multi-parola: casing, longest-match, boundary sinistro, punteggiatura, 3 parole', async ({ openTab, testServer }) => {
  const s = await openSettings(openTab);
  await addAutocorrect(s, 'x es', 'per esempio');
  await addAutocorrect(s, 'es', 'esatto');            // chiave breve concorrente
  await addAutocorrect(s, 'p f', 'per favore');
  await addAutocorrect(s, 'a b c', 'alfa beta gamma'); // 3 parole

  const page = await openWebPage(openTab, testServer);

  // 1) longest-match: "x es " deve dare la 2-parola, non "x esatto"
  await page.click('#ta');
  await page.type('#ta', 'x es ');
  await expect.poll(() => page.locator('#ta').inputValue(), { timeout: 3000 }).toBe('per esempio ');

  // 2) casing tutto maiuscolo si propaga
  await page.fill('#ta', '');
  await page.click('#ta');
  await page.type('#ta', 'P F ');
  await expect.poll(() => page.locator('#ta').inputValue(), { timeout: 3000 }).toBe('PER FAVORE ');

  // 3) boundary sinistro della chiave multi-parola: "x es" NON deve scattare
  //    dentro "ax es" (la 'x' è attaccata alla 'a'). La parola standalone "es"
  //    invece è legittima e diventa "esatto": prova entrambe le cose insieme.
  await page.fill('#ta', '');
  await page.click('#ta');
  await page.type('#ta', 'ax es ');
  await expect.poll(() => page.locator('#ta').inputValue(), { timeout: 3000 }).toBe('ax esatto ');

  // 4) confine di punteggiatura (non solo spazio)
  await page.fill('#ta', '');
  await page.click('#ta');
  await page.type('#ta', 'x es.');
  await expect.poll(() => page.locator('#ta').inputValue(), { timeout: 3000 }).toBe('per esempio.');

  // 5) chiave a 3 parole
  await page.fill('#ta', '');
  await page.click('#ta');
  await page.type('#ta', 'a b c ');
  await expect.poll(() => page.locator('#ta').inputValue(), { timeout: 3000 }).toBe('alfa beta gamma ');
});

test('multi-parola in contenteditable + correzione con HTML non esegue script', async ({ openTab, testServer }) => {
  const s = await openSettings(openTab);
  await addAutocorrect(s, 'x es', 'per esempio');
  await addAutocorrect(s, 'xss', '<script>window.__pwned=1<\/script>');

  const page = await openWebPage(openTab, testServer);

  await page.click('#ce');
  await page.type('#ce', 'x es ');
  await expect.poll(() => page.locator('#ce').innerText(), { timeout: 3000 }).toContain('per esempio');

  await page.fill('#ce', '');
  await page.click('#ce');
  await page.type('#ce', 'xss ');
  await page.waitForTimeout(500);
  // il testo compare LETTERALE, niente script eseguito
  const pwned = await page.evaluate(() => window.__pwned || null);
  expect(pwned).toBe(null);
  const html = await page.locator('#ce').innerHTML();
  expect(html.toLowerCase()).not.toContain('<script');
  const txt = await page.locator('#ce').innerText();
  expect(txt).toContain('<script>');
});

test('form: input vuoto/spazi non crea righe fantasma; dizionario solo-spazi non aggiunge', async ({ openTab }) => {
  const s = await openSettings(openTab);
  const before = await s.locator('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)').count();
  // solo spazi in entrambi i campi
  await s.fill('#newWord', '   ');
  await s.fill('#newCorrection', '   ');
  await s.click('#addAutocorrect');
  await s.waitForTimeout(300);
  expect(await s.locator('#autocorrectList .sn-spell-row:not(.sn-spell-row-head)').count()).toBe(before);

  // dizionario: solo spazi non deve aggiungere nulla
  await s.fill('#newDictWord', '     ');
  await s.click('#addDict');
  await s.waitForTimeout(300);
  const dictWords = await s.locator('#dictList .sn-spell-word').count();
  expect(dictWords).toBe(0);
});
