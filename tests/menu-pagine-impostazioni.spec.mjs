// #2096 — il tasto destro nelle altre pagine di Filo: una voce delle impostazioni offre «Rimetti di serie», «Spiega cosa
// fa» e «Chiedi a Filo» (Preferenze e Modelli, dallo stesso fornitore); una voce dell'elenco documenti dell'Editor apre il
// menu di QUEL documento, non di quello aperto.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { clickConfirm, confirmText } from './helpers/confirm.mjs';

// Le voci del menu già aperto: evaluateAll non aspetta, e prima che si apra darebbe un elenco vuoto (#2443).
const etichette = async (page) => {
  await expect(menuDi(page).principale).toBeVisible({ timeout: 8_000 });
  return menuDi(page).voci.evaluateAll((vs) => vs.map((v) => v.textContent.trim()));
};
// Qui si prova la voce, a impostazioni lette: il clic dato prima, che si rigioca, ha le sue prove più sotto (#2444).
const pronta = (page) => page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10_000 });

test('Preferenze: «Rimetti di serie» rimette il valore, e la voce si spiega o si chiede all’Aiuto', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ tabPreview: { enabled: false } }));
  const page = await openTab('filo://preferences/preferences.html');
  const casella = page.locator('#tabPreviewEnabled');
  await pronta(page);
  await expect(casella).not.toBeChecked({ timeout: 10_000 });

  await page.locator('label', { has: casella }).click({ button: 'right' });
  const voci = await etichette(page);
  for (const v of ['Rimetti di serie', 'Spiega cosa fa']) expect(voci).toContain(v);
  // Spiega e Chiedi sono lo stesso verbo (#2555): «Chiedi a Filo» sta nel menu dell'icona.
  expect(await variantiDiChiedi(page)).toContain('Chiedi a Filo');
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

// Una tendina dentro la sua etichetta: il nome è l'etichetta, non l'etichetta più le scelte dell'elenco disegnato accanto.
for (const { id, nome } of [{ id: 'contestoCache', nome: 'Durata della cache' }, { id: 'traduzioneNascoste', nome: 'Sezioni chiuse' }]) {
  test(`Preferenze: «Chiedi a Filo» sulla tendina ${id} la chiama «${nome}»`, async ({ openTab }) => {
    test.setTimeout(90_000);
    const page = await openTab('filo://preferences/preferences.html');
    await expect(page.locator(`#${id}`)).toBeAttached({ timeout: 10_000 });
    const tendina = page.locator(`#${id}`).locator('xpath=..').locator('.sn-select-button').first();
    await tendina.scrollIntoViewIfNeeded();
    await tendina.click({ button: 'right' });
    await menuDi(page).voce('Chiedi a Filo').first().click();
    const campo = page.locator('.sn-sidebar-input textarea');
    await expect(campo).toBeVisible({ timeout: 8_000 });
    await expect(campo).toHaveValue(`Sull'impostazione «${nome}»: `);
  });
}

// Ogni voce delle quattro pagine prende un nome dalla pagina: mai il nome interno, mai l'elenco delle scelte.
for (const url of ['filo://preferences/preferences.html', 'filo://options/options.html', 'filo://options/altro.html', 'filo://security/security.html']) {
  test(`i nomi delle voci in ${url.split('/').pop()}`, async ({ openTab }) => {
    test.setTimeout(60_000);
    const page = await openTab(url);
    await expect.poll(() => page.evaluate(() => !!(window.SN_MENU_IMPOSTAZIONI && window.SN_SIDEBAR))).toBe(true);
    // L'elenco disegnato accanto a ogni tendina c'è solo a pagina pronta: è lui che finiva nel nome.
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('select:not([multiple]):not([data-sn-no-enhance])')].every((s) => s.dataset.snEnhanced || s.size > 1))).toBe(true);
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
          // Le scelte come le scrive l'elenco disegnato da Filo, senza la stima fra parentesi.
          const scelte = el.tagName === 'SELECT' ? [...el.options].map((o) => o.textContent.split(' (')[0].trim()).filter((t) => t.length > 2) : [];
          out.push({ id, percorso, scelte, nome: String(preso || '').replace(/^Sull'impostazione «|»:$/g, '') });
        }
      } finally { S.chiediDaPagina = orig; }
      return out;
    });
    expect(nomi.length).toBeGreaterThan(0);
    const strani = nomi.filter((n) => !n.nome || n.nome === n.id || n.nome === n.percorso || n.nome.length > 141 || /▾/.test(n.nome)
      || /\s\S{1,3}…$/.test(n.nome)
      || n.scelte.some((s) => s !== n.nome && n.nome.includes(s)));
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
  await pronta(page);
  await page.locator('label', { has: casella }).first().click({ button: 'right' });
  expect(await etichette(page)).toContain('Rimetti di serie');
});

