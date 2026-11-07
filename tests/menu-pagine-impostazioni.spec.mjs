// #2096 — il tasto destro nelle altre pagine di Filo: una voce delle impostazioni offre «Rimetti di serie», «Spiega cosa
// fa» e «Chiedi a Filo» (Preferenze e Modelli, dallo stesso fornitore); una voce dell'elenco documenti dell'Editor apre il
// menu di QUEL documento, non di quello aperto.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { clickConfirm, confirmText } from './helpers/confirm.mjs';

const etichette = (page) => menuDi(page).voci.evaluateAll((vs) => vs.map((v) => v.textContent.trim()));

test('Preferenze: «Rimetti di serie» rimette il valore, e la voce si spiega o si chiede all’Aiuto', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ tabPreview: { enabled: false } }));
  const page = await openTab('filo://preferences/preferences.html');
  const casella = page.locator('#tabPreviewEnabled');
  await expect(casella).not.toBeChecked({ timeout: 10_000 });

  await page.locator('label', { has: casella }).click({ button: 'right' });
  const voci = await etichette(page);
  for (const v of ['Rimetti di serie', 'Spiega cosa fa', 'Chiedi a Filo']) expect(voci).toContain(v);
  await page.screenshot({ path: 'tests/.shots/2096-preferenze-menu.png' });
  await menuDi(page).voce('Rimetti di serie').first().click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).tabPreview.enabled)).toBe(true);
  await expect(casella).toBeChecked();

  // «Chiedi a Filo» apre l'Aiuto con la domanda da finire, che nomina la voce.
  await page.locator('label', { has: casella }).click({ button: 'right' });
  await menuDi(page).voce('Chiedi a Filo').first().click();
  const campo = page.locator('.sn-sidebar-input textarea');
  await expect(campo).toBeVisible({ timeout: 8_000 });
  await expect(campo).toHaveValue(/^Sull'impostazione «.*Anteprima.*»: $/i);
  await expect(campo).toBeFocused();
});

// Spiega e Chiedi nominano la voce come la pagina: il titolo sopra una tendina, non le sue scelte.
test('Preferenze: «Spiega cosa fa» sulla tendina del tema manda all’Aiuto la domanda col nome «Tema»', async ({ openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://preferences/preferences.html');
  await expect(page.locator('#theme')).toBeAttached({ timeout: 10_000 });
  await page.locator('#theme').locator('xpath=..').locator('.sn-select-button').first().click({ button: 'right' });
  await menuDi(page).voce('Spiega cosa fa').first().click();
  await expect(page.locator('.sn-sidebar-msg-user').last()).toHaveText("Cosa fa l'impostazione «Tema»?", { timeout: 8_000 });
});

// Una tendina è una scelta: si rimette come un interruttore, senza chiedere di un testo che nessuno ha scritto.
test('Preferenze: «Rimetti di serie» su una tendina la rimette senza chiedere', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  const page = await openTab('filo://preferences/preferences.html');
  await expect(page.locator('#theme')).toHaveValue('dark', { timeout: 10_000 });
  await page.locator('#theme').locator('xpath=..').locator('.sn-select-button').first().click({ button: 'right' });
  await menuDi(page).voce('Rimetti di serie').first().click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).theme), { timeout: 5_000 }).toBe('system');
  expect(await confirmText(page)).toBe('');
});

// Ogni voce delle quattro pagine prende un nome dalla pagina: mai il nome interno, mai l'elenco delle scelte.
for (const url of ['filo://preferences/preferences.html', 'filo://options/options.html', 'filo://options/altro.html', 'filo://security/security.html']) {
  test(`i nomi delle voci in ${url.split('/').pop()}`, async ({ openTab }) => {
    test.setTimeout(60_000);
    const page = await openTab(url);
    await expect.poll(() => page.evaluate(() => !!(window.SN_MENU_IMPOSTAZIONI && window.SN_SIDEBAR))).toBe(true);
    const nomi = await page.evaluate(() => {
      const V = window.SN_VOCI_IMPOSTAZIONI;
      const M = window.SN_MENU_IMPOSTAZIONI;
      const S = window.SN_SIDEBAR;
      const orig = S.chiediDaPagina;
      let preso = null;
      S.chiediDaPagina = (t) => { preso = t; };
      const out = [];
      try {
        for (const [id, percorso] of Object.entries(V.campi(M.paginaDi()))) {
          const el = document.getElementById(id);
          if (!el) continue;
          preso = null;
          const c = M.vociMenu(el).find((v) => v.label === 'Chiedi a Filo');
          if (c) c.onClick();
          out.push({ id, percorso, nome: String(preso || '').replace(/^Sull'impostazione «|»:$/g, '') });
        }
      } finally { S.chiediDaPagina = orig; }
      return out;
    });
    expect(nomi.length).toBeGreaterThan(0);
    const strani = nomi.filter((n) => !n.nome || n.nome === n.id || n.nome === n.percorso || n.nome.length > 60 || /▾/.test(n.nome));
    expect(strani).toEqual([]);
  });
}

test('Preferenze: i dispositivi Bluetooth preferiti si vedono tutti e si tolgono', async ({ app, openTab }) => {
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ bluetoothPreferiti: ['00:11:22:33:44:55', '66:77:88:99:AA:BB'] }));
  const page = await openTab('filo://preferences/preferences.html');
  const righe = page.locator('#bluetoothPreferiti .mem-riga');
  await expect(righe).toHaveCount(2, { timeout: 10_000 });
  await righe.first().locator('.mem-via').click();
  await expect(righe).toHaveCount(1);
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).bluetoothPreferiti)).toEqual(['66:77:88:99:AA:BB']);
});

