// Gestione → Automazioni (SPEC-MANUTENTORE § 2, § 9): il recap del manutentore, un foglio al giorno dal più nuovo, e
// il freno d'emergenza con la N del manutentore accanto. Il recap è testo d'altri: si legge come testo, mai come markup.
// Il main è finto in pagina (come manage-crediti.spec.mjs); la porta vera la prova tests/unit/manutentoreRecap.test.mjs.

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'filo://manage/manage.html';
const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '.shots');

const RECAP = [
  { giorno: '2026-10-30', testo: 'Ieri: 3 fusioni.', at: '2026-10-30T07:10:00Z' },
  { giorno: '2026-10-31', testo: 'Fusioni ieri: 7, spesa 41 $.\nRosa: #812, #815 (grafica prima, come chiesto il 31/10).\n<img src=x onerror="window.__xss=1"> e https://esempio.example/x', at: '2026-10-31T07:10:00Z' },
];

async function apri(openTab, { recap = RECAP, stato = { parallelismo: 4, parallelismoEffettivo: 4, freno: 20 }, owner = true, fallisce = false } = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo && window.__mgManutentore);
  await page.evaluate(({ recap, stato, owner, fallisce }) => {
    window.__rc = { letture: 0 };
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { ok: true, isAdmin: owner, signedIn: true };
      if (msg && msg.type === 'manutentore_recap_get') {
        window.__rc.letture += 1;
        return fallisce ? { ok: false, error: 'Il server non risponde.' } : { ok: true, recap, stato };
      }
      if (msg && msg.type === 'automation_sessions_get') return { ok: true, letto: true, maxSessions: 20, priorityAccount: 'B', accountAOff: false, accountBOff: false, manutentoreAcceso: true };
      if (msg && msg.type === 'automation_sessions_set') {
        const { type: _t, ...campi } = msg;
        (window.__rc.scritti = window.__rc.scritti || []).push(campi);
        return { ok: true, letto: true, maxSessions: 20, priorityAccount: 'B', accountAOff: false, accountBOff: false, manutentoreAcceso: campi.manutentoreAcceso !== false };
      }
      return orig(msg);
    };
  }, { recap, stato, owner, fallisce });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await apriScheda(page, 'automation');
  await page.evaluate(() => window.__mgTest.loadSessions());
  await expect(page.locator('#panel-automation')).toHaveClass(/mg-panel--active/);
  return page;
}

test('l\'owner vede l\'ultimo recap, come testo, e sfoglia i giorni prima', async ({ openTab }) => {
  const page = await apri(openTab);
  const testo = page.locator('#mgRecapTesto');
  await expect(page.locator('#mgRecap')).toBeVisible();
  await expect(testo).toContainText('Fusioni ieri: 7, spesa 41 $.');
  await expect(testo).toContainText('Rosa: #812, #815');
  // Il markup del recap resta testo: niente immagine, niente script, niente link.
  await expect(testo).toContainText('<img src=x onerror=');
  expect(await testo.locator('img, a, script').count()).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await expect(page.locator('#mgRecapGiorno')).toHaveAttribute('title', '2026-10-31');
  await expect(page.locator('#mgRecapDopo')).toBeDisabled();

  await page.locator('#mgRecapPrima').click();
  await expect(testo).toHaveText('Ieri: 3 fusioni.');
  await expect(page.locator('#mgRecapGiorno')).toHaveAttribute('title', '2026-10-30');
  await expect(page.locator('#mgRecapPrima')).toBeDisabled();
  await page.locator('#mgRecapDopo').click();
  await expect(testo).toContainText('Fusioni ieri: 7');

  // Dal tasto destro: copia, e la rilettura resta sul giorno aperto.
  await page.locator('#mgRecapPrima').click();
  await testo.click({ button: 'right' });
  await expect(page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Copia il recap' })).toBeVisible();
  await page.locator('.mg-ctxmenu .sn-select-option', { hasText: 'Rileggi dal server' }).click();
  await expect.poll(() => page.evaluate(() => window.__rc.letture)).toBeGreaterThan(1);
  await expect(page.locator('#mgRecapGiorno')).toHaveAttribute('title', '2026-10-30');
});

test('il freno d\'emergenza ha il suo nome, e accanto la N del manutentore', async ({ openTab }) => {
  const page = await apri(openTab);
  await expect(page.locator('label[for="mgMaxSessions"]')).toHaveText('Freno d\'emergenza');
  await expect(page.locator('#mgMaxSessions')).toHaveValue('20');
  await expect(page.locator('#mgManutentoreN')).toHaveText('Il manutentore ne fa lavorare 4 insieme.');
});

test('il manutentore si spegne e si riaccende da Automazioni, e si scrive solo quel campo', async ({ openTab }) => {
  const page = await apri(openTab);
  const sw = page.locator('#mgManutentoreAcceso');
  await expect(sw).toBeChecked();
  await page.locator('#mgManutentoreSwitch').click();
  await expect(page.locator('#mgManutentoreMsg')).toHaveText('Salvato.');
  await expect(sw).not.toBeChecked();
  await page.locator('#mgManutentoreSwitch').click();
  await expect(sw).toBeChecked();
  expect(await page.evaluate(() => window.__rc.scritti)).toEqual([{ manutentoreAcceso: false }, { manutentoreAcceso: true }]);
});

test('senza N scelta lo si dice, e senza recap lo si dice', async ({ openTab }) => {
  const page = await apri(openTab, { recap: [], stato: { parallelismo: null, parallelismoEffettivo: 20, freno: 20 } });
  await expect(page.locator('#mgRecapMsg')).toHaveText('Nessun recap ancora: il manutentore lo scrive ogni mattina.');
  await expect(page.locator('#mgManutentoreN')).toHaveText('Il manutentore non ha scelto quante: ne lavorano fino a 20.');
});

test('una lettura fallita lo dice e non inventa né recap né N', async ({ openTab }) => {
  const page = await apri(openTab, { fallisce: true });
  await expect(page.locator('#mgRecapMsg')).toHaveText('Non ho potuto leggere il recap: Il server non risponde.');
  await expect(page.locator('#mgRecapTesto')).toHaveText('');
  await expect(page.locator('#mgManutentoreN')).toHaveText('');
});

test('chi non è l\'owner non vede il recap', async ({ openTab }) => {
  const page = await apri(openTab, { owner: false });
  await expect(page.locator('#mgRecap')).toBeHidden();
});

test('aspetto del recap in tema chiaro e scuro', async ({ openTab }) => {
  const page = await apri(openTab);
  await expect(page.locator('#mgRecapTesto')).toContainText('Fusioni ieri');
  mkdirSync(SHOTS, { recursive: true });
  for (const tema of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: tema });
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, tema);
    await page.locator('#mgRecap').hover();
    await page.locator('.mg-auto-main').screenshot({ path: join(SHOTS, `manage-recap-${tema}.png`) });
  }
});
