// #1039 — Un aggiornamento scaricato si annuncia con un avviso discreto e «Riavvia e aggiorna»; il pulsante, la chat
// («aggiornati») e la scelta delle Preferenze arrivano all'installazione vera. L'updater è finto (perProva): lancio
// dell'installatore e chiusura di Filo si registrano invece di succedere. Le foto, chiare e scure, vanno in tests/.shots/.

import { test, expect } from './fixtures/electron.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello } from './helpers/chatFinta.mjs';
import { clickConfirm, confirmText } from './helpers/confirm.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'tests', '.shots');

// L'installatore che electron-updater lascerebbe nella sua cache, con la sua impronta.
function cacheFinta() {
  const dati = cartellaTemporanea('filo-agg-spec-');
  const cache = join(dati, 'cache', 'pending');
  mkdirSync(cache, { recursive: true });
  const file = join(cache, 'Filo-Setup.exe');
  const contenuto = 'MZ installatore finto di Filo 0.2.234';
  writeFileSync(file, contenuto);
  const sha512 = createHash('sha512').update(contenuto).digest('base64');
  writeFileSync(join(cache, 'update-info.json'), JSON.stringify({ fileName: 'Filo-Setup.exe', sha512, isAdminRightsRequired: false }));
  return { dati, file };
}

async function updaterFinto(app, { piattaforma = 'win32', cartella }) {
  await app.evaluate((_e, a) => { globalThis.__prova = globalThis.__filoUpdater.perProva(a); }, { piattaforma, versione: '0.2.233', cartella });
}
const scaricato = (app, file) => app.evaluate((_e, f) => {
  globalThis.__prova.finto.emit('update-downloaded', { version: '0.2.234', downloadedFile: f });
}, file);
const registro = (app) => app.evaluate(() => JSON.parse(JSON.stringify(globalThis.__prova.registro)));
const temaScuro = (app) => app.evaluate(() => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'IMPOSTA_PREFERENZA', chiave: 'tema', valore: 'scuro' }, { sender: null }));
const ricordo = (dati) => {
  const f = join(dati, 'aggiornamento-pronto.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
};

test('scaricato l\'aggiornamento compare «Riavvia e aggiorna»: il clic lancia l\'installatore visibile e chiude Filo', async ({ app, avvisi, shell }) => {
  const { dati, file } = cacheFinta();
  await updaterFinto(app, { cartella: dati });
  await scaricato(app, file);

  const vista = await avvisi();
  const carta = vista.locator('.shell-notif.show', { hasText: '0.2.234' });
  await expect(carta).toBeVisible({ timeout: 10_000 });
  await expect(carta.locator('.shell-notif-msg')).toContainText('si installa la prossima volta che apri Filo');
  const pulsante = carta.locator('.shell-notif-action', { hasText: 'Riavvia e aggiorna' });
  await expect(pulsante).toBeEnabled();
  mkdirSync(SHOTS, { recursive: true });
  await vista.screenshot({ path: join(SHOTS, 'aggiornamento-avviso.png') });
  const sfondo = () => vista.evaluate(() => getComputedStyle(document.querySelector('.shell-notif')).backgroundColor);
  const chiaro = await sfondo();
  await shell.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(sfondo).not.toBe(chiaro);
  await vista.screenshot({ path: join(SHOTS, 'aggiornamento-avviso-scuro.png') });

  await pulsante.click();
  await expect.poll(async () => (await registro(app)).lanciati.length).toBe(1);
  const r = await registro(app);
  expect(r.lanciati[0]).toEqual({ cmd: file, argv: ['--updated', '--force-run'] });
  expect(r.chiusure).toBe(1);
  expect(ricordo(dati).tentativi).toBe(1);
});

test('se l\'installatore non parte Filo resta aperto, e l\'avviso lo dice', async ({ app, avvisi }) => {
  const { dati, file } = cacheFinta();
  await updaterFinto(app, { cartella: dati });
  await app.evaluate(() => { globalThis.__prova.registro.lanciaFallisce = true; });
  await scaricato(app, file);
  const vista = await avvisi();
  await vista.locator('.shell-notif-action', { hasText: 'Riavvia e aggiorna' }).click({ timeout: 10_000 });
  await expect(vista.locator('.shell-notif.show .shell-notif-msg', { hasText: 'Non sono riuscito ad avviare l\'installazione' })).toBeVisible({ timeout: 10_000 });
  const r = await registro(app);
  expect(r.chiusure).toBe(0);
  expect(ricordo(dati).tentativi).toBe(0);
});

test('su Mac nessun «Riavvia e aggiorna»: l\'installazione lì non riesce', async ({ app, shell }) => {
  const { dati, file } = cacheFinta();
  await updaterFinto(app, { piattaforma: 'darwin', cartella: dati });
  await scaricato(app, file);
  expect((await registro(app)).avvisi).toEqual([]);
  // Un avviso di controllo dopo: se quello dell'aggiornamento fosse partito, sarebbe già nella pila.
  await shell.evaluate(() => window.filoNotify('controllo'));
  await expect(shell.locator('.shell-notif', { hasText: 'controllo' })).toHaveCount(1);
  await expect(shell.locator('.shell-notif', { hasText: '0.2.234' })).toHaveCount(0);
});

test('«aggiornati» in chat con una versione pronta: Filo chiede conferma e riavvia per installarla', async ({ app }) => {
  const { dati, file } = cacheFinta();
  await updaterFinto(app, { cartella: dati });
  await scaricato(app, file);
  const page = await home(app);
  await modelloFinto(app, [
    // `_riavvio` scritto dal modello non salta la conferma: lo ricalcola il main.
    { toolCalls: [{ id: 'a1', name: 'INSTALLA_AGGIORNAMENTO', arguments: JSON.stringify({ _riavvio: false }) }] },
    { text: 'Riavvio Filo per l\'aggiornamento.' },
  ]);
  await chiedi(page, 'aggiornati');
  await expect.poll(() => confirmText(page)).toContain('Riavviare Filo per installare la versione 0.2.234');
  expect((await registro(app)).lanciati).toEqual([]);
  await clickConfirm(page, 'ok');
  await expect.poll(async () => (await registro(app)).chiusure).toBe(1);
  expect((await registro(app)).lanciati[0].argv).toEqual(['--updated', '--force-run']);
});

test('«aggiornati» in chat senza niente di pronto: Filo controlla e risponde con la versione vera', async ({ app }) => {
  const { dati } = cacheFinta();
  await updaterFinto(app, { cartella: dati });
  await app.evaluate(() => { globalThis.__prova.registro.risposta = { evento: 'update-not-available', dati: {} }; });
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'a2', name: 'INSTALLA_AGGIORNAMENTO', arguments: '{}' }] },
    { text: 'Hai già l\'ultima versione.' },
  ]);
  await chiedi(page, 'c\'è una versione nuova di Filo?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Hai già l\'ultima versione' })).toBeVisible({ timeout: 10_000 });
  const r = await registro(app);
  expect(r.controlli).toBe(1);
  expect(r.chiusure).toBe(0);
  const esito = JSON.stringify((await chiamateAlModello(app)).at(-1));
  expect(esito).toContain('Filo è aggiornato: la 0.2.233 è l\'ultima versione');
});

