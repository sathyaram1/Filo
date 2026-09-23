// Le pagine che salvano da sé non perdono l'ultima modifica quando spariscono,
// nemmeno col cursore ancora dentro la casella.
// La regola pura sta in tests/unit/salvaRimandato.test.mjs.

import { test, expect } from './fixtures/electron.mjs';

const OPZIONI = 'filo://options/options.html';
const ALTRO = 'filo://options/altro.html';
const PREFERENZE = 'filo://preferences/preferences.html';
const EDITOR = 'filo://editor/editor.html';
const SICUREZZA = 'filo://security/security.html';
const CORRETTORE = 'filo://spellcheck/spellcheck.html';

async function chiudiScheda(shell, frammento) {
  const id = await shell.evaluate(async (f) => {
    const s = await window.filoShell.tabs.snapshot();
    const lista = Array.isArray(s) ? s : (s && s.tabs) || [];
    const t = lista.find((x) => (x.url || '').includes(f));
    return t ? t.id : null;
  }, frammento);
  expect(id, `la scheda ${frammento} non compare fra quelle aperte`).toBeTruthy();
  await shell.evaluate((i) => window.filoShell.tabs.close(i), id);
}

const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());

test('Opzioni: il limite di spesa digitato si salva anche chiudendo la scheda col cursore nel campo', async ({ app, shell, openTab }) => {
  const page = await openTab(OPZIONI);
  await page.waitForSelector('#monthlyLimit', { timeout: 15_000 });
  await page.click('#monthlyLimit');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('47');

  await chiudiScheda(shell, 'options/options.html');

  await expect
    .poll(() => impostazioni(app).then((s) => s.monthlyLimitEur), { timeout: 8000 })
    .toBe(47);
});

test('Preferenze: lo stile digitato si salva anche chiudendo la scheda', async ({ app, shell, openTab }) => {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });
  await page.click('#agentStyleText');
  await page.keyboard.type('scritto e chiuso subito');

  await chiudiScheda(shell, 'preferences');

  await expect
    .poll(() => impostazioni(app).then((s) => s.agentStyle || ''), { timeout: 8000 })
    .toBe('scritto e chiuso subito');
});

// Un campo per campo dimentica un campo: qui si guardano i due numerici, che
// erano rimasti fuori dall'elenco a mano mentre il testo accanto partiva.
test('Preferenze: anche i campi numerici si salvano chiudendo la scheda col cursore dentro', async ({ app, shell, openTab }) => {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#autoArchiveIdleHours', { timeout: 15_000 });
  await page.click('#autoArchiveIdleHours');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('23');

  await chiudiScheda(shell, 'preferences');

  await expect
    .poll(() => impostazioni(app).then((s) => (s.autoArchive || {}).idleHours), { timeout: 8000 })
    .toBe(23);
});

test('Preferenze: la conferma si spegne anche digitando in un campo numerico', async ({ shell, openTab }) => {
  const page = await openTab(PREFERENZE);
  await page.waitForSelector('#showHomeMessage', { timeout: 15_000 });
  const acceso = () => page.evaluate(() => document.getElementById('savedHint').classList.contains('sn-show'));

  await page.click('#showHomeMessage');
  await expect.poll(acceso, { timeout: 6000 }).toBe(true);

  await page.click('#notifDuration');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('42');
  await page.waitForTimeout(100);
  expect(await acceso(), 'la conferma resta accesa mentre il numero digitato non è ancora salvato').toBe(false);

  await chiudiScheda(shell, 'preferences');
});

test('Altro: i domini esclusi digitati si salvano anche chiudendo la scheda col cursore nella casella', async ({ app, shell, openTab }) => {
  const page = await openTab(ALTRO);
  await page.waitForSelector('#blocklist', { timeout: 15_000 });
  await page.click('#blocklist');
  await page.keyboard.type('esempio-escluso.test');

  await chiudiScheda(shell, 'options/altro.html');

  await expect
    .poll(() => impostazioni(app).then((s) => (s.blocklist || []).join(',')), { timeout: 8000 })
    .toBe('esempio-escluso.test');
});

