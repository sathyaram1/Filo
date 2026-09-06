// Feedback #256, terzo giro: la pagina della cronologia appunti deve dire la
// verità MENTRE è aperta, non solo nell'istante in cui la apri.
//
// La cronologia cresce altrove (ogni copia, in qualunque scheda) e si accorcia
// altrove (il "×" del menu "Incolla"). La pagina la rileggeva solo quando la
// scheda tornava visibile, ma cambiare scheda in Filo NON spegne la pagina di
// prima: quel momento non arrivava mai e la lista restava ferma. Su una pagina
// che si apre per controllare cosa Filo tiene da parte, mostrare meno del vero
// fa concludere che una password non c'è mentre c'è.
//
// Qui si asserisce il successo dal punto di vista dell'utente: la voce copiata
// in un'altra scheda COMPARE nella pagina già aperta; la voce tolta dal menu
// SPARISCE dalla pagina già aperta. In più: la ricerca fra le voci e
// l'etichetta di una voce fatta di soli spazi.
// Pre-fix: il primo assert è rosso (la password non compare mai).

import { test, expect } from './fixtures/electron.mjs';

async function push(app, text) {
  await app.evaluate(async (_e, t) => {
    const MSG = globalThis.SN_MSG.MSG;
    await globalThis.SN_HANDLE_MESSAGE(
      { type: MSG.PUSH_CLIPBOARD_ENTRY, entry: { type: 'text', text: t } },
      { url: 'https://example.com/page' },
    );
  }, text);
}

async function stored(app) {
  return app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    const res = await globalThis.SN_HANDLE_MESSAGE(
      { type: MSG.GET_CLIPBOARD_HISTORY },
      { url: 'filo://security/security.html' },
    );
    return (res.items || []).map((e) => e.text);
  });
}

test('Sicurezza: una copia fatta in un\'altra scheda compare nella pagina già aperta', async ({ app, shell, openTab, testServer }) => {
  void shell;
  await push(app, 'voce iniziale');
  const pagina = await openTab('filo://security/');
  await expect(pagina.locator('#sec-clip-list .sn-clip-item')).toHaveCount(1, { timeout: 10_000 });

  // L'utente va su un'altra scheda e lì copia una password.
  await testServer.openReady(
    openTab,
    '<!doctype html><html><body style="padding:40px"><p>una pagina qualunque</p></body></html>',
  );
  await push(app, 'password-copiata-nel-frattempo');

  // La pagina, ancora aperta, la mostra da sola.
  await expect(pagina.locator('#sec-clip-list')).toContainText('password-copiata-nel-frattempo', { timeout: 8_000 });
  await expect(pagina.locator('#sec-clip-list .sn-clip-item')).toHaveCount(2);
});

test('Sicurezza: la voce tolta dal menu "Incolla" sparisce dalla pagina già aperta', async ({ app, shell, openTab, testServer }) => {
  void shell;
  await push(app, 'testo qualunque');
  await push(app, 'segreto-condiviso');
  const pagina = await openTab('filo://security/');
  await expect(pagina.locator('#sec-clip-list .sn-clip-item')).toHaveCount(2, { timeout: 10_000 });

  const web = await testServer.openReady(
    openTab,
    '<!doctype html><html><body style="padding:40px"><textarea id="ta" rows="4" cols="50"></textarea></body></html>',
  );
  await web.locator('#ta').click({ button: 'right' });
  await expect(web.locator('.sn-menu')).toBeVisible();
  await web.locator('.sn-menu-paste-arrow').click();
  const sub = web.locator('.sn-menu-history-sub');
  await expect(sub).toBeVisible();
  await sub.locator('.sn-menu-history-item', { hasText: 'segreto-condiviso' })
    .locator('.sn-menu-history-remove').click();
  await expect.poll(() => stored(app)).toEqual(['testo qualunque']);

  // La pagina aperta si riallinea da sola, senza ricaricarla.
  await expect(pagina.locator('#sec-clip-list')).not.toContainText('segreto-condiviso', { timeout: 8_000 });
  await expect(pagina.locator('#sec-clip-list .sn-clip-item')).toHaveCount(1);
});

