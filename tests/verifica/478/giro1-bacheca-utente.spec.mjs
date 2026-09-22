// Verifica #478, giro 1 — la bacheca vista da un utente SENZA chiave privata.
//
// IL SINTOMO segnalato: «Nessun miglioramento da verificare per ora» anche con
// decine di fix già usciti, per l'owner e per chiunque. La causa indicata: la
// pagina decideva cosa mostrare leggendo lo stato del feedback, che dal 25
// giugno 2026 viaggia cifrato, e chi guarda la bacheca la chiave non ce l'ha.
// Il risultato voluto: la bacheca mostra i miglioramenti rilasciati leggendo
// la scheda già ripulita che il backend prepara, e si può votare se funzionano.
//
// Questo file NON rifà la prova del cammino felice (c'è già): prova a romperla
// dalle porte laterali che quella non tocca —
//   · più schede di una pagina di lettura (il sintomo «vuota» ha un cugino:
//     «incompleta», e sparisce in silenzio allo stesso modo);
//   · un titolo ostile che arriva dalla rete (HTML, emoji, 10.000 caratteri);
//   · un fix chiuso e verificato, che è l'altra strada per essere «risolto»;
//   · un fix ancora da rilasciare, che in bacheca non ci deve stare;
//   · doppio clic sul voto;
//   · i due temi.
//
// Le prove del giro restano nel ramo: si rilanciano con
// `npx playwright test tests/verifica/478`.

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

function fsDoc(card) {
  const fields = {};
  for (const [k, v] of Object.entries(card)) {
    if (k.startsWith('_') || v === undefined || v === null) continue;
    fields[k] = typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) };
  }
  return {
    name: `projects/p/databases/(default)/documents/feedback-public/${card._id}`,
    fields,
    createTime: '2026-09-01T10:00:00Z',
    updateTime: '2026-09-01T10:00:00Z',
  };
}

// Il doppio della rete come la vede un utente qualunque: la scheda pubblica si
// legge, la collezione vera risponde 403 (è la regola vera). A differenza del
// doppio della prova già nel ramo, QUESTO rispetta il cursore: ordina per nome
// del documento, taglia a `limit` e riparte da `startAt`, come fa Firestore.
// Senza, una lettura paginata sembrerebbe completa dopo la prima pagina.
async function reteDaUtente(page, schede) {
  await page.evaluate(({ docs }) => {
    window.__richieste = [];
    const vera = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = String((input && input.url) || input || '');
      if (!url.includes('firestore.googleapis.com')) return vera(input, init);
      let q = null;
      try { q = JSON.parse((init && init.body) || '{}').structuredQuery || null; } catch (_) {}
      const collezione = q?.from?.[0]?.collectionId || '';
      window.__richieste.push({ collezione, startAt: q?.startAt?.values?.[0]?.referenceValue || '' });
      if (collezione !== 'feedback-public') {
        return new Response(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED' } }),
          { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
      const ordinati = docs.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      // Il cursore che manda la pagina è il nome pieno del documento, costruito
      // sul progetto vero: si confronta l'ultimo pezzo, cioè l'id.
      const dopo = String(q?.startAt?.values?.[0]?.referenceValue || '').split('/').pop();
      const da = dopo ? ordinati.findIndex((d) => d.name.split('/').pop() === dopo) + 1 : 0;
      const limite = Number(q?.limit) || ordinati.length;
      const pagina = ordinati.slice(da, da + limite);
      return new Response(JSON.stringify(pagina.map((d) => ({ document: d }))),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  }, { docs: schede.map(fsDoc) });
}

async function apri(openTab, schede, { signedIn = null } = {}) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__boardTest && window.SN_FEEDBACK, null, { timeout: 15_000 });
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 20_000 });
  await reteDaUtente(page, schede);
  await page.evaluate((v) => window.__boardTest.setReleasedVersion(v), VERSIONE);
  if (signedIn) await page.evaluate((u) => window.__boardTest.setSignedIn(u), signedIn);
  await page.evaluate(() => window.__boardTest.reload());
  await page.locator('#bdLoading').waitFor({ state: 'hidden', timeout: 20_000 });
  return page;
}

