// VERIFICA avversariale feedback #385 (verifier — NON committare come spec di prodotto).
// Sintomo utente: cercando una parola dentro una sezione chiusa il contatore
// dice "1/1" ma sul foglio non si illumina niente; e "Sostituisci tutto"
// cambia la parola di nascosto.
import { test, expect } from './fixtures/electron.mjs';

// Costruisce il documento dei passi utente e chiude la sezione indicata
// cliccando davvero la freccia accanto al titolo (non manipolando lo stato).
async function setupDoc(page, html) {
  await page.waitForSelector('#doc');
  await page.evaluate((h) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = h;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, html);
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('[data-sr="find"]');
}

// Clicca la freccia del titolo il cui testo contiene `label`.
async function clickArrow(page, label) {
  await page.evaluate((lb) => {
    const h = [...document.querySelectorAll('#doc h1, #doc h2, #doc h3')]
      .find((x) => x.textContent.includes(lb));
    h.querySelector('.ed-collapse-toggle').click();
  }, label);
}

// true se la corrispondenza corrente è davvero VISIBILE (box non nullo).
async function currentHitVisible(page) {
  return page.evaluate(() => {
    const mk = document.querySelector('#doc mark.ed-find-hit.current');
    if (!mk) return { found: false };
    const r = mk.getBoundingClientRect();
    const cs = getComputedStyle(mk);
    return { found: true, w: r.width, h: r.height, display: cs.display, text: mk.textContent };
  });
}

test('#385 passi utente: la parola in sezione chiusa viene mostrata, non solo contata', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await setupDoc(page, '<h2>Introduzione</h2><p>Una riga qualsiasi.</p>'
    + '<h2>Capitolo segreto</h2><p>Qui dentro si parla di ornitorinco</p>');

  // 3. chiudo "Capitolo segreto": il testo sparisce dalla vista
  await clickArrow(page, 'Capitolo segreto');
  await expect(page.locator('#doc p', { hasText: 'ornitorinco' })).toBeHidden();

  // 4. cerco "ornitorinco": contatore 1/1 E la parola si deve VEDERE evidenziata
  await page.fill('[data-sr="find"]', 'ornitorinco');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/1');
  const vis = await currentHitVisible(page);
  expect(vis.found).toBe(true);
  expect(vis.w).toBeGreaterThan(0);
  expect(vis.h).toBeGreaterThan(0);
  expect(vis.text).toBe('ornitorinco');
  // la sezione risulta aperta anche alla freccia (coerenza dell'indicatore)
  const arrowOpen = await page.evaluate(() => {
    const h = [...document.querySelectorAll('#doc h2')].find((x) => x.textContent.includes('Capitolo segreto'));
    return !h.querySelector('.ed-collapse-toggle').classList.contains('is-collapsed')
      && h.dataset.collapsed !== '1';
  });
  expect(arrowOpen).toBe(true);
  await page.screenshot({ path: 'tests/.shots/v385-reveal.png' });

  // 5. sostituisco con "canguro" e premo "Tutto": la riga cambiata deve essere in chiaro
  await page.fill('[data-sr="repl"]', 'canguro');
  await page.click('[data-sr="all"]');
  await expect(page.locator('#doc p', { hasText: 'canguro' })).toBeVisible();
  await expect(page.locator('#doc')).toContainText('Qui dentro si parla di canguro');
  await page.screenshot({ path: 'tests/.shots/v385-replace-all.png' });
});

test('#385 "Sostituisci tutto" senza mai cercare prima: niente cambi invisibili', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await setupDoc(page, '<h2>Uno</h2><p>alfa qui</p><h2>Due</h2><p>alfa nascosto</p><h2>Tre</h2><p>alfa la</p>');
  await clickArrow(page, 'Due');
  await clickArrow(page, 'Tre');
  await expect(page.locator('#doc p', { hasText: 'alfa nascosto' })).toBeHidden();
  // L'utente digita direttamente cerca+sostituisci e preme Tutto.
  await page.fill('[data-sr="find"]', 'alfa');
  await page.fill('[data-sr="repl"]', 'beta');
  await page.click('[data-sr="all"]');
  // Tutte e tre le righe toccate devono essere sotto gli occhi dell'utente.
  for (const t of ['beta qui', 'beta nascosto', 'beta la']) {
    await expect(page.locator('#doc p', { hasText: t })).toBeVisible();
  }
  await expect(page.locator('#doc')).not.toContainText('alfa');
});

