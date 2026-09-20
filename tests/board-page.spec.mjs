// Spec Playwright per la bacheca utente (filo://board/, DC1 + DC2).
//
// Assert di COMPORTAMENTO (asserisce il SUCCESSO della feature, non l'assenza
// di un errore):
//   - un non-owner apre la bacheca e VEDE i fix in produzione (done/verified +
//     spediti) come schede VOTABILI (titolo sicuro + pulsanti funziona/non-funziona);
//   - NON vede nulla del red-team: niente stato, priorità, verdetti dei giudici,
//     testo del feedback bloccato, mittente, pipeline. Un feedback "attack" anche
//     se chiuso NON compare e il suo testo/verdetti non sono nel DOM;
//   - anonimo → invito ad accedere; loggato → il voto (DC2) passa dall'IPC
//     BOARD_CAST_VOTE/BOARD_CLEAR_VOTE verso il main, che scrive su Firestore
//     con l'idToken e accredita i crediti — vedi tests/board-vote.spec.mjs per
//     il dettaglio del flusso IPC e tests/unit/creditStore.test.mjs per
//     l'anti-doppio-premio.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://board/board.html';

// Un fix pulito, chiuso e già rilasciato → DEVE comparire in bacheca.
const SHIPPED = {
  _id: 'fb-shipped',
  name: 'Migliorata la cattura schermo',
  text: 'TESTO-GREZZO-NON-DEVE-COMPARIRE-IN-BACHECA',
  status: 'done',
  priority: 3,
  resolvedInVersion: '0.2.70',
  seq: 42, subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-06-20T10:00:00Z',
  votes: { 'altro@x.com': { vote: 'works', at: '2026-06-21T10:00:00Z', credibilitySnapshot: 1 } },
};

// Un feedback classificato "attack" dal pipeline, anche se done+spedito → NON
// deve MAI comparire in bacheca, né il suo testo né i verdetti dei giudici.
const ATTACK = {
  _id: 'fb-attack',
  name: 'TITOLO-ATTACCO-SEGRETO',
  text: 'TESTO-ATTACCO-SEGRETO',
  status: 'done',
  priority: 3,
  resolvedInVersion: '0.2.70',
  seq: 43, subSeq: 0,
  createdAt: '2026-06-20T11:00:00Z',
  pipeline: {
    action: 'block_attack', l2Class: 'attack', stage: 'L2',
    verdicts: [{ judge: 'A', class: 'attack', reasoning: 'VERDETTO-SEGRETO-DEI-GIUDICI' }],
    filoSummary: 'SOMMARIO-SICUREZZA-SEGRETO',
  },
};

// Un fix ancora in coda (todo) → NON in bacheca (non è in produzione).
const TODO = {
  _id: 'fb-todo', name: 'Fix non ancora pronto', status: 'todo',
  seq: 44, subSeq: 0, createdAt: '2026-06-22T10:00:00Z',
};

async function seed(page, { signedIn } = {}) {
  await page.waitForFunction(() => window.__boardTest && window.SN_FEEDBACK && window.SN_MANAGE_REVIEW);
  // Aspetta che il caricamento live (FB.list verso Firestore) si sia stabilizzato
  // prima di iniettare i dati di test: così setData è SEMPRE l'ultimo render e i
  // dati finti non vengono clobberati dalla load reale che parte all'init.
  await page.locator('#bdLoading').waitFor({ state: 'hidden' });
  await page.evaluate(({ list, email }) => {
    window.__boardTest.setReleasedVersion('0.2.71');
    if (email) window.__boardTest.setSignedIn(email);
    window.__boardTest.setData(list);
  }, { list: [SHIPPED, ATTACK, TODO], email: signedIn || null });
}

test('mostra solo i fix in produzione come schede votabili (titolo + pulsanti)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page);

  // Esattamente una scheda: il fix pulito spedito. Attack e todo esclusi.
  await expect(page.locator('.bd-card')).toHaveCount(1);
  await expect(page.locator('.bd-card-title')).toHaveText('Migliorata la cattura schermo');
  await expect(page.locator('#bdEmpty')).toBeHidden();

  // È VOTABILE: due pulsanti funziona/non-funziona, col conteggio esistente.
  await expect(page.locator('.bd-card .bd-vote-works')).toHaveCount(1);
  await expect(page.locator('.bd-card .bd-vote-broken')).toHaveCount(1);
  await expect(page.locator('.bd-card .bd-vote-works .bd-vote-count')).toHaveText('1');
});

test('ZERO info di sicurezza: attack escluso, suoi testi/verdetti assenti dal DOM', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page);

  const body = await page.locator('body').innerText();
  // Niente materiale red-team, né del fix mostrato né del feedback bloccato.
  for (const secret of [
    'TITOLO-ATTACCO-SEGRETO', 'TESTO-ATTACCO-SEGRETO', 'VERDETTO-SEGRETO-DEI-GIUDICI',
    'SOMMARIO-SICUREZZA-SEGRETO', 'TESTO-GREZZO-NON-DEVE-COMPARIRE-IN-BACHECA',
  ]) {
    expect(body).not.toContain(secret);
  }
  // Nessuna etichetta di stato/priorità/giudizio in pagina.
  for (const word of ['attack', 'block', 'priorità', 'Giudice', 'verdetto', 'todo', 'done']) {
    expect(body.toLowerCase()).not.toContain(word.toLowerCase());
  }
});