// ── 1. Più schede di una pagina ─────────────────────────────────────────────
// Le schede si leggono a pagine da 500. Con 520 fix usciti, un utente deve
// vederli tutti e 520: una lista che si ferma a 500 è lo stesso danno del
// sintomo (un fix che esiste e non compare), solo più silenzioso.
test('con più schede di una pagina non ne sparisce nessuna', async ({ openTab }) => {
  const molte = [];
  for (let i = 1; i <= 520; i += 1) {
    molte.push(scheda({
      _id: `fb-${String(i).padStart(4, '0')}`,
      seq: i,
      name: `Miglioramento numero ${i}`,
    }));
  }
  const page = await apri(openTab, molte);
  await expect(page.locator('.bd-card')).toHaveCount(520, { timeout: 30_000 });
  // La prima e l'ultima per nome del documento: nessuna delle due deve mancare.
  await expect(page.locator('.bd-card-title', { hasText: 'Miglioramento numero 1' }).first()).toBeVisible();
  await expect(page.locator('.bd-card-title', { hasText: /^Miglioramento numero 520$/ })).toHaveCount(1);
  // Ed è arrivata davvero una seconda pagina, col cursore.
  const richieste = await page.evaluate(() => window.__richieste);
  expect(richieste.filter((r) => r.collezione === 'feedback-public').length).toBeGreaterThan(1);
});

// ── 2. Titolo ostile che arriva dalla rete ──────────────────────────────────
// Il titolo della scheda arriva da fuori. Deve finire in pagina come TESTO,
// non come HTML, e non deve far sbordare la pagina.
test('un titolo ostile resta testo e non sfonda la pagina', async ({ openTab }) => {
  const ostile = '<img src=x onerror="window.__xss=1">🙂🙂 '
    + '‮ortsinis-a-artsed‬ '
    + 'A'.repeat(10_000);
  const page = await apri(openTab, [scheda({ _id: 'fb-ostile', name: ostile })]);

  await expect(page.locator('.bd-card')).toHaveCount(1);
  expect(await page.evaluate(() => window.__xss || null)).toBe(null);
  expect(await page.locator('.bd-card-title img').count()).toBe(0);
  const testo = await page.locator('.bd-card-title').innerText();
  expect(testo).toContain('<img src=x onerror=');
  // Niente scorrimento orizzontale: il titolo lunghissimo va a capo.
  const sborda = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(sborda, 'un titolo lungo non deve far scorrere la pagina in orizzontale').toBe(false);
  // I due pulsanti di voto restano raggiungibili accanto al titolo enorme.
  await expect(page.locator('.bd-card .bd-vote-works')).toBeVisible();
  await expect(page.locator('.bd-card .bd-vote-broken')).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/verifica-478-titolo-ostile.png' });
});

// ── 3. I fix chiusi PRIMA che le schede esistessero ─────────────────────────
// Il feedback lo chiedeva espressamente: cosa si fa dei fix chiusi quando la
// scheda non c'era ancora? Quelli non hanno la versione di rilascio (il campo è
// nato dopo). Se il filtro «già in produzione» li scartasse, resterebbero fuori
// dalla bacheca per sempre. E un feedback chiuso ARCHIVIANDOLO — che una scheda
// ce l'ha, perché serve all'annuncio della ricompensa — non è un miglioramento
// rilasciato e in vetrina non ci deve andare.
test('uno storico senza versione compare; un archiviato no', async ({ openTab }) => {
  const page = await apri(openTab, [
    scheda({ _id: 'fb-storico', seq: 12, name: 'Corretto prima delle schede', resolvedInVersion: undefined }),
    scheda({ _id: 'fb-archiviato', seq: 13, name: 'Chiuso archiviando', status: 'archived' }),
  ]);
  await expect(page.locator('.bd-card')).toHaveCount(1);
  await expect(page.locator('.bd-card-title')).toHaveText('Corretto prima delle schede');
});

// ── 4. Un fix non ancora uscito non si vota ─────────────────────────────────
// La bacheca chiede «funziona?»: chiederlo per una cosa che sulla macchina di
// chi guarda non c'è ancora è una domanda senza risposta possibile.
test('un fix uscito in una versione futura non compare', async ({ openTab }) => {
  const page = await apri(openTab, [
    scheda({ _id: 'fb-futuro', name: 'Ancora da rilasciare', resolvedInVersion: '0.9.99' }),
  ]);
  await expect(page.locator('.bd-card')).toHaveCount(0);
  await expect(page.locator('#bdEmpty')).toBeVisible();
  await expect(page.locator('#bdError')).toBeHidden();
});

