// #2086 — blocca una scheda dal tasto destro della linguetta: la pulizia e le chiusure in blocco chieste a Filo la
// lasciano e lo dicono, chiusa per numero costa una conferma, X, clic centrale e Ctrl+W non la chiudono e offrono
// «Sblocca e chiudi», e il blocco torna dopo un riavvio. La logica del gestore: tests/unit/schedeBloccate.test.mjs.
import { _electron as electron } from '@playwright/test';
import { rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, argomentiScala, chiudiApp } from './fixtures/electron.mjs';
import { tastoDestro, aspettaMenu, scegli, apriEAspetta, fotoDelMenu } from './helpers/menuLinguetta.mjs';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from './helpers/chatFinta.mjs';
import { CONFIRM_HOST, confirmText, clickConfirm, scrollConfirmToEnd } from './helpers/confirm.mjs';
import { cartellaTemporanea } from './helpers/percorsi.mjs';
import { primaFinestra } from './helpers/primaFinestra.mjs';

const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const schede = (shell) => shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).tabs
  .map((t) => ({ id: t.id, title: t.title, url: t.url, bloccata: t.bloccata })));
const titoli = async (shell) => (await schede(shell)).filter((t) => !String(t.url).startsWith('filo://')).map((t) => t.title).sort();

async function bloccaDalMenu(app, shell, id) {
  await tastoDestro(shell, `.tab[data-id="${id}"]`);
  const voci = await aspettaMenu(app, (v) => v.some((x) => x.testo === 'Duplica'));
  expect(voci[0].testo).toBe('Blocca');
  await scegli(app, 'Blocca');
  await expect.poll(async () => (await schede(shell)).find((t) => t.id === id)?.bloccata, { timeout: 8_000 }).toBe(true);
}

async function tornaAllaHome(shell) {
  const h = (await schede(shell)).find((t) => String(t.url).startsWith('filo://newtab'));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), h.id);
  return h.id;
}

const esitoPerIlModello = async (app, id) => {
  for (const msgs of await chiamateAlModello(app)) {
    const m = msgs.find((x) => x.role === 'tool' && x.tool_call_id === id);
    if (m) return String(m.content);
  }
  return '';
};

async function okAlPopup(page) {
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await scrollConfirmToEnd(page).catch(() => {});
  const testo = await confirmText(page);
  await clickConfirm(page, 'ok');
  return testo;
}

test('tre schede, la seconda bloccata: la pulizia che archivia tutto la lascia e l\'avviso conta solo le chiuse', async ({ app, shell, testServer }) => {
  await apriEAspetta(app, testServer.html('<title>Uno</title><p>uno'));
  const due = await apriEAspetta(app, testServer.html('<title>Due</title><p>due'));
  await apriEAspetta(app, testServer.html('<title>Tre</title><p>tre'));
  await tornaAllaHome(shell);
  await bloccaDalMenu(app, shell, due);

  const esito = await app.evaluate(async ({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs;
    const prima = globalThis.SN_TAB_TRIAGE_DECIDE;
    const viste = [];
    globalThis.SN_TAB_TRIAGE_DECIDE = async ({ tabs }) => {
      viste.push(...tabs.map((t) => t.title));
      return { decisions: tabs.map((_, i) => ({ i, action: 'archive' })) };
    };
    try {
      const r = await tm.runAutoTriage({ trigger: 'manual' });
      return { archiviate: r.archived, viste };
    } finally { globalThis.SN_TAB_TRIAGE_DECIDE = prima; }
  });
  expect(esito.viste, 'la bloccata è arrivata al modello che decide').not.toContain('Due');
  expect(esito.archiviate).toBe(2);
  expect(await titoli(shell)).toEqual(['Due']);
  await expect(shell.locator('.shell-notif-msg', { hasText: /2 chiuse/ })).toHaveCount(1, { timeout: 8_000 });
});

test('«chiudile tutte» in chat lascia la bloccata e lo dice; chiesta per numero si chiude dopo l\'OK', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await home(app);
  await openTab(testServer.html('<title>Alfa</title><p>alfa'));
  await openTab(testServer.html('<title>Beta</title><p>beta'));
  await openTab(testServer.html('<title>Gamma</title><p>gamma'));
  const beta = (await schede(shell)).find((t) => t.title === 'Beta').id;
  await bloccaDalMenu(app, shell, beta);
  await tornaAllaHome(shell);

  // Nella barra: 1 la home, 2 Alfa, 3 Beta (bloccata), 4 Gamma.
  await modelloFinto(app, [
    { text: '', toolCalls: [{ id: 't1', name: 'CHIUDI_SCHEDE', arguments: JSON.stringify({ tutte: true }) }] },
    { text: 'Ho chiuso 2 schede; una era bloccata e l\'ho lasciata.' },
    { text: '', toolCalls: [{ id: 'n1', name: 'CHIUDI_SCHEDE', arguments: JSON.stringify({ schede: [2] }) }] },
    { text: 'Chiusa: era bloccata.' },
  ]);
  await chiedi(page, 'chiudile tutte');
  await okAlPopup(page);
  await expect.poll(() => titoli(shell), { timeout: 10_000 }).toEqual(['Beta']);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'una era bloccata' })).toBeVisible({ timeout: 10_000 });
  const esito = await esitoPerIlModello(app, 't1');
  expect(esito).toContain('Chiuse 2 schede');
  expect(esito).toContain('l\'utente le ha bloccate');
  expect(esito).toMatch(/<<<DATI_PAGINA>>>[\s\S]*Beta[\s\S]*<<<FINE_DATI_PAGINA>>>/);
  await expect(page.locator('.dash-activity').last()).toContainText('una era bloccata e l\'ho lasciata');

  // Adesso è la seconda della barra. Da sola sarebbe costo 1 e si chiuderebbe senza chiedere: bloccata chiede.
  await chiedi(page, 'chiudi la seconda');
  const popup = await okAlPopup(page);
  expect(popup).toContain('Beta');
  expect(popup).toContain('L\'avevi bloccata');
  await expect.poll(() => titoli(shell), { timeout: 10_000 }).toEqual([]);
  expect(await esitoPerIlModello(app, 'n1')).toContain('Era bloccata');
  await expect(page.locator('.dash-activity').last()).toContainText('era bloccata');
  await page.screenshot({ path: 'tests/.shots/schede-bloccate-chat.png' });
  await ripristina(app);
});