test('Modelli: la stessa voce sulle impostazioni della pagina', async ({ openTab }) => {
  const page = await openTab('filo://options/options.html');
  const casella = page.locator('#useDefaultModels');
  await expect(casella).toBeAttached({ timeout: 10_000 });
  await page.locator('label', { has: casella }).first().click({ button: 'right' });
  expect(await etichette(page)).toContain('Rimetti di serie');
});

// Una chiave non entra nel registro dei cambi: tolta, nessun Annulla la riporta. Si chiama per quello che fa, e chiede.
test('Modelli: sulla chiave OpenRouter la voce è «Togli la chiave», chiede conferma, e il no la lascia', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: 'sk-or-v1-chiave-mia' } }));
  const page = await openTab('filo://options/options.html');
  const campo = page.locator('#apiKey');
  await expect(campo).toBeVisible({ timeout: 10_000 });
  const chiave = () => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).apiKeys.openrouter);
  await campo.click({ button: 'right' });
  const voci = await etichette(page);
  expect(voci).toContain('Togli la chiave');
  expect(voci).not.toContain('Rimetti di serie');
  await menuDi(page).voce('Togli la chiave').first().click();
  expect(await confirmText(page)).toContain('incollarla di nuovo');
  await clickConfirm(page, 'cancel');
  expect(await chiave()).toBe('sk-or-v1-chiave-mia');
  await campo.click({ button: 'right' });
  await menuDi(page).voce('Togli la chiave').first().click();
  await clickConfirm(page, 'ok');
  await expect.poll(chiave).toBe('');
});

test('Sicurezza: «Rimetti di serie» su un elenco scritto dall’utente dice cosa si perde e lo svuota solo col sì', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    const s = await globalThis.SN_STORAGE.getSettings();
    await globalThis.SN_STORAGE.updateSettings({ security: { ...s.security, siteBlock: { ...s.security.siteBlock, blacklist: ['casino.example', 'scommesse.example'] } } });
  });
  const elenco = () => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).security.siteBlock.blacklist);
  const page = await openTab('filo://security/security.html');
  const campo = page.locator('#sec-siteblock-blacklist');
  await expect(campo).toBeAttached({ timeout: 10_000 });
  await campo.click({ button: 'right', force: true });
  await menuDi(page).voce('Rimetti di serie').first().click();
  const testo = await confirmText(page);
  expect(testo).toContain('casino.example');
  expect(testo).toContain('scommesse.example');
  await clickConfirm(page, 'cancel');
  expect(await elenco()).toEqual(['casino.example', 'scommesse.example']);
  await campo.click({ button: 'right', force: true });
  await menuDi(page).voce('Rimetti di serie').first().click();
  await clickConfirm(page, 'ok');
  await expect.poll(elenco).toEqual([]);
});

test('Editor: il tasto destro su un documento dell’elenco è di quel documento: Duplica, Rinomina, Elimina', async ({ openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  // Due documenti: «primo» e quello aperto, «secondo».
  await page.click('#docSwitch');
  await page.locator('.ed-doc-item').first().locator('.ed-doc-rename').click();
  await page.locator('.ed-doc-item-input').fill('primo');
  await page.locator('.ed-doc-item-input').press('Enter');
  await page.click('#docSwitch');
  await page.click('#docSwitch');
  await page.locator('#docNew').click();
  await page.click('#docSwitch');
  await page.locator('.ed-doc-item.active .ed-doc-rename').click();
  await page.locator('.ed-doc-item-input').fill('secondo');
  await page.locator('.ed-doc-item-input').press('Enter');
  await expect(page.locator('#docTitle')).toHaveText('secondo');
  if (await page.locator('#docPop').isHidden()) await page.click('#docSwitch');

  const primo = page.locator('.ed-doc-item', { hasText: 'primo' });
  await primo.click({ button: 'right' });
  const menu = page.locator('.ed-title-ctxmenu .sn-select-option');
  await expect(menu).toHaveText(['Apri', 'Rinomina', 'Duplica', 'Elimina']);
  await page.screenshot({ path: 'tests/.shots/2096-editor-menu-documento.png' });
  await menu.filter({ hasText: 'Duplica' }).click();
  // La copia è di «primo», non del documento aperto.
  if (await page.locator('#docPop').isHidden()) await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item', { hasText: 'primo (copia)' })).toHaveCount(1);
  await expect(page.locator('.ed-doc-item', { hasText: 'secondo (copia)' })).toHaveCount(0);

  await page.locator('.ed-doc-item', { hasText: 'primo (copia)' }).click({ button: 'right' });
  await page.locator('.ed-title-ctxmenu .sn-select-option', { hasText: 'Rinomina' }).click();
  await page.locator('.ed-doc-item-input').fill('terzo');
  await page.locator('.ed-doc-item-input').press('Enter');
  if (await page.locator('#docPop').isHidden()) await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item', { hasText: 'terzo' })).toHaveCount(1);

  // Sul titolo del documento aperto resta il menu di sempre.
  await page.keyboard.press('Escape');
  await page.locator('#docSwitch').click({ button: 'right' });
  await expect(page.locator('.ed-title-ctxmenu .sn-select-option').first()).toHaveText('Rigenera titolo');
});
