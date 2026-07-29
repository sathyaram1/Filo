// Verifica l'app Editor: launcher nella shell, render della griglia moduli,
// editor di testo contenteditable e conteggio parole live.

import { test, expect } from './fixtures/electron.mjs';

test('il launcher app apre l\'editor', async ({ shell, openTab }) => {
  // Il bottone app è presente nella barra indirizzi.
  await expect(shell.locator('#nav-apps')).toHaveCount(1);

  // Il menu App è ora un popup nativo (Menu.popup) quindi non ha DOM nella
  // shell. Verifichiamo direttamente che l'editor si apra.
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await expect(page.locator('#doc')).toHaveAttribute('contenteditable', 'true');
});

test('la griglia moduli renderizza switch + moduli e celle vuote', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-grid');
  // Almeno lo switch + il word-count sono sulla pagina iniziale (z=0).
  await expect(page.locator('.ed-module[data-type="switch"]')).toHaveCount(1);
  await expect(page.locator('.ed-module[data-type="word-count"]')).toHaveCount(1);
  // Celle vuote presenti (slot disponibili).
  expect(await page.locator('.ed-cell-empty').count()).toBeGreaterThan(0);
});

test('conteggio parole si aggiorna in tempo reale', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-module[data-type="word-count"] .wc-num');
  await page.click('#doc');
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>uno due tre quattro</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('.ed-module[data-type="word-count"] .wc-num')).toHaveText('4');
});

test('conteggio parole non fonde parole a cavallo dei blocchi', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-module[data-type="word-count"] .wc-num');
  await page.click('#doc');
  // Documento su più paragrafi: 6 parole reali. Prima del fix textContent
  // concatenava i blocchi ("worldFoo", "barapple"…) e contava solo 3.
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>Hello world</p><p>Foo bar</p><p>apple</p><p>banana</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('.ed-module[data-type="word-count"] .wc-num')).toHaveText('6');

  // Anche con elenchi puntati e <br> le parole non si fondono.
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<ul><li>primo punto</li><li>secondo punto</li></ul><p>uno<br>due</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('.ed-module[data-type="word-count"] .wc-num')).toHaveText('6');
});

test('statistiche di un documento vuoto sono tutte a zero', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-module[data-type="word-count"] .wc-num');
  // Documento vuoto: apri "Statistiche documento" cliccando il conteggio.
  await page.click('.ed-module[data-type="word-count"] .ed-mod-pad');
  const rows = page.locator('.ed-stat-row');
  await expect(rows).toHaveCount(5);
  // Ogni metrica è 0 — incluso Paragrafi (prima mostrava 1 per il <p> vuoto)
  // e Tempo di lettura (prima forzato a ~1 min).
  await expect(page.locator('.ed-stat-row', { hasText: 'Parole' }).locator('.v')).toHaveText('0');
  await expect(page.locator('.ed-stat-row', { hasText: 'Caratteri' }).locator('.v')).toHaveText('0');
  await expect(page.locator('.ed-stat-row', { hasText: 'Frasi' }).locator('.v')).toHaveText('0');
  await expect(page.locator('.ed-stat-row', { hasText: 'Paragrafi' }).locator('.v')).toHaveText('0');
  await expect(page.locator('.ed-stat-row', { hasText: 'Tempo di lettura' }).locator('.v')).toHaveText('~0 min');
});

test('token di sola punteggiatura non contano come parole', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-module[data-type="word-count"] .wc-num');
  await page.click('#doc');
  // Solo punteggiatura: prima del fix ",,, ..." contava 2 parole.
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>,,, ...</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('.ed-module[data-type="word-count"] .wc-num')).toHaveText('0');
  // Mescolando parole e punteggiatura conta solo le parole reali.
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>ciao , mondo ... !</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('.ed-module[data-type="word-count"] .wc-num')).toHaveText('2');
});

test('cambio pagina via switch mostra moduli della pagina 1', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-module[data-type="switch"]');
  // pagina 0 attiva: niente chat
  await expect(page.locator('.ed-module[data-type="chat"]')).toHaveCount(0);
  // clic sulla seconda icona dello switch → pagina 1 (Revisione)
  await page.locator('.ed-switch-icon').nth(1).click();
  await expect(page.locator('.ed-module[data-type="chat"]')).toHaveCount(1);
  await expect(page.locator('.ed-module[data-type="search-replace"]')).toHaveCount(1);
});

