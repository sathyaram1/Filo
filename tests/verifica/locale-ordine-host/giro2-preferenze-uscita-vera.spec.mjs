// Il giro prima ha chiuso la porta del ricaricamento. Qui si provano le DUE
// uscite che la segnalazione nominava davvero — cambiare scheda e chiudere la
// scheda — perché sono uscite diverse dal ricaricamento e possono non avvisare
// la pagina allo stesso modo.

import { test, expect } from '../../fixtures/electron.mjs';

const PREFERENZE = 'filo://preferences/preferences.html';
const ALTRA = 'filo://history/history.html';

async function scriviStile(page, testo) {
  await page.waitForSelector('#agentStyleText', { timeout: 15_000 });
  await page.evaluate((t) => {
    const el = document.getElementById('agentStyleText');
    el.value = t;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, testo);
}

async function stileSalvato(app) {
  return app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).agentStyle || '');
}

// Elenco delle schede aperte, dalla shell: serve l'id per chiuderne una.
async function schede(shell) {
  return shell.evaluate(async () => {
    const s = await window.filoShell.tabs.snapshot();
    const lista = Array.isArray(s) ? s : (s && s.tabs) || [];
    return lista.map((t) => ({ id: t.id, url: t.url || '' }));
  });
}

test('Preferenze: passando a un\'altra scheda subito dopo aver scritto, la modifica non si perde', async ({ app, shell, openTab }) => {
  const page = await openTab(PREFERENZE);
  const atteso = 'stile scritto e poi cambio scheda';
  await scriviStile(page, atteso);

  // Nessuna attesa: si cambia scheda dentro la finestra di attesa del
  // salvataggio, esattamente come farebbe chi ha appena finito di scrivere.
  await openTab(ALTRA);

  await expect
    .poll(() => stileSalvato(app), {
      timeout: 6000,
      message: 'cambiando scheda subito dopo aver scritto, l\'ultima modifica sparisce',
    })
    .toBe(atteso);
});

test('Preferenze: chiudendo la scheda subito dopo aver scritto, la modifica non si perde', async ({ app, shell, openTab }) => {
  const page = await openTab(PREFERENZE);
  const atteso = 'stile scritto e poi chiudo la scheda';
  await scriviStile(page, atteso);

  const aperte = await schede(shell);
  const pref = aperte.find((t) => t.url.includes('preferences'));
  expect(pref, 'la scheda delle Preferenze non compare fra quelle aperte').toBeTruthy();
  await shell.evaluate((id) => window.filoShell.tabs.close(id), pref.id);

  await expect
    .poll(() => stileSalvato(app), {
      timeout: 6000,
      message: 'chiudendo la scheda subito dopo aver scritto, l\'ultima modifica sparisce',
    })
    .toBe(atteso);
});
