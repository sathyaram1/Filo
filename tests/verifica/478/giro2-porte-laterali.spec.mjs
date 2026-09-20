// Verifica #478, giro 2 — le porte che il giro 1 non ha aperto.
//
// IL SINTOMO segnalato: la bacheca dice «Nessun miglioramento da verificare per
// ora» anche con fix già usciti, perché decideva cosa mostrare leggendo lo
// stato cifrato invece della scheda pubblica già ripulita. Il risultato voluto:
// i miglioramenti si vedono E l'utente può votare se funzionano.
//
// Il giro 1 ha coperto: schede oltre la prima pagina, titolo ostile, storico
// senza versione, versione futura, doppio clic, i due temi (col rilievo sul
// numero del voto, poi corretto). Qui si prova quello che resta, tutto sul
// gesto per cui la bacheca esiste — votare:
//   · il voto che NON arriva al server: cosa vede chi ha cliccato;
//   · il voto di chi non è connesso e non completa l'accesso;
//   · il rosso del form «Ancora rotto?», l'ultimo colore della pagina scritto
//     a mano uguale nei due temi (è la stessa famiglia del rilievo del giro 1);
//   · un titolo di soli spazi e schede senza voti.
//
// Si rilanciano con `npx playwright test tests/verifica/478`.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://board/board.html';
const VERSIONE = '0.2.71';

function scheda(over = {}) {
  return {
    _id: 'fb-base',
    name: 'Cattura schermo più rapida',
    seq: 478,
    subSeq: 0,
    status: 'done',
    statusPublic: 'closed',
    resolvedInVersion: '0.2.70',
    createdAt: '2026-08-17T07:33:44.390Z',
    resolvedAt: '2026-09-01T10:00:00.000Z',
    ...over,
  };
}

// Apre la bacheca e le mette in mano delle schede già pronte, come se fossero
// arrivate dalla vista pubblica (che è il punto della segnalazione: la pagina
// legge quella, non i campi cifrati).
async function apri(openTab, schede, { signedIn = null, versione = VERSIONE } = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__boardTest && window.SN_FEEDBACK, null, { timeout: 15_000 });
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 20_000 });
  await page.evaluate((v) => window.__boardTest.setReleasedVersion(v), versione);
  if (signedIn) await page.evaluate((u) => window.__boardTest.setSignedIn(u), signedIn);
  await page.evaluate((s) => window.__boardTest.setData(s), schede);
  return page;
}