// #2444 — il menu di Filo sulle pagine interne ascolta solo a impostazioni lette. Il test le trattiene finché vuole: il
// tasto destro cade per forza prima che il menu ascolti, come su una macchina lenta.
const trattieniImpostazioni = (app) => app.evaluate(() => {
  const S = globalThis.SN_STORAGE;
  const vera = S.getSettings;
  let apri;
  const cancello = new Promise((r) => { apri = r; });
  // Solo la lettura chiesta dalle pagine: la scheda si apre lo stesso.
  S.getSettings = function (...a) {
    if (/handlers[\\/]storage\.js/.test(new Error().stack || '')) return cancello.then(() => vera.apply(S, a));
    return vera.apply(S, a);
  };
  globalThis.__apriImpostazioni = () => { S.getSettings = vera; apri(); };
});
const apriImpostazioni = (app) => app.evaluate(() => globalThis.__apriImpostazioni());
const menuInAscolto = (page) => page.evaluate(() => document.documentElement.dataset.filoContentReady === '1');

for (const { nome, url, casella } of [
  { nome: 'Preferenze', url: 'filo://preferences/preferences.html', casella: '#tabPreviewEnabled' },
  { nome: 'Modelli', url: 'filo://options/options.html', casella: '#useDefaultModels' },
]) {
  test(`${nome}: il tasto destro dato appena aperta la pagina apre il menu quando Filo è pronto`, async ({ app, openTab }) => {
    test.setTimeout(60_000);
    await trattieniImpostazioni(app);
    const page = await openTab(url);
    const etichetta = page.locator('label', { has: page.locator(casella) }).first();
    await expect(etichetta).toBeVisible({ timeout: 10_000 });
    expect(await menuInAscolto(page)).toBe(false);
    await etichetta.click({ button: 'right' });
    await apriImpostazioni(app);
    expect(await etichette(page)).toContain('Rimetti di serie');
  });
}

test('Preferenze: un tasto destro dato prima non si rigioca se la pagina l’ha preso, o se è troppo vecchio', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await trattieniImpostazioni(app);
  const preso = await openTab('filo://preferences/preferences.html');
  const etichetta = preso.locator('label', { has: preso.locator('#tabPreviewEnabled') });
  await expect(etichetta).toBeVisible({ timeout: 10_000 });
  // Una voce col menu suo, come l'elenco documenti dell'Editor.
  await etichetta.evaluate((el) => el.addEventListener('contextmenu', (e) => { e.preventDefault(); el.dataset.menuSuo = '1'; }));
  await etichetta.click({ button: 'right' });
  await expect(etichetta).toHaveAttribute('data-menu-suo', '1');

  const vecchio = await openTab('filo://options/options.html');
  const altra = vecchio.locator('label', { has: vecchio.locator('#useDefaultModels') }).first();
  await expect(altra).toBeVisible({ timeout: 10_000 });
  await altra.click({ button: 'right' });
  // Oltre il tempo del rigioco l'utente il menu non lo aspetta più.
  await vecchio.waitForTimeout(3_500);
  expect(await menuInAscolto(vecchio)).toBe(false);

  await apriImpostazioni(app);
  for (const page of [preso, vecchio]) {
    await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 10_000 });
  }
  // Il menu, se partisse, si aprirebbe subito dopo le impostazioni: si lascia il tempo di farlo.
  await vecchio.waitForTimeout(1_000);
  await expect(menuDi(preso).principale).toHaveCount(0);
  await expect(menuDi(vecchio).principale).toHaveCount(0);
  // Il menu torna ad ascoltare come sempre.
  await altra.click({ button: 'right' });
  expect(await etichette(vecchio)).toContain('Rimetti di serie');
});

