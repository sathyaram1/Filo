// La pagina Novità (#1956): le versioni uscite dalla più recente, da cercare per testo; il tasto destro su una riga la
// copia e apre la segnalazione da cui è nata. Ci si arriva dal menu Impostazioni, dalle Preferenze e dal recap.
// Le note del main si sostituiscono solo dove serve un esito preciso; la prima prova legge il registro vero.

import { mkdirSync } from 'node:fs';
import { test, expect, aspettaFinestra } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const NOVITA = 'filo://novita/novita.html';
const SHOTS = 'tests/.shots';

const cmp = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};

// Tre blocchi: uno sopra la versione installata (non ancora uscito), quella installata con una riga nata dalla
// segnalazione #4242, e una vecchia.
async function noteFinte(app) {
  return app.evaluate(({ app }) => {
    const v = app.getVersion();
    const PN = globalThis.SN_PATCH_NOTES;
    PN.NOTES.length = 0;
    PN.NOTES.push(
      { version: '99.0.0', date: '2026-12-01', features: ['Riga della versione che non è ancora uscita'], fixes: [] },
      { version: v, date: '2026-10-31', features: [{ testo: 'Le novità si cercano mentre scrivi.', segnalazione: 4242 }],
        fixes: ['Il download riparte da dove si era fermato.'] },
      { version: '0.0.2', date: '2026-09-15', features: ['Le schede si riordinano per colore.'],
        fixes: ['L\'aggiornamento non chiude più le finestre aperte.'] },
    );
    return v;
  });
}

async function apriNovita(openTab, url = NOVITA) {
  const page = await openTab(url);
  await page.waitForFunction(() => document.body.dataset.pronto === '1', null, { timeout: 10_000 });
  return page;
}

const riga = (page, testo) => page.locator('.nv-riga', { hasText: testo });