test('Altro: la conferma «Salvato» si spegne appena arriva un\'altra modifica', async ({ openTab }) => {
  const page = await openTab(ALTRO);
  await page.waitForSelector('#blocklist', { timeout: 15_000 });
  const acceso = () => page.evaluate(() => document.getElementById('savedHint').classList.contains('sn-show'));
  const scrivi = (t) => page.evaluate((v) => {
    const el = document.getElementById('blocklist');
    el.value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, t);

  await scrivi('primo.test');
  await expect.poll(acceso, { timeout: 6000 }).toBe(true);

  await scrivi('primo.test\nsecondo.test');
  await page.waitForTimeout(150);
  expect(await acceso(),
    'la conferma resta accesa mentre la modifica nuova non è ancora salvata').toBe(false);
});

test('Editor: il testo appena scritto resta anche chiudendo la scheda', async ({ shell, openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('#doc', { timeout: 20_000 });
  await page.click('#doc');
  await page.keyboard.type('ultima frase scritta prima di chiudere');
  await expect.poll(() => page.locator('#doc').innerText(), { timeout: 5000 })
    .toContain('ultima frase scritta prima di chiudere');

  await chiudiScheda(shell, 'editor');
  await new Promise((r) => setTimeout(r, 1500));

  const riaperto = await openTab(EDITOR);
  await riaperto.waitForSelector('#doc', { timeout: 20_000 });
  await expect.poll(() => riaperto.locator('#doc').innerText(), { timeout: 8000 })
    .toContain('ultima frase scritta prima di chiudere');
});

// ── L'altra metà della regola: i campi che si confermano al blur ─────────────
// Una rinomina o la riga di un elenco diventano una modifica solo quando il
// cursore ne esce. Chiudendo la scheda il cursore non esce mai.

test('Sicurezza: il dominio appena scritto si salva anche chiudendo la scheda', async ({ app, shell, openTab }) => {
  const page = await openTab(SICUREZZA);
  await page.waitForSelector('#sec-siteblock', { timeout: 20_000 });
  if (!(await page.isChecked('#sec-siteblock'))) await page.click('#sec-siteblock');
  await expect
    .poll(() => impostazioni(app).then((s) => !!((s.security || {}).siteBlock || {}).enabled), { timeout: 8000 })
    .toBe(true);

  await page.click('#sec-siteblock-blacklist');
  await page.keyboard.type('esempio-bloccato.com');
  await chiudiScheda(shell, 'security');

  await expect
    .poll(() => impostazioni(app).then((s) => ((s.security || {}).siteBlock || {}).blacklist || []), { timeout: 8000 })
    .toContain('esempio-bloccato.com');
});

test('Sicurezza: la conferma «Salvato» si spegne appena arriva un\'altra modifica', async ({ openTab }) => {
  const page = await openTab(SICUREZZA);
  await page.waitForSelector('#sec-protect-ip', { timeout: 20_000 });
  const acceso = () => page.locator('#savedHint').evaluate((el) => el.classList.contains('sn-show'));

  await page.click('#sec-protect-ip');
  await expect.poll(acceso, { timeout: 8000 }).toBe(true);

  if (!(await page.isChecked('#sec-siteblock'))) await page.click('#sec-siteblock');
  await page.click('#sec-siteblock-blacklist');
  await page.keyboard.type('mentre-la-conferma-e-accesa.com');
  expect(await acceso(),
    'la conferma resta accesa mentre la modifica nuova non è ancora salvata').toBe(false);
});

test('Editor: il nome nuovo del documento resta anche chiudendo la scheda', async ({ shell, openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('#docTitle', { timeout: 20_000 });
  await page.click('#docTitle', { button: 'right' });
  await page.waitForSelector('.ed-title-ctxmenu', { timeout: 5000 });
  await page.locator('.ed-title-ctxmenu .sn-select-option', { hasText: 'Rinomina' }).first().click();
  await page.waitForSelector('.ed-doc-title-input', { timeout: 5000 });
  await page.keyboard.type('nome scritto e chiuso subito');

  await chiudiScheda(shell, 'editor');
  await new Promise((r) => setTimeout(r, 1500));

  const riaperto = await openTab(EDITOR);
  await riaperto.waitForSelector('#docTitle', { timeout: 20_000 });
  await expect.poll(() => riaperto.locator('#docTitle').innerText(), { timeout: 8000 })
    .toContain('nome scritto e chiuso subito');
});

test('Correttore: la correzione riscritta resta anche chiudendo la scheda', async ({ app, shell, openTab }) => {
  const regole = () => app.evaluate(async () => globalThis.SN_STORAGE.getRaw('sn_autocorrect', {}));
  const page = await openTab(CORRETTORE);
  await page.waitForSelector('#newWord', { timeout: 20_000 });
  await page.fill('#newWord', 'perke');
  await page.fill('#newCorrection', 'perché');
  await page.click('#addAutocorrect');
  await expect.poll(() => regole().then((r) => r.perke || ''), { timeout: 8000 }).toBe('perché');

  await page.locator('.sn-spell-row input').nth(1).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('perché sì');
  await chiudiScheda(shell, 'spellcheck');

  await expect.poll(() => regole().then((r) => r.perke || ''), { timeout: 8000 }).toBe('perché sì');
});