// #2444.1 — dopo il tasto destro l'utente è passato ad altro: il menu non deve comparire più tardi sulla voce di prima.
for (const { nome, poi } of [
  { nome: 'un clic sinistro altrove', poi: (page) => page.mouse.click(5, 300) },
  { nome: 'Esc', poi: (page) => page.keyboard.press('Escape') },
]) {
  test(`Preferenze: tasto destro e poi ${nome} prima che Filo sia pronto: il menu non compare dopo`, async ({ app, openTab }) => {
    test.setTimeout(60_000);
    await trattieniImpostazioni(app);
    const page = await openTab('filo://preferences/preferences.html');
    const etichetta = page.locator('label', { has: page.locator('#tabPreviewEnabled') });
    await expect(etichetta).toBeVisible({ timeout: 10_000 });
    await etichetta.click({ button: 'right' });
    await poi(page);
    expect(await menuInAscolto(page)).toBe(false);
    await apriImpostazioni(app);
    await pronta(page);
    await page.waitForTimeout(1_000);
    await expect(menuDi(page).principale).toHaveCount(0);
    await etichetta.click({ button: 'right' });
    expect(await etichette(page)).toContain('Rimetti di serie');
  });
}

test('Preferenze: se la voce cliccata viene ridisegnata mentre Filo si prepara, il menu si apre su quella sotto il cursore', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await trattieniImpostazioni(app);
  const page = await openTab('filo://preferences/preferences.html');
  const etichetta = page.locator('label', { has: page.locator('#tabPreviewEnabled') });
  await expect(etichetta).toBeVisible({ timeout: 10_000 });
  await etichetta.click({ button: 'right' });
  // Come le pagine che costruiscono gli elenchi dopo aver letto le impostazioni: al posto della voce cliccata ora c'è
  // un'altra voce, ed è di quella che il menu deve parlare.
  await etichetta.evaluate((el) => el.replaceWith(document.getElementById('autoArchiveEnabled').closest('label')));
  await apriImpostazioni(app);
  expect(await etichette(page)).toContain('Chiedi a Filo');
  await menuDi(page).voce('Chiedi a Filo').first().click();
  const campo = page.locator('.sn-sidebar-input textarea');
  await expect(campo).toBeVisible({ timeout: 8_000 });
  await expect(campo).toHaveValue(/^Sull'impostazione «.*riordino.*»: $/i);
});

// Una chiave non entra nel registro dei cambi: tolta, nessun Annulla la riporta. Si chiama per quello che fa, e chiede.
test('Modelli: sulla chiave OpenRouter la voce è «Togli la chiave», chiede conferma, e il no la lascia', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: 'sk-or-v1-chiave-mia' } }));
  const page = await openTab('filo://options/options.html');
  const campo = page.locator('#apiKey');
  await expect(campo).toBeVisible({ timeout: 10_000 });
  const chiave = () => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).apiKeys.openrouter);
  await pronta(page);
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
  // A icone (#2555): i nomi delle icone, nello stesso ordine.
  const menu = menuDi(page);
  const icone = menu.locator('.sn-menu:not(.sn-menu-sub) .sn-menu-griglia .sn-menu-row-btn:not(.sn-menu-row-overflow)');
  await expect.poll(() => icone.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['Apri', 'Rinomina', 'Duplica', 'Elimina']);
  await page.screenshot({ path: 'tests/.shots/2096-editor-menu-documento.png' });
  await menu.scegli('Duplica');
  // La copia è di «primo», non del documento aperto.
  if (await page.locator('#docPop').isHidden()) await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item', { hasText: 'primo (copia)' })).toHaveCount(1);
  await expect(page.locator('.ed-doc-item', { hasText: 'secondo (copia)' })).toHaveCount(0);

  await page.locator('.ed-doc-item', { hasText: 'primo (copia)' }).click({ button: 'right' });
  await menu.scegli('Rinomina');
  await page.locator('.ed-doc-item-input').fill('terzo');
  await page.locator('.ed-doc-item-input').press('Enter');
  if (await page.locator('#docPop').isHidden()) await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item', { hasText: 'terzo' })).toHaveCount(1);

  // Sul titolo del documento aperto resta il menu di sempre.
  await page.keyboard.press('Escape');
  await page.locator('#docSwitch').click({ button: 'right' });
  await expect(menu.primaVoce).toHaveAttribute('aria-label', 'Rigenera titolo');
});