test('Preferenze, avanzate: la scelta «in silenzio alla chiusura» arriva all\'installazione, e si torna indietro', async ({ app, openTab }) => {
  const { dati } = cacheFinta();
  await updaterFinto(app, { cartella: dati });
  const chiusura = () => app.evaluate(() => globalThis.__prova.finto.autoInstallOnAppQuit);
  expect(await chiusura()).toBe(false);

  const pref = await openTab('filo://preferences/preferences.html');
  const sezione = pref.locator('#sec-aggiornamenti');
  // Fuori da Windows la scelta non vale niente e non si mostra; qui il sistema vero è Linux.
  await expect(pref.locator('#aggiornamentiQuando')).toBeHidden();
  await pref.evaluate(() => { document.getElementById('aggiornamentiQuando').hidden = false; });
  await expect(pref.locator('#aggiornamentiInstalla')).toHaveValue('avvio');
  await pref.locator('#aggiornamentiInstalla').selectOption('chiusura');
  await expect.poll(chiusura).toBe(true);
  expect(await app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).aggiornamenti.installa)).toBe('chiusura');
  mkdirSync(SHOTS, { recursive: true });
  await sezione.scrollIntoViewIfNeeded();
  await sezione.screenshot({ path: join(SHOTS, 'aggiornamento-preferenze.png') });

  // La stessa scelta a parole, dalla chat.
  const r = await app.evaluate((_e) => globalThis.SN_EXECUTE_FILO_ACTION(
    { type: 'IMPOSTA_PREFERENZA', chiave: 'installazione aggiornamenti', valore: 'all\'apertura' },
    { sender: null },
  ));
  expect(r.executed).toBe(true);
  await expect.poll(chiusura).toBe(false);
  await expect(pref.locator('#aggiornamentiInstalla')).toHaveValue('avvio');
});

test('l\'avviso di un aggiornamento fallito ha «Scarica Filo», che apre la pagina per scaricarlo', async ({ app }) => {
  await app.evaluate(() => globalThis.__filoUpdater.avvisaInstallazioneFallita('0.2.234'));
  const page = await home(app);
  await page.reload();
  const carta = page.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: '0.2.234' });
  await expect(carta).toBeVisible({ timeout: 10_000 });
  await expect(carta.locator('.dash-carta-stato')).toContainText('filo.red');
  await expect(carta.locator('.dash-carta-az.secondaria')).toHaveText('Chiudi');
  mkdirSync(SHOTS, { recursive: true });
  await carta.screenshot({ path: join(SHOTS, 'aggiornamento-carta.png') });
  await temaScuro(app);
  await page.waitForTimeout(300);
  await carta.screenshot({ path: join(SHOTS, 'aggiornamento-carta-scuro.png') });
  await carta.locator('.dash-carta-az.principale', { hasText: 'Scarica Filo' }).click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return tm.tabs.some((t) => /filo\.red/.test(String(t.url || '')));
  })).toBe(true);
});