// ── 5. Doppio clic sul voto ─────────────────────────────────────────────────
// Due clic in fretta sullo stesso pulsante non devono mandare due scritture
// (il secondo arriverebbe come «annulla», o come voto doppio).
test('due clic rapidi sul voto mandano una sola scrittura', async ({ openTab }) => {
  const page = await apri(openTab, [scheda({ _id: 'fb-voto', name: 'Da votare' })], { signedIn: 'uid-prova' });
  await expect(page.locator('.bd-card')).toHaveCount(1);

  await page.evaluate(() => {
    window.__voti = [];
    const vero = window.filo.message.bind(window.filo);
    window.filo.message = (msg) => {
      if (msg && String(msg.type).startsWith('board_')) {
        window.__voti.push(msg.type);
        return new Promise((res) => setTimeout(() => res({ ok: true, votes: { 'uid-prova': { vote: 'works', at: '', credibilitySnapshot: 1 } } }), 400));
      }
      return vero(msg);
    };
  });

  const works = page.locator('.bd-card .bd-vote-works');
  await works.click();
  await works.click({ force: true, timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(900);
  const voti = await page.evaluate(() => window.__voti);
  expect(voti, `mandato: ${JSON.stringify(voti)}`).toEqual(['board_cast_vote']);
  await expect(works).toHaveAttribute('aria-pressed', 'true');
});

// ── 6. I due temi ───────────────────────────────────────────────────────────
// La bacheca è una pagina che un utente nuovo può aprire: deve leggersi in
// tutti e due i temi, anche il voto già dato (che ha colori suoi, scritti a
// mano e non presi dal tema).
test('la bacheca si legge nel tema chiaro e nel tema scuro', async ({ openTab }) => {
  const page = await apri(
    openTab,
    [scheda({ _id: 'fb-tema', name: 'Un miglioramento', votes: undefined })],
    { signedIn: 'uid-tema' },
  );
  // Due voti già dati, uno per verso: lo stato «premuto» ha due colori scritti
  // a mano, e vanno guardati tutti e due.
  await page.evaluate(() => {
    const base = (id, seq, voto) => ({
      _id: id, name: `Miglioramento ${seq}`, seq, subSeq: 0,
      status: 'done', statusPublic: 'closed', resolvedInVersion: '0.2.70',
      createdAt: '2026-08-17T07:33:44.390Z',
      votes: { 'uid-tema': { vote: voto, at: '2026-09-02T10:00:00.000Z', credibilitySnapshot: 1 } },
    });
    window.__boardTest.setData([base('fb-works', 1, 'works'), base('fb-broken', 2, 'broken')]);
  });
  await expect(page.locator('.bd-card')).toHaveCount(2);

  const contrasto = (a, b) => {
    const lum = (c) => {
      const v = c.map((x) => {
        const s = x / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const la = lum(a); const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  const fondi = [];
  const misure = {};
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    await page.waitForTimeout(150);
    fondi.push(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
    const leggi = async (sel) => page.locator(sel).evaluate((el) => {
      // Il fondo VERO sotto il pulsante premuto: il suo colore semitrasparente
      // steso sopra il primo antenato che un colore pieno ce l'ha davvero (la
      // scheda può essere trasparente, e prenderla per bianca falserebbe il
      // conto nel tema scuro).
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
    });
    misure[tema] = {
      'funziona': await leggi('[data-id="fb-works"] .bd-vote-works'),
      'non funziona': await leggi('[data-id="fb-broken"] .bd-vote-broken'),
    };
    await page.screenshot({ path: `tests/.shots/verifica-478-bacheca-${tema}.png` });
  }
  expect(fondi[0], 'i due temi devono dare fondi diversi').not.toBe(fondi[1]);

  // Lo stato «ho votato» si vede in tutti e due i temi: il bordo del pulsante
  // premuto cambia colore, e non è trasparente. Questo è ciò che oggi tiene.
  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-sn-theme', t), tema);
    const bordi = await page.locator('[data-id="fb-works"] .bd-vote-btn').evaluateAll(
      (els) => els.map((e) => getComputedStyle(e).borderColor));
    expect(bordi[0], `tema ${tema}: il voto dato deve avere un bordo suo`).not.toBe(bordi[1]);
    expect(bordi[0], `tema ${tema}`).not.toBe('rgba(0, 0, 0, 0)');
  }

  // IL RILIEVO DEL GIRO, misurato qui: il NUMERO accanto al voto che hai dato.
  // I suoi colori erano scritti a mano una volta sola per tutti e due i temi, e
  // nel tema scuro cadevano sotto il minimo leggibile: 2,86 per «funziona» e
  // 2,77 per «non funziona», contro 3. Corretto nello stesso giro dando ai due
  // colori una variante scura. Le misure restano nel resoconto della prova.
  for (const tema of ['dark', 'light']) {
    for (const [verso, { testo, fondo }] of Object.entries(misure[tema])) {
      const r = contrasto(testo, fondo);
      test.info().annotations.push({
        type: 'contrasto',
        description: `voto «${verso}» già dato, tema ${tema}: ${r.toFixed(2)}:1`,
      });
      expect(r, `voto «${verso}» già dato, tema ${tema}: contrasto ${r.toFixed(2)}`)
        .toBeGreaterThan(3);
    }
  }
});