test('Sicurezza: la ricerca trova la voce fra le tante, e dice quando non c\'è', async ({ app, shell, openTab }) => {
  void shell;
  for (let i = 0; i < 20; i++) await push(app, `testo copiato numero ${i}`);
  await push(app, 'la-password-della-banca');
  const pagina = await openTab('filo://security/');
  const righe = pagina.locator('#sec-clip-list .sn-clip-item');
  await expect(righe).toHaveCount(21, { timeout: 10_000 });

  const cerca = pagina.locator('#sec-clip-search');
  await expect(cerca).toBeVisible();
  await cerca.fill('banca');
  await expect(righe.locator('visible=true')).toHaveCount(1);
  await expect(pagina.locator('#sec-clip-list .sn-clip-item:visible')).toContainText('la-password-della-banca');

  // Si toglie proprio quella, mentre il filtro è acceso. La riga resta al suo
  // posto barrata finché il puntatore è sulla lista (#256 giro 4).
  await pagina.locator('#sec-clip-list .sn-clip-item:visible .sn-clip-remove').click();
  await expect(pagina.locator('#sec-clip-list .sn-clip-item.sn-clip-gone')).toHaveCount(1);
  await expect.poll(() => stored(app)).not.toContain('la-password-della-banca');
  await pagina.mouse.move(5, 5);
  await expect(pagina.locator('#sec-clip-noresults')).toBeVisible();

  // Svuotato il campo, tornano tutte le altre.
  await cerca.fill('');
  await expect(righe).toHaveCount(20);

  // Nessuna corrispondenza: la pagina lo dice invece di mostrare il vuoto.
  await cerca.fill('zzz-non-esiste');
  await expect(pagina.locator('#sec-clip-noresults')).toBeVisible();
});

test('Sicurezza: una voce fatta di soli spazi si riconosce invece di essere una riga vuota', async ({ app, shell, openTab }) => {
  void shell;
  await push(app, '     ');
  const pagina = await openTab('filo://security/');
  const riga = pagina.locator('#sec-clip-list .sn-clip-item');
  await expect(riga).toHaveCount(1, { timeout: 10_000 });
  await expect(riga.locator('.sn-clip-text')).toHaveText(/Spazi vuoti \(5 caratteri\)/);
});

test('Sicurezza: i tasti della cronologia prendono il tema scuro, non restano bianchi', async ({ app, shell, openTab }) => {
  void shell;
  await app.evaluate(async () => {
    await globalThis.__filoStorage.set({ settings: { theme: 'dark' } });
  });
  await push(app, 'una voce qualunque');
  const pagina = await openTab('filo://security/');
  await expect(pagina.locator('#sec-clip-list .sn-clip-item')).toHaveCount(1, { timeout: 10_000 });

  const lum = await pagina.evaluate(() => {
    const parse = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
    const l = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    const bg = l(parse(getComputedStyle(document.body).backgroundColor));
    const rm = l(parse(getComputedStyle(document.querySelector('.sn-clip-remove')).backgroundColor));
    const clear = l(parse(getComputedStyle(document.getElementById('sec-clip-clear')).backgroundColor));
    return { bg, rm, clear };
  });
  // Su una pagina scura un tasto non deve essere una macchia chiara: il suo
  // fondo sta vicino a quello della pagina, non al bianco.
  expect(lum.bg).toBeLessThan(0.4);
  expect(Math.abs(lum.rm - lum.bg), 'il tasto Rimuovi segue il fondo scuro').toBeLessThan(0.25);
  expect(Math.abs(lum.clear - lum.bg), 'il tasto Svuota segue il fondo scuro').toBeLessThan(0.25);
  await pagina.locator('#sec-clipboard').screenshot({ path: 'tests/.shots/256-clipboard-scuro-tasti.png' });
});
