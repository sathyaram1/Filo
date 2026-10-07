// #1039 giro 6 (riallineamento con #786): su Windows, con «Installa gli aggiornamenti da solo» spento, «Installa»
// e «aggiornati» portano alla versione pronta e all'installazione all'apertura; una versione non chiesta non parte.
// Prova senza rilievo: le porte del riallineamento, ri-provate e chiuse.

import { test, expect } from '../../fixtures/electron.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { home, modelloFinto, chiedi } from '../../helpers/chatFinta.mjs';

function cacheFinta() {
  const dati = cartellaTemporanea('filo-agg-g6-');
  const cache = join(dati, 'cache', 'pending');
  mkdirSync(cache, { recursive: true });
  const file = join(cache, 'Filo-Setup.exe');
  const contenuto = 'MZ installatore finto di Filo 0.2.234';
  writeFileSync(file, contenuto);
  const sha512 = createHash('sha512').update(contenuto).digest('base64');
  writeFileSync(join(cache, 'update-info.json'), JSON.stringify({ fileName: 'Filo-Setup.exe', sha512, isAdminRightsRequired: false }));
  return { dati, file };
}

// L'aggiornatore finto di perProva, su Windows e con l'installazione automatica spenta come la lascia l'utente.
async function spentaSuWindows(app, dati) {
  await app.evaluate(async (_e, cartella) => {
    globalThis.__prova = globalThis.__filoUpdater.perProva({ piattaforma: 'win32', versione: '0.2.233', cartella, avvisoVero: false });
    const { finto, registro } = globalThis.__prova;
    registro.scaricamenti = 0;
    finto.downloadUpdate = () => { registro.scaricamenti++; return new Promise(() => {}); };
    await globalThis.SN_STORAGE.updateSettings({ aggiornamenti: { automatici: false } });
    globalThis.__filoUpdater.seguiImpostazioni(await globalThis.SN_STORAGE.getSettings());
  }, dati);
}
const trovata = (app) => app.evaluate(() => globalThis.__prova.finto.emit('update-available', { version: '0.2.234' }));
const scaricato = (app, file) => app.evaluate((_e, f) => {
  globalThis.__prova.finto.emit('update-downloaded', { version: '0.2.234', downloadedFile: f });
}, file);
const registro = (app) => app.evaluate(() => JSON.parse(JSON.stringify(globalThis.__prova.registro)));
const apertura = (app) => app.evaluate(() => globalThis.SN_STORAGE.getSettings()
  .then((s) => globalThis.__filoUpdater.installaAllAvvioSeServe(s, { forza: true })));

test('spenta, «Installa» sulla carta: si scarica, diventa «Riavvia e aggiorna» e all\'apertura si installa con la barra', async ({ app }) => {
  test.setTimeout(60_000);
  const { dati, file } = cacheFinta();
  const page = await home(app);
  await spentaSuWindows(app, dati);
  await trovata(app);

  const installa = page.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: 'versione 0.2.234' });
  await expect(installa).toBeVisible({ timeout: 10_000 });
  await expect(installa.locator('.dash-carta-stato')).toContainText('si installa la prossima volta che apri Filo');
  expect((await registro(app)).scaricamenti).toBe(0);
  await installa.locator('.dash-carta-az.principale', { hasText: 'Installa' }).click();
  await expect.poll(async () => (await registro(app)).scaricamenti).toBe(1);

  await scaricato(app, file);
  const pronta = page.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: 'Riavvia e aggiorna' });
  await expect(pronta).toContainText('si installa la prossima volta che apri Filo', { timeout: 10_000 });
  await expect(page.locator('#accade .dash-carta-az.principale', { hasText: /^Installa$/ })).toHaveCount(0);
  expect((await registro(app)).avvisi.join('\n')).toContain('0.2.234');

  expect(await apertura(app)).toBe(true);
  const r = await registro(app);
  expect(r.lanciati.map((l) => l.argv)).toEqual([['--updated', '--force-run']]);
  expect(r.uscite).toBe(1);
});

test('spenta e mai chiesta: una versione scaricata non si installa all\'apertura, e la carta non lo promette', async ({ app }) => {
  const { dati, file } = cacheFinta();
  const page = await home(app);
  await spentaSuWindows(app, dati);
  await scaricato(app, file);
  const pronta = page.locator('#accade .dash-carta[data-tipo="avviso"]', { hasText: 'Riavvia e aggiorna' });
  await expect(pronta).toContainText('Filo 0.2.234 è pronto da installare.', { timeout: 10_000 });
  expect((await registro(app)).avvisi).toEqual([]);
  expect(await apertura(app)).toBe(false);
  expect((await registro(app)).lanciati).toEqual([]);
  // Il pulsante resta la strada dell'utente.
  await pronta.locator('.dash-carta-az.principale', { hasText: 'Riavvia e aggiorna' }).click();
  await expect.poll(async () => (await registro(app)).lanciati.length).toBe(1);
});

test('spenta, «aggiornati» in chat senza niente di pronto: scarica senza chiedere e dice di «Riavvia e aggiorna»', async ({ app }) => {
  const { dati } = cacheFinta();
  const page = await home(app);
  await spentaSuWindows(app, dati);
  await app.evaluate(() => { globalThis.__prova.registro.risposta = { evento: 'update-available', dati: { version: '0.2.234' } }; });
  await modelloFinto(app, [
    { toolCalls: [{ id: 'g6', name: 'INSTALLA_AGGIORNAMENTO', arguments: '{}' }] },
    { text: 'La sto scaricando.' },
  ]);
  await chiedi(page, 'aggiornati');
  await expect.poll(async () => (await registro(app)).scaricamenti, { timeout: 15_000 }).toBe(1);
  const chiesta = await app.evaluate(() => globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.AGGIORNAMENTO_CHIESTO, null));
  expect(chiesta).toEqual({ versione: '0.2.234' });
  const fatto = await app.evaluate(() => globalThis.__chatFinta_calls.at(-1).map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n'));
  expect(fatto).toContain('Riavvia e aggiorna');
});
