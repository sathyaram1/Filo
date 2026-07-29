// Fondazione "Filo scrive nei file dell'editor": la collezione dei file
// dell'editor NON vive più solo nel localStorage del renderer, ma è rispecchiata
// sull'archivio dell'app (storage.json, via chrome.storage.local) — lo stesso
// archivio che il processo principale (main) legge e scrive. Questo è ciò che
// permette a Filo, dal main, di creare/modificare un file dell'editor e farlo
// comparire subito nell'editor aperto.
//
// I test asseriscono il SUCCESSO della fondazione (non l'assenza di un errore):
//   1) dopo aver scritto e salvato, la collezione è LEGGIBILE dall'archivio
//      chrome.storage.local col testo giusto → il main può vederla. Senza il
//      mirror (vecchio codice: solo localStorage) l'archivio sarebbe vuoto → rosso.
//   2) una modifica ESTERNA scritta nell'archivio (come farebbe il main) e
//      annunciata con il broadcast live viene recepita dall'editor aperto quando
//      il file NON è "in modifica" (non-dirty): il testo esterno compare. Senza
//      la ricarica dall'archivio su live-update, il testo esterno non apparirebbe
//      → rosso.
//   3) se invece l'utente sta scrivendo (dirty), la modifica esterna NON
//      sovrascrive il testo locale: vincono le modifiche in corso.

import { test, expect } from './fixtures/electron.mjs';

const COLLECTION_KEY = 'filo.editor.collection';

async function setDocText(page, text) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

// Legge la collezione dall'archivio dell'app (la stessa via del main).
async function readArchive(page) {
  return page.evaluate(async (KEY) => {
    const r = await chrome.storage.local.get(KEY);
    return (r && r[KEY]) || null;
  }, COLLECTION_KEY);
}

// Simula il main che scrive un appunto nel file ATTIVO della collezione: scrive
// direttamente sull'archivio chrome.storage.local (esattamente ciò che fa il
// bridge main→editor). meta.modified è nel FUTURO così la versione d'archivio
// vince sempre nel merge locale↔archivio, in modo deterministico.
async function writeExternalEdit(page, text) {
  await page.evaluate(async ({ KEY, t }) => {
    const r = await chrome.storage.local.get(KEY);
    const col = r[KEY];
    const active = col.files.find((f) => f.id === col.activeId) || col.files[0];
    active.content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] };
    active.meta = active.meta || {};
    active.meta.modified = new Date(Date.now() + 60000).toISOString();
    await chrome.storage.local.set({ [KEY]: col });
  }, { KEY: COLLECTION_KEY, t: text });
}

// Annuncia la modifica come fa il main dopo aver scritto: broadcast 'filo:broadcast'
// con FILO_LIVE_UPDATED a tutte le webContents (identico a broadcastLiveUpdate()).
async function broadcastLiveUpdate(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const msg = { type: 'filo_live_updated' };
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send('filo:broadcast', msg); } catch (_) {}
      if (win._filoTabs) {
        for (const tb of win._filoTabs.tabs) {
          try { tb.view.webContents.send('filo:broadcast', msg); } catch (_) {}
        }
      }
    }
  });
}

test('la collezione è leggibile dall\'archivio dell\'app (raggiungibile dal main)', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');

  await page.click('#doc');
  await setDocText(page, 'appunto raggiungibile dal cuore di Filo');
  await page.keyboard.press('Control+s');
  await expect(page.locator('.ed-save-state')).toHaveText('Salvato');

  // La collezione dev'essere nell'archivio (non solo in localStorage): il main
  // la troverebbe qui. Deve contenere il testo appena scritto nel file attivo.
  await expect.poll(async () => {
    const col = await readArchive(page);
    if (!col || !Array.isArray(col.files)) return '';
    const active = col.files.find((f) => f.id === col.activeId) || col.files[0];
    return JSON.stringify(active && active.content || '');
  }).toContain('appunto raggiungibile dal cuore di Filo');
});

test('una modifica esterna (dal main) compare nell\'editor aperto quando non-dirty', async ({ app, openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');

  await page.click('#doc');
  await setDocText(page, 'testo iniziale utente');
  await page.keyboard.press('Control+s');
  await expect(page.locator('.ed-save-state')).toHaveText('Salvato');
  await expect(page.locator('#doc')).toHaveText('testo iniziale utente');

  // Il main scrive nell'archivio e annuncia. L'editor NON è dirty → deve
  // recepire il testo esterno e mostrarlo.
  await writeExternalEdit(page, 'testo scritto da Filo dal main');
  await broadcastLiveUpdate(app);

  await expect(page.locator('#doc')).toHaveText('testo scritto da Filo dal main');
});

test('mentre l\'utente scrive (dirty), la modifica esterna non sovrascrive il testo locale', async ({ app, openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');

  await page.click('#doc');
  await setDocText(page, 'base salvata');
  await page.keyboard.press('Control+s');
  await expect(page.locator('.ed-save-state')).toHaveText('Salvato');

  // L'utente scrive senza salvare → dirty. (setDocText fa scattare markDirty.)
  await setDocText(page, 'sto scrivendo qualcosa di importante');
  await expect(page.locator('.ed-save-state')).toHaveText('Non salvato');

  // Il main scrive un appunto nello stesso file e annuncia: NON deve rubare il
  // testo che l'utente sta scrivendo.
  await writeExternalEdit(page, 'appunto del main che non deve vincere');
  await broadcastLiveUpdate(app);

  // Piccola attesa per lasciar girare l'eventuale reload asincrono, poi assert
  // che il testo locale è ancora quello dell'utente.
  await page.waitForTimeout(300);
  await expect(page.locator('#doc')).toHaveText('sto scrivendo qualcosa di importante');
});