test('#385 Prec/Succ portano davvero sulle corrispondenze nascoste', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await setupDoc(page, '<h2>A</h2><p>zeta uno</p><h2>B</h2><p>zeta due</p><h2>C</h2><p>zeta tre</p>');
  await clickArrow(page, 'B');
  await clickArrow(page, 'C');
  await page.fill('[data-sr="find"]', 'zeta');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/3');
  // 1ª è visibile; B e C sono chiuse e devono aprirsi arrivandoci sopra.
  await page.click('[data-sr="next"]');
  await expect(page.locator('[data-sr="count"]')).toHaveText('2/3');
  let v = await currentHitVisible(page);
  expect(v.w).toBeGreaterThan(0);
  // C resta chiusa: si apre solo quella che serve
  await expect(page.locator('#doc p', { hasText: 'zeta tre' })).toBeHidden();
  await page.click('[data-sr="next"]');
  await expect(page.locator('[data-sr="count"]')).toHaveText('3/3');
  v = await currentHitVisible(page);
  expect(v.w).toBeGreaterThan(0);
  // Prec torna indietro e resta su qualcosa di visibile
  await page.click('[data-sr="prev"]');
  await expect(page.locator('[data-sr="count"]')).toHaveText('2/3');
  v = await currentHitVisible(page);
  expect(v.w).toBeGreaterThan(0);
});

test('#385 annidato: si apre solo la catena che nasconde la parola', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await setupDoc(page, '<h1>Libro</h1><p>intro libro</p>'
    + '<h2>Cap 1</h2><p>testo cap1</p>'
    + '<h3>Par 1.1</h3><p>qui vive ornitorinco</p>'
    + '<h3>Par 1.2</h3><p>altro paragrafo</p>'
    + '<h2>Cap 2</h2><p>testo cap2</p>');
  // chiudo il paragrafo 1.2, poi il cap 1, poi tutto il libro
  await clickArrow(page, 'Par 1.2');
  await clickArrow(page, 'Cap 1');
  await clickArrow(page, 'Libro');
  await expect(page.locator('#doc p', { hasText: 'ornitorinco' })).toBeHidden();
  await page.fill('[data-sr="find"]', 'ornitorinco');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/1');
  const v = await currentHitVisible(page);
  expect(v.w).toBeGreaterThan(0);
  // Non si spalanca tutto: "Par 1.2", chiuso dall'utente, resta chiuso
  await expect(page.locator('#doc p', { hasText: 'altro paragrafo' })).toBeHidden();
  // e la freccia di Par 1.2 lo mostra ancora chiuso
  const stillClosed = await page.evaluate(() => {
    const h = [...document.querySelectorAll('#doc h3')].find((x) => x.textContent.includes('Par 1.2'));
    return h.dataset.collapsed === '1' && h.querySelector('.ed-collapse-toggle').classList.contains('is-collapsed');
  });
  expect(stillClosed).toBe(true);
});