// Il contrasto fra due colori, come lo misura chi guarda: WCAG 2.
function contrasto(a, b) {
  const lum = (c) => {
    const v = c.map((x) => {
      const s = x / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Testo e fondo VERI di un elemento: il fondo è il suo colore semitrasparente
// steso sopra il primo antenato con un colore pieno (le schede della bacheca
// sono trasparenti, prenderle per bianche falserebbe il conto nel tema scuro).
const LEGGI_COLORI = (el) => {
  const num = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  const opaco = (n) => (n.length < 4 || n[3] >= 1);
  let sotto = [255, 255, 255];
  for (let p = el.parentElement; p; p = p.parentElement) {
    const n = num(getComputedStyle(p).backgroundColor);
    if (n.length >= 3 && opaco(n)) { sotto = n.slice(0, 3); break; }
  }
  const suo = num(getComputedStyle(el).backgroundColor);
  const a = suo.length > 3 ? suo[3] : 1;
  const misto = [0, 1, 2].map((i) => Math.round(suo[i] * a + sotto[i] * (1 - a)));
  return { testo: num(getComputedStyle(el).color).slice(0, 3), fondo: misto };
};

// ── 1. Il voto che non arriva ───────────────────────────────────────────────
// La bacheca esiste per una cosa sola: dire se un fix funziona. Se la scrittura
// non arriva (rete caduta, sessione scaduta, regola che rifiuta), chi ha
// cliccato deve capirlo. Il conteggio che si colora e poi torna indietro da
// solo, senza una parola, si legge come «non ha registrato il clic»: si
// riclicca, e si riclicca ancora.
// Quello che la pagina fa OGGI è registrato qui sotto, misurato: il voto torna
// indietro (giusto) e nessuno dice perché (il rilievo del giro). La prova
// asserisce l'invariante che deve reggere comunque — un voto rifiutato non
// resta contato — e annota la parte muta, così il giro dopo la ritrova.
test('un voto che non arriva al server non resta contato', async ({ openTab }) => {
  const page = await apri(openTab, [scheda({ _id: 'fb-ko', name: 'Un fix da votare' })], { signedIn: 'uid-ko' });
  await expect(page.locator('.bd-card')).toHaveCount(1);

  await page.evaluate(() => {
    window.__tentativi = 0;
    const vero = window.filo.message.bind(window.filo);
    window.filo.message = (msg) => {
      if (msg && String(msg.type).startsWith('board_')) {
        window.__tentativi += 1;
        return Promise.resolve({ ok: false, error: 'rete non raggiungibile' });
      }
      return vero(msg);
    };
  });

  const works = page.locator('.bd-card .bd-vote-works');
  await works.click();
  await expect.poll(() => page.evaluate(() => window.__tentativi)).toBe(1);

  // L'invariante: il server non ha preso il voto, quindi il voto non resta.
  await expect(works).toHaveAttribute('aria-pressed', 'false');
  await expect(works.locator('.bd-vote-count')).toHaveText('0');
  // Una sola scrittura: il ritorno indietro non ne fa partire un'altra.
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__tentativi)).toBe(1);

  // La porta: nessun segno per chi ha cliccato. Misurata, non corretta qui.
  const segno = await page.evaluate(() => {
    const t = document.body.innerText;
    const parole = /non (è|e) (stato|andat)|riprova|errore|non riuscit|fallit|non ha funzionat/i;
    const toast = document.querySelector('.sn-toast, [class*="toast"], [role="alert"], [role="status"]');
    return { parlato: parole.test(t) || !!toast, testo: t.replace(/\s+/g, ' ').slice(0, 300) };
  });
  await page.screenshot({ path: 'tests/.shots/verifica-478-giro2-voto-fallito.png' });
  test.info().annotations.push({
    type: 'porta aperta',
    description: `voto rifiutato dal server: la pagina avvisa? ${segno.parlato ? 'sì' : 'NO'} — testo in pagina: ${segno.testo}`,
  });
});

// ── 2. Il voto di chi non è connesso, con l'accesso non completato ──────────
// Anonimo che clicca ✅: parte l'accesso. Se l'accesso non va a buon fine
// (annullato, credenziali sbagliate, rete giù), la pagina deve rispondere
// qualcosa — è la seconda strada per lo stesso gesto, e la prima che incontra
// un utente nuovo, che di default anonimo lo è.
test('il voto di chi non è connesso apre l’accesso e non conta niente se salta', async ({ openTab }) => {
  const page = await apri(openTab, [scheda({ _id: 'fb-anon', name: 'Un fix da votare' })]);
  await expect(page.locator('.bd-card')).toHaveCount(1);
  await expect(page.locator('#bdSignIn')).toBeVisible();

  await page.evaluate(() => {
    window.__chiamate = [];
    const vero = window.filo.message.bind(window.filo);
    window.filo.message = (msg) => {
      const t = msg && msg.type;
      window.__chiamate.push(t);
      if (t === 'auth_signin') return Promise.resolve({ ok: false, error: 'accesso annullato' });
      if (t === 'auth_status') return Promise.resolve({ signedIn: false, uid: null });
      return vero(msg);
    };
  });

  await page.locator('.bd-card .bd-vote-works').click();
  await expect.poll(() => page.evaluate(() => window.__chiamate.includes('auth_signin'))).toBe(true);
  await page.waitForTimeout(400);

  // Gli invarianti: nessun voto contato, nessuna scrittura tentata, e la barra
  // in alto continua a dire com'è («Accedi per votare»). Quest'ultima è
  // l'unico appiglio che resta a chi ha cliccato: se un domani sparisse, la
  // pagina resterebbe muta del tutto, e questa riga diventerebbe rossa.
  await expect(page.locator('.bd-card .bd-vote-works')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.bd-card .bd-vote-works .bd-vote-count')).toHaveText('0');
  await expect(page.locator('#bdAuthMsg')).toHaveText('Accedi per votare i miglioramenti.');
  await expect(page.locator('#bdSignIn')).toBeVisible();
  expect(await page.evaluate(() => window.__chiamate.filter((t) => String(t).startsWith('board_')))).toEqual([]);

  // La porta: dopo l'accesso saltato nessuna riga spiega perché il voto non c'è.
  const segno = await page.evaluate(() => {
    const t = document.body.innerText;
    const parole = /non (è|e) riuscit|annullat|riprova|errore/i;
    const toast = document.querySelector('.sn-toast, [class*="toast"], [role="alert"], [role="status"]');
    return { parlato: parole.test(t) || !!toast, testo: t.replace(/\s+/g, ' ').slice(0, 300) };
  });
  test.info().annotations.push({
    type: 'porta aperta',
    description: `accesso non completato: la pagina spiega perché il voto non c'è? ${segno.parlato ? 'sì' : 'NO'} — testo in pagina: ${segno.testo}`,
  });
});

// ── 3. Il rosso dell'«Ancora rotto?» nei due temi ───────────────────────────
// Il giro 1 ha trovato due colori scritti a mano, uguali nei due temi, che nel
// tema scuro rendevano illeggibile il numero del voto. Nella stessa pagina ne
// resta un terzo, sullo stesso gesto (dire che un fix NON funziona): il rosso
// dell'errore del form «Ancora rotto?». Stessa famiglia, stessa prova.
test('i colori della bacheca, misurati nei due temi', async ({ openTab }) => {
  const page = await apri(openTab, [
    scheda({ _id: 'fb-re', name: 'Un fix da riaprire' }),
    scheda({
      _id: 'fb-w', name: 'Votato funziona', seq: 11,
      votes: { 'uid-re': { vote: 'works', at: '2026-09-02T10:00:00.000Z', credibilitySnapshot: 1 } },
    }),
    scheda({
      _id: 'fb-b', name: 'Votato non funziona', seq: 12,
      votes: { 'uid-re': { vote: 'broken', at: '2026-09-02T10:00:00.000Z', credibilitySnapshot: 1 } },
    }),
  ], { signedIn: 'uid-re' });
  await expect(page.locator('.bd-card')).toHaveCount(3);

  // Apre il form e prova a mandarlo vuoto: è la strada più corta all'errore.
  await page.locator('[data-id="fb-re"] .bd-reopen-link').click();
  await expect(page.locator('[data-id="fb-re"] .bd-reopen-form')).toBeVisible();
  await page.locator('[data-id="fb-re"] .bd-reopen-actions button', { hasText: 'Invia' }).click();
  await expect(page.locator('[data-id="fb-re"] .bd-reopen-err')).toBeVisible();

  // Il conteggio del voto si misura sulla PILLOLA: il suo fondo è una tinta
  // semitrasparente, e leggere il colore del solo numero darebbe il fondo
  // della pagina e un numero più generoso del vero.
  const punti = [
    ['errore «Ancora rotto?»', '[data-id="fb-re"] .bd-reopen-err'],
    ['conteggio «funziona» votato', '[data-id="fb-w"] .bd-vote-works'],
    ['conteggio «non funziona» votato', '[data-id="fb-b"] .bd-vote-broken'],
    ['conteggio non votato', '[data-id="fb-w"] .bd-vote-broken'],
    ['titolo del miglioramento', '[data-id="fb-w"] .bd-card-title'],
    ['numero sotto il titolo', '[data-id="fb-w"] .bd-card-sub'],
  ];

  const misure = [];
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(150);
    for (const [nome, sel] of punti) {
      const m = await page.locator(sel).evaluate(LEGGI_COLORI);
      misure.push({ tema, nome, r: contrasto(m.testo, m.fondo) });
    }
    await page.screenshot({ path: `tests/.shots/verifica-478-giro2-riapri-${tema}.png` });
  }

  for (const { tema, nome, r } of misure) {
    test.info().annotations.push({ type: 'contrasto', description: `${nome}, tema ${tema}: ${r.toFixed(2)}:1` });
  }

  // La soglia che il giro 1 ha usato per il rilievo sul numero del voto: sotto
  // 3 il testo è illeggibile, e lì il tema scuro stava a 2,9. Quella porta
  // resta chiusa e questa riga la tiene chiusa.
  for (const { tema, nome, r } of misure) {
    expect(r, `${nome}, tema ${tema}: contrasto ${r.toFixed(2)}`).toBeGreaterThan(3);
  }

  // Sotto 4,5 un testo piccolo si legge male anche quando non sparisce. Due
  // punti ci stanno: l'errore rosso del form nel tema scuro (3,10) e il
  // conteggio «funziona» nel tema chiaro (3,09). Sono i rilievi del giro 2:
  // finché restano, questa riga li elenca invece di nasconderli.
  const deboli = misure.filter((m) => m.r < 4.5)
    .map((m) => `${m.nome} (${m.tema}) ${m.r.toFixed(2)}`);
  test.info().annotations.push({
    type: 'porta aperta',
    description: `sotto 4,5 volte il fondo: ${deboli.length ? deboli.join('; ') : 'nessuno'}`,
  });
});

// ── 4. Schede limite: titolo di soli spazi, nessun voto ─────────────────────
// Una scheda arriva dalla rete: il titolo può essere vuoto, di soli spazi, o
// mancare del tutto. La bacheca non deve mostrare una riga muta al posto di un
// miglioramento, né perdere i pulsanti di voto.
test('un titolo vuoto o di soli spazi diventa un’etichetta col numero', async ({ openTab }) => {
  const page = await apri(openTab, [
    scheda({ _id: 'fb-spazi', name: '     ', seq: 101 }),
    scheda({ _id: 'fb-niente', name: undefined, seq: 102 }),
    scheda({ _id: 'fb-vuoto', name: '', seq: 103 }),
  ], { signedIn: 'uid-lim' });

  await expect(page.locator('.bd-card')).toHaveCount(3);
  for (const [id, seq] of [['fb-spazi', 101], ['fb-niente', 102], ['fb-vuoto', 103]]) {
    const titolo = page.locator(`[data-id="${id}"] .bd-card-title`);
    await expect(titolo).toHaveText(`Miglioramento #${seq}`);
    await expect(page.locator(`[data-id="${id}"] .bd-vote-works`)).toBeVisible();
    await expect(page.locator(`[data-id="${id}"] .bd-vote-count`).first()).toHaveText('0');
  }
  await page.screenshot({ path: 'tests/.shots/verifica-478-giro2-titoli-limite.png' });
});
