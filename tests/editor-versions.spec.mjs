// Versionamento dell'editor: ogni modifica AUTOMATICA di Filo (le "azioni di
// formattazione" che la chat applica al documento) deve creare un punto di
// ripristino, così è SEMPRE possibile tornare indietro. Lo storico vive
// sull'archivio file dell'app, quindi sopravvive al reload.
//
// I test asseriscono il SUCCESSO della feature:
//   1) dopo una modifica automatica di Filo, ripristinando la versione
//      precedente il contenuto torna IDENTICO a prima (non solo "nessun errore");
//   2) lo storico è ancora presente e ripristinabile dopo un reload.
// Senza il versionamento, l'hook di test non esisterebbe, la lista sarebbe vuota
// e il ripristino non riporterebbe il documento allo stato pre-modifica → rosso.

import { test, expect } from './fixtures/electron.mjs';

async function setDocText(page, text) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

// Simula una modifica automatica di Filo: la stessa via che usa la chat quando
// il modello risponde con azioni di formattazione (grassetto su tutto il testo).
async function filoAutoEdit(page) {
  return page.evaluate(() => window.__filoEditorFormat.applyFormatActions([{ style: 'bold', target: 'all' }]));
}

test('una modifica automatica di Filo è annullabile: il contenuto torna identico', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  await page.click('#doc');
  await setDocText(page, 'Cappuccetto Rosso');

  // Stato di partenza: nessun grassetto, nessuna versione ancora.
  await expect(page.locator('#doc strong')).toHaveCount(0);
  const before = await page.locator('#doc').textContent();
  const startVers = await page.evaluate(() => window.__filoEditorVersions.list().length);

  // Modifica AUTOMATICA di Filo: mette in grassetto tutto il testo.
  const touched = await filoAutoEdit(page);
  expect(touched).toBeGreaterThan(0);
  // La modifica è avvenuta davvero (c'è il grassetto)…
  await expect(page.locator('#doc strong')).toHaveCount(1);
  // …ed è stato creato un punto di ripristino etichettato come modifica di Filo.
  const afterVers = await page.evaluate(() => window.__filoEditorVersions.list());
  expect(afterVers.length).toBe(startVers + 1);
  expect(afterVers[afterVers.length - 1].source).toBe('filo');
  expect(afterVers[afterVers.length - 1].label).toMatch(/Filo/);

  // Percorso utente reale: compare l'avviso "Annulla" e cliccandolo il documento
  // torna IDENTICO a prima (testo invariato, grassetto sparito).
  const undoBtn = page.locator('#edToast .ed-toast-action');
  await expect(undoBtn).toHaveText('Annulla');
  await undoBtn.click();
  await expect(page.locator('#doc strong')).toHaveCount(0);
  await expect(page.locator('#doc')).toHaveText(before.trim());
});

test('lo storico delle versioni sopravvive al reload', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  await page.click('#doc');
  await setDocText(page, 'Bianca come il latte');

  await filoAutoEdit(page);
  const idBefore = await page.evaluate(() => window.__filoEditorVersions.activeId());
  const countBefore = await page.evaluate(() => window.__filoEditorVersions.list().length);
  expect(countBefore).toBeGreaterThan(0);

  // Assicura che lo storico sia stato scritto sull'archivio prima di ricaricare.
  await page.evaluate(() => window.__filoEditorVersions.flush());

  await page.reload();
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  // Lo storico è ancora lì per lo stesso file, con lo stesso numero di versioni…
  const countAfter = await page.evaluate((id) => window.__filoEditorVersions.list(id).length, idBefore);
  expect(countAfter).toBe(countBefore);

  // …e la versione è ancora RIPRISTINABILE (riporta lo stato pre-modifica: niente
  // grassetto). Questo prova che il contenuto salvato è sopravvissuto, non solo
  // che esiste una riga di storico.
  await page.evaluate((id) => {
    const v = window.__filoEditorVersions;
    const list = v.list(id);
    v.restore(id, list[0].id);
  }, idBefore);
  await expect(page.locator('#doc strong')).toHaveCount(0);
  await expect(page.locator('#doc')).toContainText('Bianca come il latte');
});

