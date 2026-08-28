// #495 — la barra della dashboard di gestione dice quanti feedback c'è in ogni
// sezione, senza doverle aprire («ricevuti (24) in coda (12)»).
//
// Quello che l'owner deve poter fare: guardare la barra e sapere quanto c'è
// dietro ogni scheda, con numeri che restano veri mentre lavora. Quindi qui si
// asserisce il NUMERO LETTO SULLO SCHERMO, non lo stato interno della pagina.
//
// Senza la feature ogni assert su un numero è rosso: le schede si leggevano
// "Ricevuti", "In coda", … e basta.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

function fb(id, status, extra) {
  return {
    _id: id,
    text: `Feedback ${id}`,
    name: `Feedback ${id}`,
    seq: Number(String(id).replace(/\D/g, '')) || 1,
    subSeq: 0,
    clientId: 'tester@example.com',
    createdAt: '2026-06-20T10:00:00Z',
    images: [],
    status,
    ...(extra || {}),
  };
}

async function apriPagina(openTab) {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_FEEDBACK && window.filo);
  // Il caricamento vero (Firestore) può atterrare a metà test e sovrascrivere i
  // dati finti: si aspetta che abbia finito prima di iniettarli.
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  return page;
}

const tab = (page, name) => page.locator(`.mg-tab[data-tab="${name}"]`);

test('#495 — le quattro schede che elencano feedback dicono quante ne contengono', async ({ openTab }) => {
  const page = await apriPagina(openTab);

  // Quantità tutte diverse fra loro: un conteggio sbagliato non può somigliare
  // a quello giusto.
  await page.evaluate((items) => window.__mgTest.setData(items), [
    fb('i1', 'unlabeled'), fb('i2', 'unlabeled'), fb('i3', 'design'),
    fb('q1', 'todo'), fb('q2', 'working'),
    fb('r1', 'done'), fb('r2', 'done'), fb('r3', 'done'), fb('r4', 'done'),
    fb('z1', 'archived'),
  ]);

  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (3)');
  await expect(tab(page, 'queue')).toHaveText('In coda (2)');
  await expect(tab(page, 'resolved')).toHaveText('Risolti (4)');
  await expect(tab(page, 'archived')).toHaveText('Archiviati (1)');

  // Le altre quattro schede non elencano feedback: un numero lì non vorrebbe
  // dire niente, e infatti non c'è.
  for (const name of ['stats', 'models', 'automation', 'log']) {
    await expect(tab(page, name)).not.toHaveText(/\d/);
  }

  // L'intestazione della colonna dice quanti ne sta mostrando adesso.
  await expect(page.locator('#mgListHead')).toHaveText('Ricevuti (3)');
});

test('#495 — una sezione vuota lo dice: (0), non il silenzio', async ({ openTab }) => {
  const page = await apriPagina(openTab);
  await page.evaluate((items) => window.__mgTest.setData(items), [fb('i1', 'unlabeled')]);

  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (1)');
  await expect(tab(page, 'queue')).toHaveText('In coda (0)');
  await expect(tab(page, 'resolved')).toHaveText('Risolti (0)');
  await expect(tab(page, 'archived')).toHaveText('Archiviati (0)');
});

test('#495 — approvare un feedback sposta SUBITO i due numeri, senza ricaricare', async ({ openTab }) => {
  const page = await apriPagina(openTab);

  // Il salvataggio risponde ok senza rete: qui conta cosa succede allo schermo.
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') return { ok: true };
      return orig(msg);
    };
  });

  // Un feedback bloccato (attacco) nei Ricevuti: l'owner lo accetta e va in coda.
  const BLOCCATO = fb('i1', 'new', {
    pipeline: {
      action: 'blocked',
      verdicts: [
        { judge: 'A', class: 'attack', reasoning: 'Prompt injection.' },
        { judge: 'B', class: 'attack', reasoning: 'Prompt injection.' },
      ],
      decidedAt: '2026-06-22T10:01:00Z',
    },
  });
  await page.evaluate((item) => {
    window.__mgTest.setData([item]);
    window.__mgTest.setTab('inbox');
    window.__mgTest.openDetail(item._id);
  }, BLOCCATO);

  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (1)');
  await expect(tab(page, 'queue')).toHaveText('In coda (0)');

  await page.locator('#mgAcceptBtn').click();

  // Nessun ricaricamento: i due numeri cambiano da soli.
  await expect(tab(page, 'inbox')).toHaveText('Ricevuti (0)');
  await expect(tab(page, 'queue')).toHaveText('In coda (1)');
});

