// Il giro scorso ha chiuso due uscite (cambiare scheda, chiudere la scheda).
// Qui si provano le altre due uscite che un utente usa davvero subito dopo aver
// scritto: portare la stessa scheda da un'altra parte, e spegnere Filo.

import { _electron as electron } from '@playwright/test';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, argomentiScala, chiudiApp } from '../../fixtures/electron.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const PREFERENZE = 'filo://preferences/preferences.html';
const OPZIONI = 'filo://options/options.html';
const ALTROVE = 'filo://history/history.html';
const RADICE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function scriviStile(page, testo) {
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });
  await page.evaluate((t) => {
    const el = document.getElementById('agentStyleText');
    el.value = t;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, testo);
}

async function schede(shell) {
  return shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const lista = Array.isArray(s) ? s : (s && s.tabs) || [];
    return lista.map((t) => ({ id: t.id, url: t.url || '' }));
  });
}

test('Preferenze: portando la stessa scheda altrove subito dopo aver scritto, la modifica non si perde', async ({ app, shell, openTab }) => {
  const page = await openTab(PREFERENZE);
  const atteso = 'stile scritto e poi vado altrove nella stessa scheda';
  await scriviStile(page, atteso);

  const aperte = await schede(shell);
  const pref = aperte.find((t) => t.url.includes('preferences'));
  expect(pref, 'la scheda delle Preferenze non compare fra quelle aperte').toBeTruthy();
  await shell.evaluate(({ id, url }) => window.filoShell.tabs.navigate(id, url), { id: pref.id, url: ALTROVE });

  await expect
    .poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).agentStyle || ''), {
      timeout: 6000,
      message: 'cambiando pagina nella stessa scheda, l\'ultima modifica sparisce',
    })
    .toBe(atteso);
});

test('Opzioni: portando la stessa scheda altrove subito dopo aver scritto, la modifica non si perde', async ({ app, shell, openTab }) => {
  const page = await openTab(OPZIONI);
  await page.waitForSelector('#monthlyLimit', { timeout: 15_000 });
  await page.evaluate(() => {
    const el = document.getElementById('monthlyLimit');
    el.value = '23';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  const aperte = await schede(shell);
  const opz = aperte.find((t) => t.url.includes('options'));
  expect(opz, 'la scheda delle Opzioni non compare fra quelle aperte').toBeTruthy();
  await shell.evaluate(({ id, url }) => window.filoShell.tabs.navigate(id, url), { id: opz.id, url: ALTROVE });

  await expect
    .poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).monthlyLimitEur), {
      timeout: 6000,
      message: 'cambiando pagina nella stessa scheda, l\'ultima modifica sparisce',
    })
    .toBe(23);
});

// Uscita più brusca di tutte, e la più comune a fine giornata: si scrive e si
// spegne Filo. Qui serve una cartella dati che sopravviva alla chiusura, quindi
// l'app si apre a mano invece di usare quella della fixture.
async function scriviESpegni(testo, attesaMs, pagina = PREFERENZE, campo = 'agentStyle') {
  const userData = cartellaTemporanea('filo-test-uscita-');
  const app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: RADICE,
    env: {
      ...process.env,
      FILO_USER_DATA: userData,
      FILO_DOWNLOAD_DIR: join(userData, 'downloads'),
      NODE_ENV: 'test',
    },
  });
  try {
    const shell = await app.firstWindow();
    await shell.waitForLoadState('domcontentloaded');
    await shell.evaluate((u) => window.filoShell.tabs.open(u), pagina);
    const nome = new URL(pagina).hostname;
    const scadenza = Date.now() + 15_000;
    let page = null;
    while (Date.now() < scadenza) {
      page = app.windows().find((w) => w.url().includes(nome));
      if (page) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(page, `la scheda ${nome} non si è aperta`).toBeTruthy();
    if (pagina === PREFERENZE) {
      await scriviStile(page, testo);
    } else {
      await page.waitForSelector('#monthlyLimit', { timeout: 15_000 });
      await page.evaluate((v) => {
        const el = document.getElementById('monthlyLimit');
        el.value = v;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, testo);
    }
    if (attesaMs) await page.waitForTimeout(attesaMs);
  } finally {
    await chiudiApp(app);
  }

  let salvato = '';
  try {
    const dati = JSON.parse(readFileSync(join(userData, 'storage.json'), 'utf8'));
    const s = dati.settings || dati;
    salvato = s && s[campo] != null ? String(s[campo]) : '';
  } catch (e) {
    salvato = `[storage illeggibile: ${e.message}]`;
  }
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  return salvato;
}

// Controllo: con qualche secondo di pausa la stessa strada salva. Serve a
// distinguere «la modifica si perde» da «il test legge nel posto sbagliato».
test('Preferenze: aspettando un attimo prima di spegnere Filo, la modifica c\'è', async () => {
  test.setTimeout(120_000);
  const atteso = 'stile scritto, aspetto, poi spengo Filo';
  expect(await scriviESpegni(atteso, 3000), 'la modifica non arriva nemmeno con la pausa').toBe(atteso);
});

test('Preferenze: spegnendo Filo subito dopo aver scritto, la modifica non si perde', async () => {
  test.setTimeout(120_000);
  test.fail(true, 'rilievo aperto del giro 3: spegnendo Filo l\'ultima modifica non viene salvata');
  const atteso = 'stile scritto e poi spengo Filo';
  expect(await scriviESpegni(atteso, 0),
    'spegnendo Filo subito dopo aver scritto, l\'ultima modifica sparisce').toBe(atteso);
});

test('Opzioni: spegnendo Filo subito dopo aver scritto, la modifica non si perde', async () => {
  test.setTimeout(120_000);
  test.fail(true, 'rilievo aperto del giro 3: spegnendo Filo l\'ultima modifica non viene salvata');
  expect(await scriviESpegni('31', 0, OPZIONI, 'monthlyLimitEur'),
    'spegnendo Filo subito dopo aver scritto, l\'ultimo limite di spesa sparisce').toBe('31');
});