// La SCHERMATA storico versioni (feedback #379): dal menu documenti in alto a
// sinistra si apre il pannello con TUTTE le versioni salvate (recente → vecchia),
// con la sorgente giusta e un'anteprima; ripristinando a mano una versione più
// vecchia il documento torna ESATTAMENTE a quel contenuto. Senza il pannello il
// menu non avrebbe la voce, la lista non comparirebbe e il ripristino "a mano"
// dalla UI non riporterebbe lo stato pre-modifica → rosso.
test('storico versioni: si sfoglia dal menu e ripristina una versione più vecchia', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  // Tre modifiche automatiche di Filo, ciascuna su un testo diverso: ogni edit
  // salva come punto di ripristino il contenuto PRE-modifica (testo semplice).
  await page.click('#doc');
  for (const word of ['Alpha', 'Bravo', 'Charlie']) {
    await setDocText(page, word);
    await filoAutoEdit(page);
  }
  const total = await page.evaluate(() => window.__filoEditorVersions.list().length);
  expect(total).toBe(3);

  // Percorso utente reale: apri il selettore documenti (in alto a sinistra) e la
  // voce "Storico versioni".
  await page.click('#docSwitch');
  await page.click('#docHistory');

  // Il pannello mostra TUTTE e tre le versioni, dalla più recente in alto.
  const items = page.locator('.ed-vh-item');
  await expect(items).toHaveCount(3);
  // Sorgente evidenziata: tutte create da una modifica di Filo.
  await expect(page.locator('.ed-vh-badge.filo')).toHaveCount(3);
  await expect(items.first()).toContainText('Modifica di Filo');
  // Ordine cronologico inverso: in cima l'ultimo stato salvato (il contenuto
  // catturato prima dell'ultima modifica di Filo = "Charlie"), in fondo il più
  // vecchio (= "Alpha").
  await expect(items.first().locator('.ed-vh-prev')).toContainText('Charlie');
  await expect(items.last().locator('.ed-vh-prev')).toContainText('Alpha');

  // Ripristina la versione PIÙ VECCHIA (in fondo): il documento deve tornare
  // ESATTAMENTE a quel contenuto — testo "Alpha", senza il grassetto di Filo.
  await items.last().locator('.ed-vh-restore').click();
  await expect(page.locator('#doc')).toHaveText('Alpha');
  await expect(page.locator('#doc strong')).toHaveCount(0);
});

// L'anteprima ampia prima di ripristinare: clic su una riga apre l'anteprima
// della versione e da lì la si ripristina. Prova che il cammino "guardo poi
// ripristino" porta al contenuto giusto.
test('storico versioni: anteprima di una versione e ripristino dall\'anteprima', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  await page.click('#doc');
  await setDocText(page, 'Testo originale da ritrovare');
  await filoAutoEdit(page);
  await setDocText(page, 'Testo cambiato dopo');
  await filoAutoEdit(page);

  await page.click('#docSwitch');
  await page.click('#docHistory');

  // Apri l'anteprima della versione più vecchia (il testo originale).
  await page.locator('.ed-vh-item').last().click();
  await expect(page.locator('.ed-vh-fulltext')).toContainText('Testo originale da ritrovare');

  // Ripristina dalla schermata di anteprima: il documento torna a quel testo.
  await page.click('#vhRestore');
  await expect(page.locator('#doc')).toContainText('Testo originale da ritrovare');
  await expect(page.locator('#doc strong')).toHaveCount(0);
});

// Snapshot MANUALI (#379): anche una modifica a mano SIGNIFICATIVA deve creare un
// punto di ripristino, così l'utente che scrive/cancella molto e poi vuole
// tornare indietro trova qualcosa nello storico — senza però versionare ogni
// battuta. Questi test asseriscono il SUCCESSO: la versione 'manual' compare col
// contenuto giusto ed è ripristinabile; e una modifica minima NON crea rumore.
async function textLen(page) {
  return page.evaluate(() => (document.getElementById('doc').textContent || '').length);
}

