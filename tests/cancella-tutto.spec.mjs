// «Cancella tutti i dati di Filo» (#850): dalla pagina Sicurezza, con la parola scritta, Filo si chiude e si riapre
// come appena installato. Ogni prova guarda le pagine dove l'utente vede i suoi dati e i file della cartella dei dati.
// Senza il tasto e la cancellazione all'avvio è rossa: memoria, chat, editor, salvati e archivio tornavano tutti.

import { test, expect, chiudiApp, argomentiScala } from './fixtures/electron.mjs';
import { _electron as electron } from '@playwright/test';
import { cartellaTemporanea, togliCartella } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(APP_ROOT, 'tests', '.shots');
const SEGRETO = 'Taccuino segreto ZQX';

async function avvia(userData) {
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', NODE_ENV: 'test' },
  });
  const shell = await primaFinestra(app);
  await shell.waitForLoadState('domcontentloaded');
  return { app, shell };
}

async function pagina(app, shell, url) {
  const host = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  await expect.poll(() => app.windows().some((w) => { try { return new URL(w.url()).hostname === host; } catch (_) { return false; } }),
    { timeout: 15_000 }).toBe(true);
  const page = app.windows().find((w) => new URL(w.url()).hostname === host);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

// Le chiavi di storage.json quando l'avvio si è posato: quelle di un Filo appena installato sono il metro.
async function chiaviPosate(app, userData) {
  await app.evaluate(() => globalThis.__filoStorage.whenSettled());
  await app.evaluate(() => globalThis.__filoStorage.flushNow());
  const f = join(userData, 'storage.json');
  return existsSync(f) ? Object.keys(JSON.parse(readFileSync(f, 'utf8'))).sort() : [];
}

function fileSotto(dir) {
  const out = [];
  // I segni di Chromium (SingletonCookie…) sono collegamenti che non puntano a un file: si saltano.
  const giro = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      const st = lstatSync(p);
      if (st.isDirectory()) giro(p);
      else if (st.isFile()) out.push(p);
    }
  };
  giro(dir);
  return out;
}
const contengono = (dir, ago) => fileSotto(dir).filter((f) => { try { return readFileSync(f, 'latin1').includes(ago); } catch (_) { return false; } });

async function semina(app, shell) {
  await app.evaluate(async ({ session }, segreto) => {
    await globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: `Si chiama Marta, ${segreto}` });
    await globalThis.SN_FILO_CHATS.append('chat-da-cancellare', { role: 'user', text: `Parliamo di ${segreto}` });
    await globalThis.SN_FILO_CHATS.append('chat-da-cancellare', { role: 'assistant', text: 'Volentieri.' });
    await globalThis.SN_SAVED_PAGES.save({ url: 'https://salvata.test/articolo', title: `Articolo ${segreto}` });
    await globalThis.SN_ARCHIVED_TABS.archive({ url: 'https://archiviata.test/', title: `Scheda ${segreto}` });
    await globalThis.SN_STORAGE.updateSettings({ theme: 'dark', apiKeys: { openrouter: 'sk-or-v1-segreta' } });
    await session.defaultSession.cookies.set({ url: 'https://sito.test/', name: 'sessione', value: 'segreta', expirationDate: Date.now() / 1000 + 86400 });
    await globalThis.SN_IL_FILO.quandoFermo();
  }, SEGRETO);
  const editor = await pagina(app, shell, 'filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.click('#doc');
  await editor.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, SEGRETO);
  await editor.keyboard.press('Control+s');
  await expect(editor.locator('.ed-save-state')).toHaveText('Salvato');
  await expect.poll(() => app.evaluate(async () => JSON.stringify((await chrome.storage.local.get('filo.editor.collection'))['filo.editor.collection'] || '')))
    .toContain('ZQX');
}