test('#495 — negli Archiviati il numero segue il filtro ⭐ (dice quello che si vede)', async ({ openTab }) => {
  const page = await apriPagina(openTab);
  await page.evaluate((items) => window.__mgTest.setData(items), [
    fb('z1', 'archived', { starred: true }),
    fb('z2', 'archived'),
    fb('z3', 'archived'),
    fb('s1', 'todo', { starred: true }),   // preferito ma NON archiviato
  ]);
  await page.evaluate(() => window.__mgTest.setTab('archived'));

  // Filtro spento: i tre archiviati, ed è quello che la lista mostra.
  await expect(tab(page, 'archived')).toHaveText('Archiviati (3)');
  await expect(page.locator('.mg-item')).toHaveCount(3);

  // Filtro ⭐ acceso: la lista diventa "tutti i preferiti" (uno archiviato + uno
  // in coda) e il numero della scheda la segue, invece di restare a 3.
  await page.locator('#mgStarFilter').check();
  await expect(page.locator('.mg-item')).toHaveCount(2);
  await expect(tab(page, 'archived')).toHaveText('Archiviati (2)');

  // E tornando indietro il numero torna com'era.
  await page.locator('#mgStarFilter').uncheck();
  await expect(page.locator('.mg-item')).toHaveCount(3);
  await expect(tab(page, 'archived')).toHaveText('Archiviati (3)');
});

// ── Il numero è parte del nome, anche a finestra stretta ──────────────────
// Alla larghezza minima consentita alla finestra (720) i bottoni si
// stringevano e spezzavano le parole: "In" / "coda" / "(0)" su tre righe, e la
// barra alta il doppio. Il numero smetteva di leggersi come parte del nome.
// La pagina gemella dei feedback risolve lo stesso problema mandando a capo le
// schede INTERE (tests/feedback-tabs-wrap.spec.mjs): stessa regola qui.
//
// Senza il fix (`flex-wrap: wrap` + `white-space: nowrap`) il primo assert è
// rosso: i pezzi di una stessa scheda stanno su righe diverse.