test('una modifica manuale significativa crea un punto di ripristino ripristinabile', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  await page.click('#doc');
  // Stato iniziale a mano: una prima stesura. Nessuna versione ancora.
  await setDocText(page, 'Prima stesura del racconto.');
  expect(await page.evaluate(() => window.__filoEditorVersions.list().length)).toBe(0);

  // L'utente scrive a mano un blocco lungo (ben oltre la soglia anti-rumore) e si
  // ferma: alla pausa (qui forzata dall'hook, come farebbe il debounce) scatta uno
  // snapshot 'manual' che cattura ESATTAMENTE quel contenuto.
  const longText = 'C\'era una volta, in un bosco fitto e silenzioso, una bambina che portava sempre un mantello rosso cucito dalla nonna, e ogni mattina attraversava il sentiero.';
  await setDocText(page, longText);
  const created = await page.evaluate(() => window.__filoEditorVersions.snapshotManual());
  expect(created).not.toBeNull();

  const list = await page.evaluate(() => window.__filoEditorVersions.list());
  expect(list.length).toBe(1);
  expect(list[0].source).toBe('manual');
  expect(list[0].label).toMatch(/manuale/i);

  // Ora l'utente continua a scrivere altro a mano (cambia molto il testo), poi
  // vuole tornare al punto precedente: ripristinando la versione manuale il
  // documento torna ESATTAMENTE a quel contenuto.
  await setDocText(page, 'Testo completamente diverso, molto più corto.');
  await page.evaluate(() => {
    const v = window.__filoEditorVersions;
    const l = v.list();
    v.restore(v.activeId(), l[0].id);
  });
  await expect(page.locator('#doc')).toHaveText(longText);
});

test('micro-modifiche a mano NON creano una raffica di versioni', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  await page.click('#doc');
  await setDocText(page, 'Una riga di testo che resta quasi uguale.');

  // Tante piccole correzioni con valutazione dello snapshot dopo ognuna: nessuna
  // supera la soglia → lo storico resta vuoto (niente rumore).
  for (const t of [
    'Una riga di testo che resta quasi uguale!',
    'Una riga di testo che resta quasi uguale!!',
    'Una riga di testo che resta quasi uguale.',
    'Una riga di testo che resta quasi uguales.',
  ]) {
    await setDocText(page, t);
    await page.evaluate(() => window.__filoEditorVersions.snapshotManual());
  }
  expect(await page.evaluate(() => window.__filoEditorVersions.list().length)).toBe(0);
});

test('cambiando documento si salva la modifica manuale significativa del file lasciato', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  await page.click('#doc');
  const firstId = await page.evaluate(() => window.__filoEditorVersions.activeId());
  const big = 'Appunti di viaggio: partiti all\'alba, abbiamo percorso la costa fino al promontorio, poi ci siamo fermati a mangiare del pane e formaggio guardando il mare aperto.';
  await setDocText(page, big);

  // Cambio documento dal selettore in alto a sinistra: creo un nuovo file. È il
  // confine naturale in cui va salvato un punto di ripristino del file lasciato.
  await page.click('#docSwitch');
  await page.click('#docNew');
  // Sono su un nuovo documento vuoto…
  await expect(page.locator('#doc')).toHaveText('');

  // …e il file precedente ha ora una versione 'manual' con quel contenuto.
  const prev = await page.evaluate((id) => window.__filoEditorVersions.list(id), firstId);
  expect(prev.length).toBe(1);
  expect(prev[0].source).toBe('manual');
});

// ── Il ripristino non deve portarsi via ciò che non è testo (#384) ─────────
// Ripristinare una versione più vecchia sostituiva il file INTERO: tornavano
// indietro anche il nome del documento e i moduli del banco di lavoro (chat
// inclusa), che il pannello non mostra nemmeno. Questi test asseriscono il
// SUCCESSO del confine giusto: il testo torna a quello della versione, il nome e
// la conversazione con Filo restano quelli di adesso. Senza il fix il titolo
// tornerebbe "Bozza" e il riquadro della chat si svuoterebbe → rossi.