test('passato l\'avviso a tempo, «Riavvia e aggiorna» resta nella home, e lancia l\'installatore', async ({ app, avvisi }) => {
  const { dati, file } = cacheFinta();
  await updaterFinto(app, { cartella: dati });
  const page = await home(app);
  await scaricato(app, file);
  const vista = await avvisi();
  const toast = vista.locator('.shell-notif.show', { hasText: '0.2.234' });
  await expect(toast).toBeVisible({ timeout: 10_000 });
  await expect(toast).toHaveCount(0, { timeout: 20_000 });

  // Senza ricaricare: la home aperta la riceve da sola.
  const carta = page.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: '0.2.234' });
  await expect(carta).toBeVisible({ timeout: 10_000 });
  mkdirSync(SHOTS, { recursive: true });
  await carta.screenshot({ path: join(SHOTS, 'aggiornamento-carta-pronto.png') });
  await carta.locator('.dash-carta-az.principale', { hasText: 'Riavvia e aggiorna' }).click();
  await expect.poll(async () => (await registro(app)).lanciati.length).toBe(1);
  expect((await registro(app)).chiusure).toBe(1);
});

test('su Linux la conferma di «aggiornati» non promette la barra di avanzamento', async ({ app }) => {
  const { dati, file } = cacheFinta();
  const appImage = join(cartellaTemporanea('filo-agg-appimage-'), 'Filo-Linux.AppImage');
  writeFileSync(appImage, 'appimage');
  await app.evaluate((_e, a) => { globalThis.__prova = globalThis.__filoUpdater.perProva(a); },
    { piattaforma: 'linux', versione: '0.2.233', cartella: dati, appImage });
  await scaricato(app, file);
  const page = await home(app);
  await modelloFinto(app, [
    { toolCalls: [{ id: 'a3', name: 'INSTALLA_AGGIORNAMENTO', arguments: '{}' }] },
    { text: 'Riavvio Filo.' },
  ]);
  await chiedi(page, 'aggiornati');
  await expect.poll(() => confirmText(page)).toContain('Riavviare Filo per installare la versione 0.2.234');
  expect(await confirmText(page)).not.toContain('barra');
});

// La carta resta per giorni: la sua frase segue i tentativi falliti e la scelta in Preferenze.
test('dopo due installazioni fallite la carta della home non promette più l\'installazione all\'apertura', async ({ app }) => {
  const { dati, file } = cacheFinta();
  await updaterFinto(app, { cartella: dati });
  const page = await home(app);
  await scaricato(app, file);
  const carta = page.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: 'Riavvia e aggiorna' });
  await expect(carta).toContainText('la prossima volta che apri Filo', { timeout: 10_000 });
  // Quattro aperture con la versione vecchia ancora in uso: due tentativi, due fallimenti.
  for (let i = 0; i < 4; i++) {
    await updaterFinto(app, { cartella: dati });
    await app.evaluate(() => globalThis.__filoUpdater.installaAllAvvioSeServe({}, { forza: true }));
  }
  await page.reload();
  await expect(page.locator('#accade .dash-carta', { hasText: 'per due volte' })).toBeVisible({ timeout: 10_000 });
  await expect(carta).toContainText('Filo 0.2.234 è pronto da installare.');
  await expect(carta).not.toContainText('la prossima volta che apri Filo');
});

test('scelta «in silenzio alla chiusura» dopo lo scaricamento: la carta della home lo dice, e torna indietro', async ({ app }) => {
  const { dati, file } = cacheFinta();
  await updaterFinto(app, { cartella: dati });
  const page = await home(app);
  await scaricato(app, file);
  const carta = page.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: 'Riavvia e aggiorna' });
  await expect(carta).toContainText('la prossima volta che apri Filo', { timeout: 10_000 });
  const scegli = (valore) => app.evaluate((_e, v) => globalThis.SN_EXECUTE_FILO_ACTION(
    { type: 'IMPOSTA_PREFERENZA', chiave: 'installazione aggiornamenti', valore: v }, { sender: null }), valore);
  await scegli('in silenzio');
  await expect(carta).toContainText('si installa quando chiudi Filo', { timeout: 10_000 });
  await expect(carta).not.toContainText('la prossima volta che apri Filo');
  await scegli('all\'apertura');
  await expect(carta).toContainText('la prossima volta che apri Filo', { timeout: 10_000 });
});