// Quello che l'utente vede: dopo la cancellazione nessuna pagina deve mostrare il segreto.
async function nienteInVista(app, shell) {
  const quaderno = await pagina(app, shell, 'filo://quaderno/quaderno.html');
  await expect(quaderno.locator('#vuoto')).toBeVisible({ timeout: 10_000 });
  await expect(quaderno.locator('.qd-riga', { hasText: 'Marta' })).toHaveCount(0);
  // Chat e schede chiuse stanno nel filo: la ricerca della home non le ritrova.
  const casa = await pagina(app, shell, 'filo://newtab/');
  await casa.locator('#cercaInput').fill('ZQX');
  await expect(casa.locator('#cercaRisultati .dash-cerca-niente').first()).toBeVisible({ timeout: 10_000 });
  await expect(casa.locator('#cercaRisultati .dash-cerca-pagina, #cercaRisultati .dash-cerca-msg')).toHaveCount(0);
  const editor = await pagina(app, shell, 'filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.click('#docSwitch');
  await expect(editor.locator('.ed-doc-item').first()).toBeVisible();
  await expect(editor.locator('.ed-doc-item', { hasText: 'ZQX' })).toHaveCount(0);
  await expect(editor.locator('#doc')).not.toContainText('ZQX');
  expect(await editor.evaluate(() => JSON.stringify(localStorage))).not.toContain('ZQX');
  const home = await pagina(app, shell, 'filo://home/home.html');
  await expect(home.locator('#empty')).toBeVisible({ timeout: 10_000 });
  await expect(home.locator('.sn-card', { hasText: 'ZQX' })).toHaveCount(0);
  const dati = await app.evaluate(async ({ session }) => ({
    cookie: (await session.defaultSession.cookies.get({})).length,
    chiave: (await globalThis.SN_STORAGE.getSettings()).apiKeys.openrouter,
    tema: (await globalThis.SN_STORAGE.getSettings()).theme,
    chat: (await globalThis.SN_FILO_CHATS.list()).length,
  }));
  expect(dati).toEqual({ cookie: 0, chiave: '', tema: 'system', chat: 0 });
}

async function apriConferma(app, shell) {
  const page = await pagina(app, shell, 'filo://security/security.html');
  const tasto = page.locator('#sec-wipe-btn');
  await tasto.scrollIntoViewIfNeeded();
  await expect(tasto).toHaveText('Cancella tutti i dati di Filo');
  await expect(page.locator('#sec-wipe-box')).toBeHidden();
  await tasto.click();
  await expect(page.locator('#sec-wipe-box')).toBeVisible();
  return page;
}

async function aspettaUscita(app) {
  const proc = app.process();
  if (proc.exitCode === null) await new Promise((r) => proc.once('exit', r));
}

test('con «conferma» Filo si riapre come appena installato: niente memoria, chat, editor, salvati, archivio né cookie', async () => {
  test.setTimeout(180_000);
  const vergine = cartellaTemporanea('filo-vergine-');
  const userData = cartellaTemporanea('filo-cancella-');
  const zip = join(cartellaTemporanea('filo-cancella-zip-'), 'prima.zip');
  let app = null;
  let shell = null;
  try {
    // Il metro: un Filo appena installato, lasciato posare.
    ({ app, shell } = await avvia(vergine));
    await expect(shell.locator('body')).toBeAttached();
    await new Promise((r) => setTimeout(r, 1500));
    const appenaInstallato = await chiaviPosate(app, vergine);
    await chiudiApp(app);

    ({ app, shell } = await avvia(userData));
    await semina(app, shell);
    // Un'identità dei crediti finta: resta, perché la scelta non è spuntata.
    writeFileSync(join(userData, 'identity.bin'), 'identità finta');
    expect(contengono(userData, 'ZQX').length).toBeGreaterThan(0);

    const page = await apriConferma(app, shell);
    // Prima propone di esportare: l'archivio parte da qui e la pagina dice che c'è.
    await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, zip);
    await page.locator('#sec-wipe-export').click();
    await expect(page.locator('#sec-wipe-export-hint')).toHaveText('Archivio salvato');
    expect(readFileSync(zip).includes(Buffer.from('ZQX'))).toBe(true);
    await expect(page.locator('#sec-wipe-identity-row')).toBeVisible();
    await expect(page.locator('#sec-wipe-identity')).not.toBeChecked();
    const go = page.locator('#sec-wipe-go');
    await expect(go).toBeDisabled();
    await page.locator('#sec-wipe-word').fill('confermo');
    await expect(go).toBeDisabled();
    await page.locator('#sec-wipe-word').fill('  Conferma ');
    await expect(go).toBeEnabled();
    mkdirSync(SHOTS, { recursive: true });
    await page.locator('#sec-wipe-box').screenshot({ path: join(SHOTS, 'cancella-tutto-conferma-scuro.png') });
    await go.click();
    await expect(page.locator('#sec-wipe-hint')).toHaveText('Cancello e riavvio Filo…');
    await aspettaUscita(app);

    ({ app, shell } = await avvia(userData));
    await expect.poll(() => chiaviPosate(app, userData), { timeout: 15_000 }).toEqual(appenaInstallato);
    expect(contengono(userData, 'ZQX')).toEqual([]);
    expect(existsSync(join(userData, 'cancella-tutto.json'))).toBe(false);
    expect(readdirSync(userData).some((n) => n.startsWith('identity.bin'))).toBe(true);
    await nienteInVista(app, shell);
    // E lo dice nella finestra: l'avviso vive nella vista sopra la pagina, col modello nella shell.
    const avvisi = async () => (await Promise.all(app.windows().map((w) => w.evaluate(() => document.body?.textContent || '').catch(() => '')))).join('\n');
    await expect.poll(avvisi, { timeout: 15_000 }).toContain('Ho cancellato tutti i dati di Filo');
  } finally {
    if (app) await chiudiApp(app);
    for (const d of [vergine, userData, dirname(zip)]) togliCartella(d);
  }
});