// Rinomina il documento attivo dal menu documenti (matita), come farebbe l'utente.
async function renameActiveDoc(page, title) {
  await page.click('#docSwitch');
  await page.locator('.ed-doc-item.active .ed-doc-rename').click();
  const input = page.locator('.ed-doc-item-input');
  await input.fill(title);
  await input.press('Enter');
  await page.click('#docSwitch'); // richiude il menu
}

// Ripristina la versione più vecchia dal pannello "Storico versioni".
async function restoreOldestFromPanel(page) {
  await page.click('#docSwitch');
  await page.click('#docHistory');
  await page.locator('.ed-vh-item').last().locator('.ed-vh-restore').click();
  await page.click('#ovClose'); // il pannello resta aperto: l'utente lo chiude
}

const LUNGO = 'C\'era una volta un bosco fitto e silenzioso, attraversato ogni mattina da una bambina con un mantello rosso cucito dalla nonna, che portava il pane.';

test('ripristinare una versione NON riporta indietro il nome del documento', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  await page.click('#doc');
  await renameActiveDoc(page, 'Bozza');
  await expect(page.locator('#docTitle')).toHaveText('Bozza');

  // Punto di ripristino salvato mentre il documento si chiamava "Bozza".
  await setDocText(page, LUNGO);
  expect(await page.evaluate(() => window.__filoEditorVersions.snapshotManual())).not.toBeNull();

  // Poi l'utente rinomina e continua a scrivere.
  await renameActiveDoc(page, 'Relazione finale');
  await setDocText(page, 'Testo completamente riscritto dopo la rinomina.');

  await restoreOldestFromPanel(page);

  // Il TESTO è tornato a quello della versione…
  await expect(page.locator('#doc')).toHaveText(LUNGO);
  // …ma il nome scelto dopo è ancora lì (nessuna perdita silenziosa).
  await expect(page.locator('#docTitle')).toHaveText('Relazione finale');
});

test('ripristinare una versione NON cancella la conversazione con Filo, nemmeno dopo un riavvio', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  // Punto di ripristino salvato QUANDO LA CHAT ERA VUOTA.
  await page.click('#doc');
  await setDocText(page, LUNGO);
  expect(await page.evaluate(() => window.__filoEditorVersions.snapshotManual())).not.toBeNull();

  // L'utente parla con Filo nel riquadro chat del documento (pagina 2 del banco
  // di lavoro). Senza chiave AI la risposta è un errore: quel che conta è che la
  // conversazione (domanda + risposta) resti nel documento.
  await page.locator('.ed-switch-icon').nth(1).click();
  const chat = page.locator('.ed-module[data-type="chat"]');
  await chat.locator('[data-chat="input"]').fill('Puoi riassumere il testo?');
  await chat.locator('[data-chat="send"]').click();
  await expect(chat.locator('.ed-chat-msg')).toHaveCount(2, { timeout: 30_000 });

  // "Chiudi e riapri Filo": lo storico e il documento si rileggono dal disco —
  // è qui che prima lo snapshot smetteva di condividere i dati col documento
  // vivo e il ripristino svuotava la chat.
  await page.evaluate(() => window.__filoEditorVersions.flush());
  await expect(page.locator('#saveState')).toHaveText('', { timeout: 10_000 });
  await page.reload();
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await page.locator('.ed-switch-icon').nth(1).click();
  await expect(page.locator('.ed-module[data-type="chat"] .ed-chat-msg')).toHaveCount(2);

  // Altro testo, poi ripristino della versione più vecchia.
  await page.click('#doc');
  await setDocText(page, 'Un testo nuovo di zecca scritto dopo il riavvio.');
  await restoreOldestFromPanel(page);

  await expect(page.locator('#doc')).toHaveText(LUNGO);
  // La conversazione è ancora tutta lì.
  await page.locator('.ed-switch-icon').nth(1).click();
  const log = page.locator('.ed-module[data-type="chat"] .ed-chat-msg');
  await expect(log).toHaveCount(2);
  await expect(log.first()).toHaveText('Puoi riassumere il testo?');
});