// Feedback #310: "Sostituisci" (uno) deve avanzare alla corrispondenza
// successiva e NON ri-matchare dentro il testo appena inserito. Prima del fix
// la ricerca veniva rilanciata da capo dopo ogni sostituzione: con cerca "cat"
// e sostituisci "cats" tre click producevano "catsss cat cat" invece di
// "cats cats cats".
test('Sostituisci (uno) avanza alla successiva e non ri-matcha la sostituzione', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>cat cat cat</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  // Pagina Revisione (seconda icona dello switch) → modulo cerca e sostituisci.
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('[data-sr="find"]');
  await page.fill('[data-sr="find"]', 'cat');
  await page.fill('[data-sr="repl"]', 'cats');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/3');

  // 1° click: sostituita la prima, la selezione avanza alla successiva
  // (2 rimaste, corrente è la prima delle rimaste) — niente reset né re-match.
  await page.click('[data-sr="one"]');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/2');
  await page.click('[data-sr="one"]');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/1');
  await page.click('[data-sr="one"]');
  await expect(page.locator('[data-sr="count"]')).toHaveText('nessun risultato');

  // Successo: tutte e tre le occorrenze sostituite una per volta.
  await expect(page.locator('#doc')).toHaveText('cats cats cats');
});

// Sostituendo una corrispondenza a metà documento la posizione non torna in
// cima: la corrente diventa quella subito dopo la sostituita.
test('Sostituisci (uno) a metà documento mantiene la posizione', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>foo uno foo due foo tre</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('[data-sr="find"]');
  await page.fill('[data-sr="find"]', 'foo');
  await page.fill('[data-sr="repl"]', 'bar');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/3');
  // Avanza alla seconda corrispondenza e sostituisci quella.
  await page.click('[data-sr="next"]');
  await expect(page.locator('[data-sr="count"]')).toHaveText('2/3');
  await page.click('[data-sr="one"]');
  // La corrente ora è la (ex) terza: contatore 2/2, non 1/2 (reset in cima).
  await expect(page.locator('[data-sr="count"]')).toHaveText('2/2');
  await expect(page.locator('#doc')).toHaveText('foo uno bar due foo tre');
  // La corrispondenza evidenziata come corrente è l'ultima ("foo tre").
  const currentIsLast = await page.evaluate(() => {
    const hits = [...document.querySelectorAll('mark.ed-find-hit')];
    return hits.length === 2 && hits[1].classList.contains('current');
  });
  expect(currentIsLast).toBe(true);
});

// Feedback #228: una parola spezzata da formattazione inline (una parte in
// grassetto) vive in più nodi testo ("al" + "fa"). Prima del fix la ricerca
// scorreva nodo per nodo: nessun nodo conteneva la parola intera, quindi quella
// occorrenza non veniva né contata né sostituita — "Sostituisci tutto" lasciava
// parole nel testo senza avvisare. Ora la ricerca lavora sul testo concatenato
// del blocco e mappa gli offset ai nodi.
test('Cerca e sostituisci trova le parole con formattazione mista (#228)', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    // "Nome: alfa, alfa e alfa." con la SOLA parte "fa" dell'ultima "alfa" in grassetto.
    doc.innerHTML = '<p>Nome: alfa, alfa e al<strong>fa</strong>.</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('[data-sr="find"]');
  await page.fill('[data-sr="find"]', 'alfa');
  // Tutte e tre le occorrenze trovate, compresa quella spezzata dal grassetto.
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/3');
  // "Sostituisci tutto" non deve lasciare nessuna "alfa" nel testo.
  await page.fill('[data-sr="repl"]', 'OMEGA');
  await page.click('[data-sr="all"]');
  await expect(page.locator('#doc')).toHaveText('Nome: OMEGA, OMEGA e OMEGA.');
  await expect(page.locator('[data-sr="count"]')).toHaveText('nessun risultato');
});
