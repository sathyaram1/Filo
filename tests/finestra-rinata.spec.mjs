// #2191 — La finestra principale che rinasce (invito da fuori, Dock) e quella che si chiude: Crediti arriva davanti alle
// schede riaperte, e una finestra chiusa non riscrive più la sessione mentre le sue schede si smontano.

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';
import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { cartellaTemporanea, togliCartella } from './helpers/percorsi.mjs';

const require = createRequire(import.meta.url);
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
void require;

// La finestra normale viva: le sue schede (l'indirizzo che aspetta vale per una riaperta non ancora caricata) e quella davanti.
const normale = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
  if (!w) return null;
  const tm = w._filoTabs;
  const url = (t) => { try { return t.view.webContents.getURL() || t.url || ''; } catch (_) { return t.url || ''; } };
  const davanti = tm.tabs.find((t) => t.id === tm.activeId);
  return { schede: tm.tabs.map(url), davanti: davanti ? url(davanti) : null };
});

const sessioneSalvata = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.OPEN_TABS, null);
  return (s && s.tabs) || [];
});

// Due schede salvate, poi un'incognito tiene acceso Filo e la principale si chiude: è «Filo acceso senza finestra».
async function chiudiLaPrincipale(app, shell, openTab, testServer) {
  const a = (await openTab(testServer.html('<title>A</title><h1>A</h1>'))).url();
  const b = (await openTab(testServer.html('<title>B</title><h1>B</h1>'))).url();
  await expect.poll(() => sessioneSalvata(app), { message: 'le schede aperte non sono state salvate', timeout: 10000 })
    .toEqual(expect.arrayContaining([a, b]));
  await shell.evaluate(() => window.filoShell.openIncognito());
  await shell.locator('#win-close').click({ noWaitAfter: true }).catch(() => {});
  await expect.poll(() => normale(app), { message: 'la finestra principale non si è chiusa', timeout: 10000 }).toBeNull();
  return { a, b };
}

test('un invito aperto da fuori con Filo senza finestra porta Crediti davanti alle schede riaperte', async ({ app, shell, openTab, testServer }) => {
  const { a, b } = await chiudiLaPrincipale(app, shell, openTab, testServer);
  await app.evaluate(({ app: x }) => { x.emit('second-instance', {}, ['filo.exe', 'filo://invito/ABCD'], process.cwd()); });
  await expect.poll(async () => (await normale(app))?.schede || [], { message: 'la finestra rinata non ha riaperto le schede e Crediti', timeout: 15000 })
    .toEqual(expect.arrayContaining([a, b, expect.stringMatching(/^filo:\/\/credits\//)]));
  // Dopo la riapertura nessuno passa più davanti: Crediti resta la scheda che si vede.
  await new Promise((r) => setTimeout(r, 800));
  expect((await normale(app)).davanti, 'Crediti è finita dietro le schede riaperte').toMatch(/^filo:\/\/credits\//);

  // Mac: stessa cosa col collegamento che arriva da open-url.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito).close();
  });
  await expect.poll(() => normale(app), { timeout: 10000 }).toBeNull();
  await app.evaluate(({ app: x }) => { x.emit('open-url', { preventDefault() {} }, 'filo://invito/ABCD'); });
  await expect.poll(async () => (await normale(app))?.schede || [], { message: 'su Mac la finestra rinata non ha riaperto le schede', timeout: 15000 })
    .toEqual(expect.arrayContaining([a, b]));
  await new Promise((r) => setTimeout(r, 800));
  expect((await normale(app)).davanti, 'su Mac Crediti è finita dietro le schede riaperte').toMatch(/^filo:\/\/credits\//);
});

test('a Filo chiuso, l\'invito che lo apre porta Crediti davanti alle schede salvate', async () => {
  const userData = cartellaTemporanea('filo-invito-');
  // Una porta chiusa del loopback: le schede tornano senza bisogno di rete.
  const salvate = ['http://127.0.0.1:9/a', 'http://127.0.0.1:9/b'];
  writeFileSync(join(userData, 'storage.json'), JSON.stringify({ sn_open_tabs: { tabs: salvate, activeIndex: 1 } }));
  const app = await electron.launch({
    args: [...argomentiScala, '.', 'filo://invito/ABCD'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test', FILO_TEST_ACCOLTO: '1' },
  });
  try {
    await expect.poll(async () => (await normale(app))?.schede || [], { message: 'l\'avvio non ha riaperto le schede e Crediti', timeout: 20000 })
      .toEqual(expect.arrayContaining([...salvate, expect.stringMatching(/^filo:\/\/credits\//)]));
    await new Promise((r) => setTimeout(r, 800));
    expect((await normale(app)).davanti, 'all\'avvio Crediti è finita dietro le schede riaperte').toMatch(/^filo:\/\/credits\//);
  } finally {
    await chiudiApp(app);
    togliCartella(userData);
  }
});

test('chiusa la finestra subito dopo aver aperto una scheda, la sessione resta intera e torna dal Dock', async ({ app, shell, openTab, testServer }) => {
  const a = (await openTab(testServer.html('<title>A</title><h1>A</h1>'))).url();
  const b = (await openTab(testServer.html('<title>B</title><h1>B</h1>'))).url();
  await expect.poll(() => sessioneSalvata(app), { timeout: 10000 }).toEqual(expect.arrayContaining([a, b]));
  const c = testServer.html('<title>C</title><h1>C</h1>');
  await shell.evaluate(() => window.filoShell.openIncognito());
  // Una scheda nuova e la chiusura nello stesso istante: il salvataggio col ritardo non è ancora partito.
  await app.evaluate(({ BrowserWindow }, url) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x._filoTabs && !x._filoIncognito);
    globalThis.__schedeChiuse = w._filoTabs;
    w._filoTabs.openTab(url, { activate: true });
    w.close();
  }, c);
  await expect.poll(() => normale(app), { message: 'la finestra principale non si è chiusa', timeout: 10000 }).toBeNull();
  // Le schede della finestra chiusa che se ne vanno una alla volta non toccano più la sessione.
  await app.evaluate(() => {
    const tm = globalThis.__schedeChiuse;
    tm.tabs.splice(0, tm.tabs.length - 1);
    tm._persistSession();
  });
  await new Promise((r) => setTimeout(r, 1200));
  expect(await sessioneSalvata(app), 'la finestra chiusa ha riscritto la sessione a metà').toEqual(expect.arrayContaining([a, b, c]));
  // E l'uscita da qui scrive la stessa, non quella smontata.
  expect(await app.evaluate(() => globalThis.__schedeChiuse.statoPerLUscita()?.tabs || []), 'l\'uscita scriverebbe le schede smontate')
    .toEqual(expect.arrayContaining([a, b, c]));

  // Su Mac il clic sul Dock ridà tutte e tre.
  await app.evaluate(({ app: x }) => { x.emit('activate', {}, true); });
  await expect.poll(async () => (await normale(app))?.schede || [], { message: 'dal Dock le schede non sono tornate tutte', timeout: 15000 })
    .toEqual(expect.arrayContaining([a, b, c]));
});
