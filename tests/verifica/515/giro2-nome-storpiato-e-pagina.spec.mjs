// Verifica #515 — giro 2.
//
// Il giro 1 ha chiuso le porte principali: il prompt promette solo il documento
// che esiste, un documento chiesto per nome e non scritto riceve un no
// esplicito, e la pagina non mette un altro documento al posto di quello
// chiesto. Qui si guarda il nome del documento quando NON arriva pulito: la
// stessa parola scritta in un altro modo, e tutto quello che un indirizzo può
// contenere.
//
// Perché conta: il nome passa per due strade diverse (la chat e l'indirizzo
// della pagina) e le due non lo trattano allo stesso modo.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = 'filo://transparency/transparency.html';

async function idEsistente(app) {
  const ids = await app.evaluate(() => globalThis.SN_TRANSPARENCY.ids());
  expect(ids.length, 'nessun documento di trasparenza: il test non prova niente').toBeGreaterThan(0);
  return ids[0];
}

test('la pagina riconosce il documento che esiste anche scritto con le maiuscole', async ({ app, openTab }) => {
  const id = await idEsistente(app);
  const titoloVero = await app.evaluate((_e, i) => globalThis.SN_TRANSPARENCY.get(i).title, id);

  // La chat accetta «MODELS», « models » e «Models»: il nome lo normalizza.
  // L'indirizzo della pagina è l'altra strada per lo stesso documento, e un
  // link scritto a mano (o ricopiato da qualcuno) può benissimo avere una
  // maiuscola. Dire che quel documento «non esiste» è falso: esiste.
  for (const forma of [id.toUpperCase(), id[0].toUpperCase() + id.slice(1)]) {
    const page = await openTab(`${PAGINA}?doc=${encodeURIComponent(forma)}`);
    await expect(page.locator('#title')).toBeVisible({ timeout: 10_000 });
    const titolo = (await page.locator('#title').textContent() || '').trim();
    const sotto = (await page.locator('#subtitle').textContent() || '').trim();
    expect(titolo, `"${forma}" è lo stesso documento di "${id}", ma la pagina mostra «${titolo}»`).toBe(titoloVero);
    expect(sotto.toLowerCase(), `"${forma}": la pagina dice che la sezione non esiste`)
      .not.toMatch(/non esiste|non è ancora scritta/);
  }
});

test('la chat riconosce lo stesso nome scritto in un altro modo', async ({ app }) => {
  const id = await idEsistente(app);
  const titoloVero = await app.evaluate((_e, i) => globalThis.SN_TRANSPARENCY.get(i).title, id);
  for (const forma of [id.toUpperCase(), `  ${id}  `, `${id.toUpperCase()}`]) {
    const testo = await app.evaluate((_e, f) => globalThis.SN_TRANSPARENCY.asText(f), forma);
    expect(testo, `"${forma}" non riconosciuto dalla chat`).toContain(titoloVero);
    expect(testo).not.toContain('NON esiste');
  }
});

test('un indirizzo con dentro di tutto non rompe la pagina e non lascia senza via d\'uscita', async ({ app, openTab }) => {
  const id = await idEsistente(app);
  const cattivi = [
    ['markup', '<script>window.__bucato = 1;</script>'],
    ['indirizzo javascript', 'javascript:alert(1)'],
    ['attributo che esegue', '"><img src=x onerror="window.__bucato=1">'],
    ['diecimila caratteri', 'a'.repeat(10_000)],
    ['soli spazi', '   '],
    ['emoji', '🙂🙂🙂'],
    ['un a capo dentro il nome', `${id}\n${id}`],
  ];
  const guai = [];
  for (const [nome, cattivo] of cattivi) {
    const page = await openTab(`${PAGINA}?doc=${encodeURIComponent(cattivo)}`);
    await expect(page.locator('#title')).toBeVisible({ timeout: 10_000 });

    const bucato = await page.evaluate(() => !!window.__bucato);
    expect(bucato, `${nome}: ha eseguito codice nella pagina`).toBe(false);
    const script = await page.locator('#doc-body script, #title script, #subtitle script').count();
    expect(script, `${nome}: del markup chiesto nell'indirizzo è finito nella pagina`).toBe(0);

    // Sempre una via d'uscita verso quello che c'è scritto davvero.
    const uscita = await page.locator(`#doc-body a[href*="doc=${id}"], #nav a[href*="doc=${id}"]`).count();
    if (!uscita) guai.push(`${nome}: nessun modo di arrivare al documento che esiste`);

    // E la pagina non sborda in orizzontale per colpa di un nome lunghissimo.
    const sborda = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    if (sborda) {
      await page.screenshot({ path: 'tests/.shots/515-giro2-sborda.png' });
      guai.push(`${nome}: la pagina sborda in orizzontale`);
    }
  }
  expect(guai, guai.join(' | ')).toEqual([]);
});

test('la sezione non scritta chiesta nell\'indirizzo si legge anche col tema scuro', async ({ app, openTab }) => {
  const esistenti = await app.evaluate(() => globalThis.SN_TRANSPARENCY.ids());
  const previsti = await app.evaluate(() => globalThis.SN_TRANSPARENCY.NAV.map((n) => n.id));
  const mancante = previsti.find((i) => !esistenti.includes(i));
  test.skip(!mancante, 'tutte le sezioni hanno il loro documento');

  const page = await openTab(`${PAGINA}?doc=${mancante}`);
  await expect(page.locator('#title')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => window.SN_PAGE_BOOTSTRAP.applyTheme('dark'));
  await page.screenshot({ path: 'tests/.shots/515-giro2-mancante-scuro.png' });
  await page.evaluate(() => window.SN_PAGE_BOOTSTRAP.applyTheme('light'));
  await page.screenshot({ path: 'tests/.shots/515-giro2-mancante-chiaro.png' });

  // La pagina deve dire, in un modo o nell'altro, che quella sezione non c'è.
  const sotto = (await page.locator('#subtitle').textContent() || '').trim();
  expect(sotto.toLowerCase()).toMatch(/non/);
});