test('#385 stress: campi vuoti, spazi, 10k caratteri, emoji, HTML, doppio click', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  const big = 'lorem '.repeat(1600); // ~9600 caratteri
  await setupDoc(page, `<h2>Grande</h2><p>${big}ago</p><h2>Speciali</h2><p>ciao 🦆 emoji e &lt;script&gt;alert(1)&lt;/script&gt; qui</p>`);
  await clickArrow(page, 'Grande');
  await clickArrow(page, 'Speciali');

  // campo vuoto → nessun crash, nessun conteggio
  await page.fill('[data-sr="find"]', '');
  await expect(page.locator('[data-sr="count"]')).toHaveText('');
  // solo spazi
  await page.fill('[data-sr="find"]', '   ');
  await page.waitForTimeout(200);
  // documento da 10k in sezione chiusa: la parola in fondo si trova e si vede
  await page.fill('[data-sr="find"]', 'ago');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/1');
  let v = await currentHitVisible(page);
  expect(v.w).toBeGreaterThan(0);

  // emoji dentro l'altra sezione chiusa
  await page.fill('[data-sr="find"]', '🦆');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/1');
  v = await currentHitVisible(page);
  expect(v.w).toBeGreaterThan(0);

  // sostituzione con HTML: deve restare TESTO, non diventare markup eseguibile
  await page.fill('[data-sr="find"]', 'emoji');
  await page.fill('[data-sr="repl"]', '<script>window.__pwned=1</script>');
  await page.click('[data-sr="all"]');
  const pwned = await page.evaluate(() => ({
    pwned: !!window.__pwned,
    scripts: document.querySelectorAll('#doc script').length,
    hasText: document.getElementById('doc').textContent.includes('<script>window.__pwned=1</script>'),
  }));
  expect(pwned.pwned).toBe(false);
  expect(pwned.scripts).toBe(0);
  expect(pwned.hasText).toBe(true);

  // doppio click rapido su "Tutto" e su next: nessun crash, la pagina risponde
  await page.fill('[data-sr="find"]', 'lorem');
  await page.click('[data-sr="all"]', { clickCount: 2 });
  await page.click('[data-sr="next"]');
  await page.click('[data-sr="next"]');
  await expect(page.locator('#doc')).toBeVisible();
});

test('#385 sequenza inusuale: chiudi/riapri ripetuto e ricerca durante il ciclo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await setupDoc(page, '<h2>Sez</h2><p>parola magica</p>');
  for (let i = 0; i < 5; i++) {
    await clickArrow(page, 'Sez');
    await clickArrow(page, 'Sez');
  }
  await clickArrow(page, 'Sez'); // chiusa
  await expect(page.locator('#doc p', { hasText: 'parola magica' })).toBeHidden();
  await page.fill('[data-sr="find"]', 'magica');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/1');
  const v = await currentHitVisible(page);
  expect(v.w).toBeGreaterThan(0);
  // richiudo a mano dopo la ricerca: deve richiudersi davvero (stato coerente)
  await clickArrow(page, 'Sez');
  await expect(page.locator('#doc p', { hasText: 'magica' })).toBeHidden();
});

test('#385 dopo la sostituzione il testo resta visibile anche digitando', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await setupDoc(page, '<h2>Chiusa</h2><p>ornitorinco qui</p>');
  await clickArrow(page, 'Chiusa');
  await page.fill('[data-sr="find"]', 'ornitorinco');
  await page.fill('[data-sr="repl"]', 'canguro');
  await page.click('[data-sr="all"]');
  await expect(page.locator('#doc p', { hasText: 'canguro' })).toBeVisible();
  // Digitare nel foglio (che ricrea le frecce) non deve far risparire la riga
  await page.click('#doc');
  await page.keyboard.type('x');
  await expect(page.locator('#doc p', { hasText: 'canguro' })).toBeVisible();
});

test('#385 "Sostituisci" singolo su corrispondenza nascosta avviene in chiaro', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await setupDoc(page, '<h2>Vis</h2><p>tigre uno</p><h2>Nasc</h2><p>tigre due</p>');
  await clickArrow(page, 'Nasc');
  await page.fill('[data-sr="find"]', 'tigre');
  await page.fill('[data-sr="repl"]', 'leone');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/2');
  await page.click('[data-sr="one"]');          // sostituisce la 1ª, avanza sulla 2ª (nascosta)
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/1');
  const v = await currentHitVisible(page);
  expect(v.w).toBeGreaterThan(0);               // la 2ª è stata mostrata
  await page.click('[data-sr="one"]');
  await expect(page.locator('#doc p', { hasText: 'leone due' })).toBeVisible();
});