test('anonimo: invito ad accedere; loggato (lato renderer): il voto passa dal main', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  // Anonimo: pulsante Accedi visibile.
  await seed(page, {});
  await expect(page.locator('#bdSignIn')).toBeVisible();

  // Loggato lato renderer (hook di test): niente pulsante Accedi.
  await seed(page, { signedIn: 'me@example.com' });
  await expect(page.locator('#bdSignIn')).toBeHidden();

  // Il voto reale (DC2) passa SEMPRE dall'IPC BOARD_CAST_VOTE — il main, non il
  // renderer, scrive su Firestore con l'idToken e accredita i crediti. In questo
  // ambiente di test non esiste una sessione reale lato main (il login Google
  // dal vivo non è simulabile da Playwright — vedi auth-pkce.spec.mjs), quindi
  // l'IPC torna ok:false ("Accedi per votare..."): l'aggiornamento ottimistico
  // locale viene mostrato e poi RIPRISTINATO con garbo, senza crash né stato
  // sporco. Questo è il comportamento corretto e verificabile qui; il flusso
  // end-to-end con un account reale è verificato dall'unit test della
  // ricompensa (creditStore) + dalla code review della scrittura idToken.
  const works = page.locator('.bd-card .bd-vote-works');
  await expect(works).toHaveAttribute('aria-pressed', 'false');
  await expect(works.locator('.bd-vote-count')).toHaveText('1');
  await works.click();
  // A risposta arrivata (errore: non autenticato lato main) il voto ottimistico
  // viene ripristinato con garbo: niente voto fantasma, niente crash. Il doppio
  // click è già impedito dalla guardia di re-entrancy lato codice (una seconda
  // pressione mentre la richiesta è in volo viene ignorata), indipendentemente
  // dal breve stato "disabilitato" del pulsante — che dura quanto il round-trip
  // IPC e non è un segnale osservabile in modo affidabile. Qui assertiamo il
  // COMPORTAMENTO stabile e verificabile: lo stato finale torna quello di prima.
  await expect(works).toBeEnabled();
  await expect(works).toHaveAttribute('aria-pressed', 'false');
  await expect(works.locator('.bd-vote-count')).toHaveText('1');
});

// ── Il voto dato si legge anche col tema scuro (verifica #478) ──────────────
//
// I due colori del voto «premuto» stavano scritti a mano una volta sola e
// valevano per tutti e due i temi. Nel tema scuro il conteggio finiva a 2,86
// volte il fondo per «funziona» e 2,77 per «non funziona», sotto il minimo di
// 3: il numero spariva proprio dopo aver votato, cioè dopo il gesto per cui la
// bacheca esiste. La guardia sta qui, dove la suite la rilancia sempre.
test('il conteggio del voto dato resta leggibile nei due temi', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await seed(page, { signedIn: 'me@example.com' });

  // Un voto per verso, dati da QUESTO utente, così i due pulsanti premuti
  // esistono tutti e due in pagina.
  await page.evaluate(() => {
    const voto = (v) => ({ 'me@example.com': { vote: v, at: '2026-09-02T10:00:00Z', credibilitySnapshot: 1 } });
    window.__boardTest.setData([
      { _id: 'fb-si', name: 'Fix votato bene', status: 'done', seq: 51, subSeq: 0,
        resolvedInVersion: '0.2.70', createdAt: '2026-06-20T10:00:00Z', votes: voto('works') },
      { _id: 'fb-no', name: 'Fix votato male', status: 'done', seq: 52, subSeq: 0,
        resolvedInVersion: '0.2.70', createdAt: '2026-06-20T11:00:00Z', votes: voto('broken') },
    ]);
  });
  await expect(page.locator('.bd-card')).toHaveCount(2);

  // Rapporto di contrasto WCAG fra il colore del testo e il fondo VERO sotto di
  // lui: il fondo del pulsante premuto è semitrasparente, quindi va steso sopra
  // il primo antenato con un colore pieno.
  const rapporto = async (sel) => page.locator(sel).evaluate((el) => {
    const num = (s) => (s.match(/[\d.]+/g) || []).map(Number);
    let sotto = [255, 255, 255];
    for (let p = el.parentElement; p; p = p.parentElement) {
      const n = num(getComputedStyle(p).backgroundColor);
      if (n.length >= 3 && (n.length < 4 || n[3] >= 1)) { sotto = n.slice(0, 3); break; }
    }
    const suo = num(getComputedStyle(el).backgroundColor);
    const a = suo.length > 3 ? suo[3] : 1;
    const fondo = [0, 1, 2].map((i) => suo[i] * a + sotto[i] * (1 - a));
    const lum = (c) => {
      const v = c.map((x) => {
        const s = x / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const a1 = lum(num(getComputedStyle(el).color).slice(0, 3));
    const a2 = lum(fondo);
    return (Math.max(a1, a2) + 0.05) / (Math.min(a1, a2) + 0.05);
  });

  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    const si = await rapporto('[data-id="fb-si"] .bd-vote-works');
    const no = await rapporto('[data-id="fb-no"] .bd-vote-broken');
    expect(si, `voto «funziona», tema ${tema}: contrasto ${si.toFixed(2)}`).toBeGreaterThan(3);
    expect(no, `voto «non funziona», tema ${tema}: contrasto ${no.toFixed(2)}`).toBeGreaterThan(3);
  }
});