test('sul registro vero: almeno due versioni dalla più recente, e una parola trova la sua riga', async ({ app, openTab }) => {
  const installata = await app.evaluate(({ app }) => app.getVersion());
  const page = await apriNovita(openTab);
  const versioni = await page.locator('.nv-versione').evaluateAll((els) => els.map((e) => e.dataset.versione));
  expect(versioni.length).toBeGreaterThanOrEqual(2);
  for (let i = 1; i < versioni.length; i++) expect(cmp(versioni[i - 1], versioni[i])).toBeGreaterThan(0);
  expect(cmp(versioni[0], installata)).toBeLessThanOrEqual(0);
  await expect(page.locator('#conta')).toHaveText(`${versioni.length} versioni`);

  await page.locator('#cerca').fill('ultima scheda chiusa');
  const trovata = riga(page, 'riapre l\'ultima scheda chiusa');
  await expect(trovata).toBeVisible();
  await expect(trovata.locator('xpath=ancestor::section[1]')).toHaveAttribute('data-versione', '0.2.251');
  for (const t of await page.locator('.nv-riga').allInnerTexts()) expect(t.toLowerCase()).toContain('ultima scheda chiusa');
  expect(await page.locator('.nv-riga').count()).toBeLessThan(10);
  expect(await page.evaluate(() => CSS.highlights.get('nv-trovato')?.size || 0)).toBeGreaterThan(0);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/novita-cerca.png` });
});

test('solo le versioni uscite, la propria segnata; il filtro regge accenti e lettere sbagliate, e il vuoto ha la via d\'uscita', async ({ app, openTab }) => {
  const v = await noteFinte(app);
  const page = await apriNovita(openTab);
  await expect(page.locator('.nv-versione')).toHaveCount(2);
  await expect(page.locator('.nv-versione').first()).toHaveAttribute('data-versione', v);
  await expect(page.locator('.nv-versione').first().locator('.nv-tua')).toHaveText('installata');
  await expect(page.locator('.nv-versione').nth(1).locator('.nv-data')).toHaveText('15 settembre 2026');
  await expect(page.locator('body')).not.toContainText('non è ancora uscita');
  await expect(page.locator('.nv-versione').first().locator('.nv-gruppo-titolo')).toHaveText(['Nuove funzioni', 'Correzioni']);

  await page.locator('#cerca').fill('NOVITÀ');
  await expect(page.locator('.nv-riga')).toHaveText(['Le novità si cercano mentre scrivi.']);
  await expect(page.locator('#conta')).toHaveText('1 riga in 1 versione');

  await page.locator('#cerca').fill('agiornamento');
  await expect(page.locator('.nv-riga')).toHaveText(['L\'aggiornamento non chiude più le finestre aperte.']);
  await expect(page.locator('#avviso')).toHaveText('Nessuna riga contiene «agiornamento»: queste hanno aggiornamento.');

  // Il filtro resta nell'indirizzo: ricaricando, la ricerca è ancora lì.
  await expect.poll(() => page.url()).toContain('?q=agiornamento');
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.pronto === '1');
  await expect(page.locator('#cerca')).toHaveValue('agiornamento');
  await expect(page.locator('.nv-riga')).toHaveCount(1);

  await page.locator('#cerca').fill('<b>zzqqxx</b>');
  await expect(page.locator('.nv-riga')).toHaveCount(0);
  await expect(page.locator('#vuoto')).toContainText('Nessuna novità contiene «<b>zzqqxx</b>».');
  await page.locator('#togliFiltro').click();
  await expect(page.locator('.nv-riga')).toHaveCount(4);
  await expect(page.locator('#vuoto')).toBeHidden();
  await expect(page.locator('#cerca')).toBeFocused();
});

test('tasto destro su una riga: «Copia il testo» la copia; la segnalazione si apre solo se è tua, e porta alla sua riga', async ({ app, openTab }) => {
  await noteFinte(app);
  await app.evaluate(() => globalThis.SN_SEGNALAZIONI_MIE.svuota());
  let page = await apriNovita(openTab);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await expect(page.locator('.nv-segn')).toHaveCount(0);

  await riga(page, 'Le novità si cercano').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.voce('Copia il testo')).toBeVisible();
  await expect(menu.voce('Copia tutta la versione')).toBeVisible();
  await expect(menu.voce('Apri la tua segnalazione')).toHaveCount(0);
  await menu.voce('Copia il testo').click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Le novità si cercano mentre scrivi.');

  await riga(page, 'riordinano per colore').click({ button: 'right' });
  await menu.voce('Copia tutta la versione').click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    'Filo 0.0.2 (15 settembre 2026)\n\nNuove funzioni:\n• Le schede si riordinano per colore.\n\nCorrezioni:\n'
    + '• L\'aggiornamento non chiude più le finestre aperte.');

  // Questo computer ha mandato la #4242: la riga si apre su «Le tue segnalazioni», con la segnalazione aperta.
  await app.evaluate(() => globalThis.SN_SEGNALAZIONI_MIE.importa([{
    id: 'fb-4242', testo: 'Vorrei cercare fra le novità', creataIl: '2026-10-20T10:00:00Z', stato: 'risolta', num: '#4242',
  }]));
  page = await apriNovita(openTab);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await expect(page.locator('.nv-segn')).toHaveText('#4242');
  await riga(page, 'Le novità si cercano').click({ button: 'right' });
  await menuDi(page).voce('Apri la tua segnalazione').click();
  const bacheca = await aspettaFinestra(app, (w) => w.url().startsWith('filo://board/board.html#segnalazione=4242'),
    'la bacheca non si è aperta sulla segnalazione');
  const sua = bacheca.locator('.bd-mia', { hasText: '#4242' });
  await expect(sua.locator('.bd-mia-testa')).toHaveAttribute('aria-expanded', 'true', { timeout: 10_000 });
  await expect(sua.locator('.bd-mia-testo')).toHaveText('Vorrei cercare fra le novità');
});

test('per chi gestisce i feedback, #feedback=N apre in Gestione la segnalazione con quel numero', async ({ openTab }) => {
  const page = await openTab('filo://manage/manage.html');
  await page.waitForFunction(() => !!window.__mgTest);
  await page.evaluate(() => {
    window.__mgTest.setData([
      { _id: 'fb-a', seq: 4242, subSeq: 0, text: 'Una pagina con tutte le novità', name: 'Pagina Novità', status: 'done', createdAt: '2026-10-31T10:00:00Z' },
      { _id: 'fb-b', seq: 17, subSeq: 0, text: 'Altro', name: 'Altro', status: 'todo', createdAt: '2026-10-30T10:00:00Z' },
    ]);
    location.hash = '#feedback=4242';
  });
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgThread')).toContainText('Una pagina con tutte le novità');
  await expect.poll(() => page.url()).not.toContain('#feedback=');
});

test('ci si arriva dal recap all\'avvio, dal menu Impostazioni e dalle Preferenze', async ({ app, shell, openTab }) => {
  await noteFinte(app);
  const home = await openTab('filo://newtab/');
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.setRaw(globalThis.SN_CONST.STORAGE_KEYS.LAST_SEEN_VERSION, '0.0.1');
  });
  await home.reload();
  await expect(home.locator('#recapOverlay')).toBeVisible();
  await home.locator('#recapTutte').click();
  await aspettaFinestra(app, (w) => w.url() === NOVITA, 'il recap non ha aperto la pagina Novità');
  await expect(home.locator('#recapOverlay')).toHaveCount(0);
  const vista = await app.evaluate(() => globalThis.SN_STORAGE.getRaw(globalThis.SN_CONST.STORAGE_KEYS.LAST_SEEN_VERSION, null));
  expect(vista).toBe(await app.evaluate(({ app }) => app.getVersion()));

  const quante = () => app.windows().filter((w) => { try { return w.url() === NOVITA; } catch (_) { return false; } }).length;
  const prima = quante();
  await shell.evaluate(() => document.getElementById('nav-settings').click());
  const popup = await aspettaFinestra(app, (w) => w.url().startsWith('data:text/html') && !w.isClosed(), 'il menu Impostazioni non si è aperto');
  await popup.locator('.item', { hasText: 'Novità' }).click();
  await expect.poll(quante, { message: 'il menu Impostazioni non ha aperto la pagina Novità' }).toBe(prima + 1);

  const pref = await openTab('filo://preferences/preferences.html');
  await pref.locator('#apriNovita').click();
  await expect.poll(quante, { message: 'le Preferenze non hanno aperto la pagina Novità' }).toBe(prima + 2);
});
