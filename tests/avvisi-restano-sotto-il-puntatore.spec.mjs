// #630 — Un avviso in basso a destra non se ne va mentre l'utente ci tiene sopra il puntatore, e la durata
// delle Preferenze vale per tutti gli avvisi, anche quelli disegnati dentro le pagine. Gli avvisi della barra
// hanno il loro spec (avvisi-sopra-pagina, notifications): qui le pile delle pagine.
//
// Prima: «Copiato» e simili sparivano dopo 2,2 s anche col puntatore sopra, ignoravano la durata scelta in
// Preferenze e, trasparenti ai clic, non si potevano chiudere.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const PAGE = `<!doctype html><html><body style="margin:0;padding:24px;font:16px sans-serif;height:100vh">
  <h1>Pagina con un collegamento</h1>
  <a id="link" href="https://example.com/articolo">Un collegamento di prova</a>
</body></html>`;

function shot(page, name) {
  try { mkdirSync('tests/.shots', { recursive: true }); } catch (_) {}
  return page.screenshot({ path: `tests/.shots/${name}.png` }).catch(() => {});
}

// «Copia URL» dal tasto destro vero sul link: produce l'avviso «Copiato» nella pila della pagina.
async function copiaUrl(page) {
  const menu = page.locator('.sn-menu');
  for (let i = 0; i < 6; i++) {
    await page.locator('#link').click({ button: 'right', position: { x: 8, y: 8 } });
    const voce = menu.locator('button', { hasText: 'Copia URL' }).filter({ hasNotText: 'immagine' });
    try {
      await voce.first().waitFor({ state: 'visible', timeout: 1500 });
      await voce.first().click();
      await expect(menu).toHaveCount(0);
      return;
    } catch (_) { await page.waitForTimeout(200); }
  }
  throw new Error('voce «Copia URL» non raggiungibile');
}

// Il puntatore vero sul centro dell'avviso (quando ha finito di entrare).
async function puntatoreSopra(page, locator) {
  await expect(locator).toHaveClass(/sn-toast-visible|show/);
  await page.waitForTimeout(250);
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
}

async function impostaDurata(shell, durationSec) {
  await shell.evaluate((d) => window.filoShell.message({
    type: 'update_settings',
    settings: { notifications: { durationSec: d, soundEnabled: false, sound: 'default' } },
  }), durationSec);
}

test('su una pagina web «Copiato» resta finché il puntatore ci sta sopra, e se ne va poco dopo che esce', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);
  await copiaUrl(page);
  const avviso = page.locator('.sn-toast');
  await expect(avviso).toHaveCount(1);

  await puntatoreSopra(page, avviso);
  // Ben oltre i 2,2 s della sua durata: c'è ancora, e risponde al passaggio.
  await page.waitForTimeout(3500);
  await expect(avviso).toBeVisible();
  const sfondo = await avviso.evaluate((el) => getComputedStyle(el).backgroundColor);
  await shot(page, 'avviso-630-puntatore-sopra');

  await page.mouse.move(40, 40, { steps: 4 });
  await page.waitForTimeout(250);
  const fuori = await avviso.evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => null);
  expect(fuori, 'al passaggio del puntatore l’avviso non dava nessun segno').not.toBe(sfondo);
  // Chi era agli sgoccioli ha ancora un attimo per finire di leggere, poi se ne va da solo.
  await page.waitForTimeout(650);
  await expect(avviso).toBeVisible();
  await expect(avviso).toHaveCount(0, { timeout: 4000 });
});

test('col puntatore su un avviso aspettano anche gli altri della pila', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);
  await copiaUrl(page);
  await copiaUrl(page);
  const avvisi = page.locator('.sn-toast');
  await expect(avvisi).toHaveCount(2);
  await puntatoreSopra(page, avvisi.last());
  await page.waitForTimeout(3500);
  await expect(avvisi, 'l’avviso sopra quello col puntatore è sparito e la pila è scivolata sotto il cursore').toHaveCount(2);
  await page.mouse.move(40, 40, { steps: 4 });
  await expect(avvisi).toHaveCount(0, { timeout: 4500 });
});

test('un clic chiude l’avviso nella pagina', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);
  await copiaUrl(page);
  const avviso = page.locator('.sn-toast');
  await expect(avviso).toHaveCount(1);
  await puntatoreSopra(page, avviso);
  await page.mouse.down();
  await page.mouse.up();
  await expect(avviso).toHaveCount(0, { timeout: 1500 });
});

test('la durata delle Preferenze vale anche per gli avvisi delle pagine, e a 0 restano finché non li chiudi', async ({ shell, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);

  // Il doppio della durata standard: «Copiato» passa da 2,2 a 4,4 s.
  await impostaDurata(shell, 10);
  await page.waitForTimeout(300);
  await copiaUrl(page);
  const avviso = page.locator('.sn-toast');
  await expect(avviso).toHaveCount(1);
  await page.waitForTimeout(3200);
  await expect(avviso, 'la durata scelta in Preferenze non arriva agli avvisi della pagina').toHaveCount(1);
  await expect(avviso).toHaveCount(0, { timeout: 4000 });

  await impostaDurata(shell, 0);
  await page.waitForTimeout(300);
  await copiaUrl(page);
  await expect(avviso).toHaveCount(1);
  await page.waitForTimeout(4000);
  await expect(avviso).toBeVisible();
  await avviso.click();
  await expect(avviso).toHaveCount(0, { timeout: 1500 });
});

test('nella nuova scheda (dove è nata la segnalazione) l’avviso aspetta il puntatore', async ({ openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!(globalThis.SN_POPUP && globalThis.SN_AVVISI), null, { timeout: 8000 });
  // 3 s e non i 2,2 di «Copiato»: a pagina appena aperta l'ingresso può tardare e il puntatore arrivare a tempo scaduto.
  await page.evaluate(() => globalThis.SN_POPUP.showToast('Avviso nella nuova scheda', { duration: 3000 }));
  const avviso = page.locator('.sn-toast', { hasText: 'Avviso nella nuova scheda' });
  await puntatoreSopra(page, avviso);
  await page.waitForTimeout(4500);
  await expect(avviso).toBeVisible();
  await shot(page, 'avviso-630-nuova-scheda');
  await page.mouse.move(20, 300, { steps: 4 });
  await expect(avviso).toHaveCount(0, { timeout: 4000 });
});

// #954 — Nella home l'avviso di un errore della chat compare sopra il tasto Invia appena premuto, sotto un
// puntatore che non si è mosso. Riceveva mouseenter, la pila si fermava per sempre e il clic seguente
// chiudeva l'avviso invece di arrivare alla pagina.
test('un avviso comparso sotto il puntatore fermo se ne va alla sua ora, e il clic dopo arriva alla pagina', async ({ openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!(globalThis.SN_POPUP && globalThis.SN_AVVISI), null, { timeout: 8000 });
  const TESTO = 'La tua chiave OpenRouter non ha più credito: ricarica il tuo conto OpenRouter, oppure riscatta un invito nella pagina Crediti per usare i crediti di Filo.';
  const mostra = (ms) => page.evaluate(([t, d]) => { globalThis.SN_POPUP.showToast(t, { duration: d }); }, [TESTO, ms]);
  const avviso = page.locator('.sn-toast');

  // Dove comparirà: lo si misura con un primo avviso uguale, poi il puntatore aspetta lì, fermo.
  await mostra(0);
  await expect(avviso).toHaveClass(/sn-toast-visible/);
  await page.waitForTimeout(250);
  const b = await avviso.boundingBox();
  await avviso.evaluate((el) => el.click());
  await expect(avviso).toHaveCount(0, { timeout: 1500 });
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y, { steps: 4 });
  await page.evaluate(() => {
    window.__clic954 = null;
    document.addEventListener('click', (e) => { window.__clic954 = e.target.closest('.sn-toast') ? 'avviso' : 'pagina'; }, true);
  });

  await mostra(2000);
  await expect(avviso).toHaveClass(/sn-toast-visible/);
  expect(await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest('.sn-toast'), [x, y]),
    'l’avviso non è comparso sotto il puntatore').toBe(true);
  await shot(page, 'avviso-954-sotto-il-puntatore-fermo');
  await expect(avviso, 'l’avviso comparso sotto il puntatore fermo non se ne va più').toHaveCount(0, { timeout: 4000 });

  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__clic954)).toBe('pagina');

  // Il puntatore che si muove sopra l'avviso lo tiene, come prima.
  await mostra(2000);
  await puntatoreSopra(page, avviso);
  await page.waitForTimeout(3000);
  await expect(avviso).toBeVisible();
});

test('editor: l’avviso con «Annulla» aspetta il puntatore e segue la durata delle Preferenze', async ({ shell, openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  // Durata 1 s: l'avviso con un pulsante (7 s di base) scende a 1,4 s.
  await impostaDurata(shell, 1);
  await page.waitForTimeout(300);
  await page.click('#docSwitch');
  await page.click('#docNew');
  await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item')).toHaveCount(2);
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();
  const avviso = page.locator('.ed-toast.show');
  await expect(avviso).toHaveCount(1);
  await puntatoreSopra(page, avviso);
  await page.waitForTimeout(3000);
  await expect(avviso, 'l’avviso dell’editor se n’è andato col puntatore sopra').toHaveCount(1);
  await page.mouse.move(400, 40, { steps: 4 });
  await expect(page.locator('.ed-toast')).toHaveCount(0, { timeout: 4000 });
});

test('mazzi: l’avviso aspetta il puntatore e un clic lo chiude', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  await page.click('#deckName');
  await page.locator('.dk-switcher .sn-select-option', { hasText: 'Budget' }).click();
  const campo = page.locator('#deckBudgetEdit');
  await campo.pressSequentially('abc');
  await campo.press('Enter');
  const avviso = page.locator('.dk-toast.show');
  await expect(avviso).toBeVisible();
  await puntatoreSopra(page, avviso);
  await page.waitForTimeout(4200);
  await expect(avviso, 'l’avviso dei mazzi se n’è andato col puntatore sopra').toBeVisible();
  await page.mouse.down();
  await page.mouse.up();
  await expect(avviso).toHaveCount(0, { timeout: 1500 });
});

test('tema scuro: l’avviso col puntatore sopra si schiarisce appena e il testo resta leggibile', async ({ shell, openTab }) => {
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!globalThis.SN_POPUP && document.documentElement.dataset.snTheme === 'dark', null, { timeout: 8000 });
  await page.evaluate(() => globalThis.SN_POPUP.showToast('Avviso nel tema scuro', { duration: 0 }));
  const avviso = page.locator('.sn-toast', { hasText: 'Avviso nel tema scuro' });
  await expect(avviso).toHaveClass(/sn-toast-visible/);
  await page.waitForTimeout(250);
  const prima = await avviso.evaluate((el) => getComputedStyle(el).backgroundColor);
  await puntatoreSopra(page, avviso);
  await page.waitForTimeout(250);
  const [sopra, testo] = await avviso.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]);
  await shot(page, 'avviso-630-tema-scuro');
  expect(sopra).not.toBe(prima);
  // Sfondo scuro e testo chiaro anche col puntatore sopra.
  const luce = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  expect(luce(testo) - luce(sopra)).toBeGreaterThan(100);
});

// Prendendo il puntatore l'avviso prende anche il tasto destro: il menu deve essere il suo, come nella barra.
test('tasto destro su un avviso della pagina: il menu offre «Chiudi», e la scelta lo chiude', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);
  await copiaUrl(page);
  const avviso = page.locator('.sn-toast');
  await puntatoreSopra(page, avviso);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  const voci = page.locator('.sn-menu .sn-menu-item');
  await expect(voci).toHaveText(['Chiudi']);
  await voci.first().click();
  await expect(avviso).toHaveCount(0, { timeout: 1500 });
});

test('editor: tasto destro sull’avviso con «Annulla» offre «Annulla» e «Chiudi», e «Annulla» fa quello che fa il pulsante', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#docSwitch');
  await page.click('#docNew');
  await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item')).toHaveCount(2);
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();
  const avviso = page.locator('.ed-toast.show');
  await puntatoreSopra(page, avviso);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  const voci = page.locator('.sn-menu .sn-menu-item');
  await expect(voci).toHaveText([/Annulla/, 'Chiudi']);
  const testo = (await avviso.locator('span').textContent()).trim();
  await voci.first().click();
  await expect(page.locator('.ed-toast', { hasText: testo })).toHaveCount(0, { timeout: 1500 });
  await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item')).toHaveCount(2);
});

test('mazzi: tasto destro sull’avviso offre «Chiudi», e la scelta lo chiude', async ({ openTab }) => {
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await page.click('#deckName');
  await page.locator('.dk-switcher .sn-select-option', { hasText: 'Budget' }).click();
  const campo = page.locator('#deckBudgetEdit');
  await campo.pressSequentially('abc');
  await campo.press('Enter');
  const avviso = page.locator('.dk-toast.show');
  await puntatoreSopra(page, avviso);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  const voci = page.locator('.sn-menu .sn-menu-item');
  await expect(voci).toHaveText(['Chiudi']);
  await voci.first().click();
  await expect(avviso).toHaveCount(0, { timeout: 1500 });
});

// Non solo i toast: tutto ciò che sta nella pila della pagina (qui la conferma di «Salva per dopo») ha il suo menu.
test('tasto destro sulla conferma «Salvata in»: il menu offre «Apri la lista» e «Chiudi», e «Chiudi» la chiude', async ({ openTab }) => {
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(() => !!(globalThis.SN_ACTIONS && globalThis.SN_AVVISI), null, { timeout: 8000 });
  await page.evaluate(() => globalThis.SN_ACTIONS.showSaveConfirm({ id: 'x1', category: 'Lavoro' }, { chiudiScheda: false }));
  const pill = page.locator('.sn-save-confirm');
  await expect(pill).toHaveClass(/sn-save-confirm-visible/);
  await page.waitForTimeout(250);
  const b = await pill.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  const voci = page.locator('.sn-menu .sn-menu-item');
  await expect(voci).toHaveText(['Apri la lista', 'Chiudi']);
  await voci.nth(1).click();
  await expect(pill).toHaveCount(0, { timeout: 1500 });
});