test('#495 — a finestra stretta il nome e il suo numero restano sulla stessa riga', async ({ app, openTab }) => {
  // Larghezza minima consentita alla finestra (src/main/window.js: minWidth 720).
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setContentSize(720, 800);
  });

  const page = await apriPagina(openTab);
  await page.setViewportSize({ width: 720, height: 800 });
  await page.evaluate((items) => window.__mgTest.setData(items), [
    fb('i1', 'unlabeled'), fb('q1', 'todo'), fb('r1', 'done'), fb('z1', 'archived'),
  ]);
  await expect(tab(page, 'queue')).toHaveText('In coda (1)');

  // Ogni scheda visibile sta su UNA riga sola: tutti i pezzi del suo contenuto
  // (nome e numero) hanno lo stesso bordo superiore.
  const righe = await page.evaluate(() => {
    const out = [];
    for (const btn of document.querySelectorAll('.mg-tab')) {
      if (btn.hidden) continue;
      const range = document.createRange();
      range.selectNodeContents(btn);
      const tops = [...range.getClientRects()].map((r) => Math.round(r.top));
      out.push({ txt: btn.textContent, righe: new Set(tops).size });
    }
    return out;
  });
  expect(righe.length).toBeGreaterThan(0);
  for (const t of righe) expect(t, `"${t.txt}" spezzata su più righe`).toMatchObject({ righe: 1 });

  // Vanno a capo le schede intere: l'ultima sta più in basso della prima e
  // resta dentro il bordo destro, senza scorrimento laterale della pagina.
  const geo = await page.evaluate(() => {
    const list = [...document.querySelectorAll('.mg-tab')].filter((b) => !b.hidden);
    const first = list[0].getBoundingClientRect();
    const last = list[list.length - 1].getBoundingClientRect();
    const lente = document.getElementById('mgSearchToggle').getBoundingClientRect();
    const doc = document.documentElement;
    return {
      firstTop: first.top, lastTop: last.top, lastRight: last.right,
      lenteRight: lente.right,
      scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth,
    };
  });
  expect(geo.lastTop).toBeGreaterThan(geo.firstTop);
  expect(geo.lastRight).toBeLessThanOrEqual(geo.clientWidth + 1);
  expect(geo.lenteRight).toBeLessThanOrEqual(geo.clientWidth + 1);
  expect(geo.scrollWidth).toBeLessThanOrEqual(geo.clientWidth);

  // La lente, in fondo alla barra, resta raggiungibile anche dopo il capo.
  await page.locator('#mgSearchToggle').click();
  await expect(page.locator('#mgSearchInput')).toBeVisible();
  await page.locator('#mgSearchClose').click();

  // E le schede andate a capo restano cliccabili: l'ultima si apre davvero.
  await tab(page, 'log').click();
  await expect(tab(page, 'log')).toHaveClass(/mg-tab--active/);
});

// ── La ricerca è una lista come le altre: dice quanti ne ha trovati ────────
// Era l'unica intestazione rimasta senza numero: si cercava una parola, si
// ottenevano due risultati, e la colonna diceva solo "Ricerca". Quanti ne ha
// trovati è ESATTAMENTE la domanda a cui la ricerca risponde.

test('#495 — la ricerca dice quanti risultati ha trovato, e zero è una risposta', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_MANAGE_SEARCH && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());

  // Il modello risponde con la classifica che gli diciamo noi: qui conta il
  // numero scritto in cima alla colonna, non chi ha scelto l'ordine.
  await page.evaluate(() => {
    window.__rank = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'ai_request') return { ok: true, text: JSON.stringify(window.__rank) };
      return orig(msg);
    };
  });

  await page.evaluate((items) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(items); }, [
    fb('a1', 'unlabeled'), fb('a2', 'todo'), fb('a3', 'done'),
  ]);

  const head = page.locator('#mgListHead');
  await expect(head).toHaveText('Ricevuti (1)');

  // Aperta la ricerca, non c'è ancora niente da contare: solo il nome.
  await page.locator('#mgSearchToggle').click();
  await expect(head).toHaveText('Ricerca');

  // Due risultati → "(2)", e sono davvero due card.
  await page.evaluate(() => { window.__rank = [{ id: 'a1', reason: 'x' }, { id: 'a3', reason: 'y' }]; });
  await page.locator('#mgSearchInput').fill('feedback');
  await page.locator('#mgSearchInput').press('Enter');
  await expect(page.locator('.mg-item')).toHaveCount(2);
  await expect(head).toHaveText('Ricerca (2)');

  // Nessun risultato → "(0)": la ricerca ha risposto, e la risposta è zero.
  await page.evaluate(() => { window.__rank = []; });
  await page.locator('#mgSearchInput').fill('zzzqqq');
  await page.locator('#mgSearchInput').press('Enter');
  await expect(page.locator('#mgListEmpty')).toBeVisible();
  await expect(head).toHaveText('Ricerca (0)');

  // Chiusa la ricerca si torna al numero della scheda.
  await page.locator('#mgSearchClose').click();
  await expect(head).toHaveText('Ricevuti (1)');
});