test('con la scelta spuntata se ne va anche l\'identità dei crediti', async () => {
  test.setTimeout(120_000);
  const userData = cartellaTemporanea('filo-cancella-');
  let app = null;
  let shell = null;
  try {
    ({ app, shell } = await avvia(userData));
    await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Si chiama Marta' }));
    writeFileSync(join(userData, 'identity.bin'), 'identità finta');
    writeFileSync(join(userData, 'wallet.bin'), 'chiave finta');
    const page = await apriConferma(app, shell);
    await expect(page.locator('#sec-wipe-identity-row')).toBeVisible();
    await expect(page.locator('#sec-wipe-identity-desc')).toContainText('non si raggiungono più');
    await page.locator('#sec-wipe-identity').check();
    await page.locator('#sec-wipe-word').fill('conferma');
    await page.locator('#sec-wipe-word').press('Enter');
    await aspettaUscita(app);
    ({ app, shell } = await avvia(userData));
    await app.evaluate(() => globalThis.__filoStorage.whenSettled());
    expect(readdirSync(userData).filter((n) => n.startsWith('identity.bin') || n.startsWith('wallet'))).toEqual([]);
    expect(await app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.getMemory()).PROFILO || '')).toBe('');
  } finally {
    if (app) await chiudiApp(app);
    togliCartella(userData);
  }
});