test('X, clic centrale e Ctrl+W non chiudono la bloccata: l\'avviso offre «Sblocca e chiudi», che la chiude', async ({ app, shell, avvisi, testServer }) => {
  const id = await apriEAspetta(app, testServer.html('<title>Tenuta</title><p>tenuta'));
  await bloccaDalMenu(app, shell, id);
  const linguetta = shell.locator(`.tab[data-id="${id}"]`);
  const lucchetto = linguetta.locator('.close.bloccata');
  await expect(lucchetto).toBeVisible();
  await expect(lucchetto).toHaveAttribute('data-tip', 'Bloccata');
  await linguetta.screenshot({ path: 'tests/.shots/scheda-bloccata-lucchetto.png' });

  const vista = await (async () => { await lucchetto.click(); return avvisi(); })();
  const avviso = vista.locator('.shell-notif', { hasText: 'Scheda bloccata' });
  await expect(avviso).toBeVisible({ timeout: 8_000 });
  await linguetta.click({ button: 'middle' });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
  });
  await new Promise((r) => setTimeout(r, 800));
  expect(await titoli(shell)).toEqual(['Tenuta']);
  // Un avviso solo, non uno per gesto.
  await expect(vista.locator('.shell-notif', { hasText: 'Scheda bloccata' })).toHaveCount(1);

  // Nel menu della bloccata «Chiudi» è «Sblocca e chiudi».
  await tastoDestro(shell, `.tab[data-id="${id}"]`);
  const voci = await aspettaMenu(app, (v) => v.some((x) => x.testo === 'Duplica'));
  const testi = voci.map((x) => x.testo).filter((t) => !/^(Resta connesso qui|Non restare connesso)$/.test(t));
  expect(testi).toEqual(['Sblocca', 'Duplica', 'Muta', 'Sblocca e chiudi']);
  await fotoDelMenu(app, 'tests/.shots/menu-linguetta-bloccata.png');
  await shell.keyboard.press('Escape').catch(() => {});

  await avviso.getByRole('button', { name: 'Sblocca e chiudi' }).click();
  await expect.poll(() => titoli(shell), { timeout: 8_000 }).toEqual([]);
});

test('dopo un riavvio la scheda è ancora bloccata, col lucchetto; il duplicato nasce sbloccato', async ({ testServer }) => {
  test.setTimeout(120_000);
  const userData = cartellaTemporanea('filo-test-bloccate-');
  const avvia = () => electron.launch({
    args: [...argomentiScala, '.'],
    cwd: RADICE,
    env: { ...process.env, FILO_USER_DATA: userData, FILO_TEST_ACCOLTO: '1', FILO_DOWNLOAD_DIR: join(userData, 'downloads'), NODE_ENV: 'test' },
  });
  const url = testServer.html('<title>Da tenere</title><p>tenere');
  let app = await avvia();
  try {
    const shell = await primaFinestra(app);
    const id = await apriEAspetta(app, url);
    await bloccaDalMenu(app, shell, id);
    await shell.evaluate((i) => window.filoShell.tabs.duplicate(i), id);
    await expect.poll(async () => (await schede(shell)).filter((t) => t.url === url).map((t) => t.bloccata).sort(), { timeout: 8_000 })
      .toEqual([false, true]);
    await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getRaw('sn_open_tabs'))?.bloccate || []), { timeout: 8_000 })
      .toContain(true);
  } finally {
    await chiudiApp(app);
  }

  app = await avvia();
  try {
    const shell = await primaFinestra(app);
    await expect.poll(async () => (await schede(shell)).filter((t) => t.url === url).map((t) => t.bloccata).sort(), { timeout: 15_000 })
      .toEqual([false, true]);
    const id = (await schede(shell)).find((t) => t.url === url && t.bloccata).id;
    await expect(shell.locator(`.tab[data-id="${id}"] .close.bloccata`)).toBeVisible({ timeout: 8_000 });
    await shell.locator('#tabs').screenshot({ path: 'tests/.shots/schede-bloccate-dopo-riavvio.png' });
  } finally {
    await chiudiApp(app);
    try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  }
});