test('#495 — un risultato che punta a un feedback non più caricato non viene contato', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_MANAGE_SEARCH && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());

  // Il modello nomina anche un id che in pagina non c'è: la card non si
  // disegna, e il numero deve essere quello delle card, non quello della
  // risposta del modello (altrimenti dice 2 e se ne vede 1).
  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'ai_request') {
        return { ok: true, text: JSON.stringify([{ id: 'a1', reason: 'x' }, { id: 'fantasma', reason: 'y' }]) };
      }
      return orig(msg);
    };
  });
  await page.evaluate((items) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(items); }, [
    fb('a1', 'unlabeled'), fb('a2', 'todo'),
  ]);

  await page.locator('#mgSearchToggle').click();
  await page.locator('#mgSearchInput').fill('feedback');
  await page.locator('#mgSearchInput').press('Enter');
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('#mgListHead')).toHaveText('Ricerca (1)');
});

// ── Quando il caricamento tocca il tetto, il numero è un MINIMO e lo dice ──
// La pagina carica i 500 feedback più recenti. Oltre quella soglia i più vecchi
// restano fuori: "Archiviati (312)" quando ce ne sono 400 sembra una risposta e
// non lo è. Il "+" toglie l'affermazione senza costare una lettura in più.

test('#495 — caricamento al tetto: i numeri diventano "+" e l\'hover spiega perché', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.SN_FEEDBACK);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));

  const CAP = await page.evaluate(() => window.SN_FEEDBACK.LIST_PAGE_SIZE);

  // Una in meno del tetto: il caricamento ha visto tutto, i numeri sono totali.
  await page.evaluate((cap) => {
    const items = [];
    for (let i = 0; i < cap - 1; i++) {
      items.push({
        _id: `p${i}`, text: `t${i}`, name: `t${i}`, seq: i + 1, subSeq: 0,
        clientId: 'tester@example.com', createdAt: '2026-06-20T10:00:00Z', images: [],
        status: i === 0 ? 'todo' : 'unlabeled',
      });
    }
    window.__mgTest.setData(items);
  }, CAP);
  await expect(tab(page, 'inbox')).toHaveText(`Ricevuti (${CAP - 2})`);
  await expect(tab(page, 'queue')).toHaveText('In coda (1)');
  await expect(tab(page, 'archived')).toHaveText('Archiviati (0)');
  await expect(tab(page, 'inbox')).not.toHaveAttribute('title', /./);

  // Tetto toccato: gli stessi numeri smettono di affermare un totale.
  await page.evaluate((cap) => {
    const items = [];
    for (let i = 0; i < cap; i++) {
      items.push({
        _id: `p${i}`, text: `t${i}`, name: `t${i}`, seq: i + 1, subSeq: 0,
        clientId: 'tester@example.com', createdAt: '2026-06-20T10:00:00Z', images: [],
        status: i === 0 ? 'todo' : 'unlabeled',
      });
    }
    window.__mgTest.setData(items);
  }, CAP);
  await expect(tab(page, 'inbox')).toHaveText(`Ricevuti (${CAP - 1}+)`);
  await expect(tab(page, 'queue')).toHaveText('In coda (1+)');
  // Una sezione "vuota" al tetto non è vuota davvero: nemmeno lo zero afferma.
  await expect(tab(page, 'archived')).toHaveText('Archiviati (0+)');
  await expect(page.locator('#mgListHead')).toHaveText(`Ricevuti (${CAP - 1}+)`);

  // Il "+" non resta un enigma: l'hover dice quanti se ne sono caricati.
  const hint = await page.evaluate(() => window.SN_FEEDBACK.COUNT_CAP_HINT);
  expect(hint).toContain(String(CAP));
  await expect(tab(page, 'inbox')).toHaveAttribute('title', hint);
  await expect(page.locator('#mgListHead')).toHaveAttribute('title', hint);

  // E la sezione vuota lo dice a parole, invece di negare i feedback più vecchi.
  await page.evaluate(() => window.__mgTest.setTab('archived'));
  await expect(page.locator('#mgListEmpty')).toContainText(String(CAP));
});