test('Annulla ed Esc non cambiano niente, e senza identità la scelta non compare', async ({ app, shell }) => {
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Si chiama Marta' }));
  const page = await apriConferma(app, shell);
  await expect(page.locator('#sec-wipe-btn')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#sec-wipe-identity-row')).toBeHidden();
  await expect(page.locator('#sec-wipe-list')).toContainText('cookie e dati dei siti');
  await expect(page.locator('#sec-wipe-server')).toContainText('restano sul server');
  mkdirSync(SHOTS, { recursive: true });
  await page.locator('#sec-wipe-box').screenshot({ path: join(SHOTS, 'cancella-tutto-conferma-chiaro.png') });
  await page.locator('#sec-wipe-word').fill('conferma');
  await page.locator('#sec-wipe-cancel').click();
  await expect(page.locator('#sec-wipe-box')).toBeHidden();
  await expect(page.locator('#sec-wipe-btn')).toBeFocused();
  // Riaperta, riparte da capo: niente parola già scritta.
  await page.locator('#sec-wipe-btn').click();
  await expect(page.locator('#sec-wipe-word')).toHaveValue('');
  await expect(page.locator('#sec-wipe-go')).toBeDisabled();
  await page.locator('#sec-wipe-word').fill('conferma');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sec-wipe-box')).toBeHidden();
  // Un doppio clic sul tasto la apre e la lascia aperta, invece di richiuderla al secondo clic.
  await page.locator('#sec-wipe-btn').dblclick();
  await expect(page.locator('#sec-wipe-box')).toBeVisible();
  await expect(page.locator('#sec-wipe-word')).toHaveValue('');
  await page.locator('#sec-wipe-cancel').click();
  await new Promise((r) => setTimeout(r, 800));
  expect(app.process().exitCode).toBe(null);
  expect(existsSync(join(userData, 'cancella-tutto.json'))).toBe(false);
  expect(await app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.getMemory()).PROFILO)).toBe('Si chiama Marta');
});

test('il main non cancella senza la parola, né per un\'altra pagina di Filo, né per un sito', async ({ app, shell }) => {
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  const page = await pagina(app, shell, 'filo://security/security.html');
  const daPagina = (msg) => page.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  const tipo = await page.evaluate(() => window.SN_MSG.MSG.CANCELLA_TUTTI_I_DATI);
  expect(await daPagina({ type: tipo })).toMatchObject({ ok: false, error: 'parola' });
  expect(await daPagina({ type: tipo, parola: 'confermo', ancheIdentita: true })).toMatchObject({ ok: false, error: 'parola' });
  const da = (url) => app.evaluate((_e, [t, u]) => globalThis.SN_HANDLE_MESSAGE({ type: t, parola: 'conferma' }, { url: u }), [tipo, url]);
  expect(await da('https://evil.example/page')).toMatchObject({ ok: false, error: 'forbidden' });
  expect(await da('filo://newtab/')).toMatchObject({ ok: false, error: 'forbidden' });
  expect(await da('filo://preferences/preferences.html')).toMatchObject({ ok: false, error: 'forbidden' });
  await new Promise((r) => setTimeout(r, 800));
  expect(app.process().exitCode).toBe(null);
  expect(existsSync(join(userData, 'cancella-tutto.json'))).toBe(false);
});

test('chiesto in chat, Filo apre la pagina sul tasto e non cancella', async ({ app, shell }) => {
  const userData = await app.evaluate(() => process.env.FILO_USER_DATA);
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Si chiama Marta' }));
  const home = await pagina(app, shell, 'filo://newtab/');
  // L'azione che il prompt della chat fa emettere per «cancella tutti i miei dati».
  const r = await home.evaluate(() => chrome.runtime.sendMessage({
    type: window.SN_MSG.MSG.FILO_RUN_ACTION,
    action: { type: 'NAVIGA', url: 'filo://security/security.html#cancella-tutto', etichetta: 'Cancella tutti i dati di Filo' },
  }));
  expect(r.ok).toBe(true);
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('filo://security/'))).toBe(true);
  const page = app.windows().find((w) => w.url().startsWith('filo://security/'));
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('#sec-wipe-btn')).toBeFocused();
  await expect(page.locator('#sec-wipe-btn')).toBeInViewport();
  await expect(page.locator('#sec-wipe-box')).toBeHidden();
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, 'cancella-tutto-dalla-chat.png') });
  expect(existsSync(join(userData, 'cancella-tutto.json'))).toBe(false);
  expect(await app.evaluate(async () => (await globalThis.SN_FILO_MEMORY.getMemory()).PROFILO)).toBe('Si chiama Marta');
});
