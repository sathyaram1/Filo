// La pagina Feedback aperta segue da sola i cambi di stato fatti altrove, con lo stesso giro della Gestione:
// stessa regola delle sezioni (richieste di fusione comprese), niente letture fuori vista, un giro appeso non
// la ferma, e il ridisegno non passa sopra a chi sta scrivendo o puntando un pulsante. Firestore è finto
// (setLiveSources), l'orologio della pagina e il segnale «in vista» del main sono veri.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://feedback/feedback.html';
const MANAGE = 'filo://manage/manage.html';
const RICHIESTA = 'abcdefabcdefabcdefabcdef';

function fb(id, seq, status, extra = {}) {
  return {
    _id: id,
    _updateTime: 'v1',
    seq,
    subSeq: 0,
    name: `Segnalazione ${seq}`,
    text: `Testo ${seq}`,
    notes: '',
    status,
    statusReason: extra.statusReason || null,
    clientId: 'tester@example.com',
    createdAt: new Date(Date.UTC(2026, 7, 1) + seq * 3600e3).toISOString(),
    images: [],
    ...extra,
  };
}

function richiesta(feedbackId, num) {
  return {
    id: RICHIESTA, branch: `claude/${feedbackId}`, sha: 'a'.repeat(40), feedbackId, num: String(num),
    who: 'secaudit · x', origin: 'routine', trips: [{ gate: 'rules', label: 'Regole', items: ['firestore.rules'] }],
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
}

// La pagina con un server finto dietro: versioni e righe per il giro, documenti interi per le schede, e le
// richieste di fusione che il test decide (`__srv.pending`).
async function apri(openTab, docs, { tempi, pending = [] } = {}) {
  const page = await openTab(URL);
  await page.waitForFunction(() => window.__fbTest && window.__fbTest.whenReady && window.filo);
  await page.evaluate(() => window.__fbTest.whenReady());
  await page.evaluate(({ docs, tempi, pending }) => {
    window.__nonRicaricata = true;
    window.__srv = { docs: {}, letture: 0, dettagli: 0, pending };
    for (const d of docs) window.__srv.docs[d._id] = d;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'merge_approvals_get') {
        return { ok: true, pending: window.__srv.pending, failed: [], recent: [], preapproved: [] };
      }
      if (t === 'feedback_decrypt_fields') return { ok: true, list: msg.list };
      return orig(msg);
    };
    const copia = (id) => (window.__srv.docs[id] ? JSON.parse(JSON.stringify(window.__srv.docs[id])) : null);
    // La riga della lista non porta la conversazione, come la proiezione vera.
    const riga = (d) => { const { notes, ...r } = d; return { ...r, _proiezione: true }; };
    window.SN_FEEDBACK.getMany = async (ids) => {
      window.__srv.dettagli += 1;
      return ids.map(copia).filter(Boolean);
    };
    window.__fbTest.setLiveSources({
      listVersions: async () => {
        window.__srv.letture += 1;
        return Object.values(window.__srv.docs).map((d) => ({ _id: d._id, _updateTime: d._updateTime, createdAt: d.createdAt }));
      },
      getMany: async (ids) => {
        window.__srv.letture += 1;
        return ids.map(copia).filter(Boolean).map(riga);
      },
    });
    window.__fbTest.setAdmin(true, { email: 'owner@example.invalid' });
    window.__fbTest.setLiveTiming(tempi);
    window.__fbTest.setData(docs.map((d) => ({ ...d })), { dalVivo: true });
  }, { docs, tempi: tempi || { pollMs: 800, rientroMs: 300, clockMs: 200 }, pending });
  if (pending.length) await page.evaluate(() => window.__fbTest.caricaFusioni());
  return page;
}

async function ilServerScrive(page, id, campi) {
  await page.evaluate(({ id, campi }) => {
    const d = window.__srv.docs[id];
    window.__srv.docs[id] = { ...d, ...campi, _updateTime: `${d._updateTime}+` };
  }, { id, campi });
}

const ids = (page) => page.locator('#list .fb-card').evaluateAll((els) => els.map((e) => e.dataset.id));
const linguetta = (page, t) => page.locator(`#tabs [data-tab="${t}"]`);
const scheda = (page, id) => page.locator(`#list .fb-card[data-id="${id}"]`);

test('un feedback che cambia stato altrove cambia sezione da solo, con la conversazione nuova', async ({ openTab }) => {
  const page = await apri(openTab, [
    fb('f716', 716, 'design'),
    fb('f515', 515, 'working', { workingSince: new Date().toISOString() }),
  ]);
  await page.evaluate(() => window.__fbTest.setTab('queue'));
  await expect.poll(() => ids(page)).toEqual(['f515']);
  await expect(linguetta(page, 'inbox')).toHaveText('Ricevuti (1)');

  await ilServerScrive(page, 'f515', {
    status: 'design', statusReason: 'clarify', workingSince: null,
    notes: 'Serve sapere su quale pagina succede.',
  });

  // Senza ricaricare: In coda si svuota, Ricevuti lo conta e lo segnala.
  await expect.poll(() => ids(page), { timeout: 10_000 }).toEqual([]);
  await expect(linguetta(page, 'inbox')).toHaveText('Ricevuti (2)');
  await expect(linguetta(page, 'queue')).toHaveText('In coda (0)');
  await expect(linguetta(page, 'inbox')).toHaveClass(/fb-tab--arrivi/);

  await linguetta(page, 'inbox').click();
  const arrivata = scheda(page, 'f515');
  await expect(arrivata).toHaveClass(/fb-card--arrivata/);
  // La scheda È il dettaglio: arriva con la conversazione di adesso, non con quella di prima.
  await expect(arrivata).toContainText('Serve sapere su quale pagina succede.', { timeout: 10_000 });
  await expect(arrivata.locator('.fb-reply-text')).toBeVisible();

  // Toccata, è vista: il segno se ne va dalla scheda e dalla linguetta.
  await arrivata.locator('.fb-title').click();
  await expect(arrivata).not.toHaveClass(/fb-card--arrivata/);
  await expect(linguetta(page, 'inbox')).not.toHaveClass(/fb-tab--arrivi/);
  expect(await page.evaluate(() => window.__nonRicaricata)).toBe(true);
});

test('una richiesta di fusione in attesa porta la pratica nei Ricevuti, gli stessi numeri della Gestione', async ({ openTab }) => {
  const docs = [
    fb('f515', 515, 'revision_security'),
    fb('f600', 600, 'todo'),
    fb('f716', 716, 'design'),
  ];
  const page = await apri(openTab, docs);
  await expect(linguetta(page, 'queue')).toHaveText('In coda (2)');

  // Aprendo la pagina (Aggiorna fa lo stesso caricamento): la prima sezione disegnata è già quella giusta.
  await page.evaluate((r) => {
    window.__srv.pending = [r];
    window.SN_FEEDBACK.list = async () => Object.values(window.__srv.docs).map((d) => ({ ...d }));
  }, richiesta('f515', 515));
  await page.locator('#refresh').click();
  await expect(linguetta(page, 'inbox')).toHaveText('Ricevuti (2)');
  await expect(linguetta(page, 'queue')).toHaveText('In coda (1)');
  await linguetta(page, 'inbox').click();
  // Le fusioni ferme davanti, e la scheda dice perché sta qui.
  await expect.poll(() => ids(page)).toEqual(['f515', 'f716']);
  await expect(scheda(page, 'f515').locator('.fb-fusione')).toHaveText('fusione ferma');

  // La Gestione, con gli stessi dati e la stessa richiesta, conta allo stesso modo.
  const gestione = await openTab(MANAGE);
  await gestione.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady && window.filo);
  await gestione.evaluate(() => window.__mgTest.whenReady());
  await gestione.evaluate(({ docs, r }) => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'merge_approvals_get') return { ok: true, pending: [r], failed: [], recent: [], preapproved: [] };
      return orig(msg);
    };
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(docs);
  }, { docs, r: richiesta('f515', 515) });
  await gestione.evaluate(() => window.__mgTest.loadMergeApprovals());
  await expect(gestione.locator('.mg-tab[data-tab="inbox"] .mg-tab-count')).toHaveText('(2)');
  await expect(gestione.locator('.mg-tab[data-tab="queue"] .mg-tab-count')).toHaveText('(1)');
});

test('la richiesta arrivata mentre la pagina è aperta si rilegge al giro che cambia lo stato', async ({ openTab }) => {
  const page = await apri(openTab, [
    fb('f515', 515, 'working', { workingSince: new Date().toISOString() }),
    fb('f716', 716, 'design'),
  ]);
  await expect(linguetta(page, 'queue')).toHaveText('In coda (1)');
  await page.evaluate((r) => { window.__srv.pending = [r]; }, richiesta('f515', 515));
  await ilServerScrive(page, 'f515', { status: 'revision_security', workingSince: null });
  await expect(linguetta(page, 'inbox')).toHaveText('Ricevuti (2)', { timeout: 10_000 });
  await expect(linguetta(page, 'queue')).toHaveText('In coda (0)');
  await expect(linguetta(page, 'inbox')).toHaveClass(/fb-tab--arrivi/);
});

test('in secondo piano non legge, nemmeno per l\'esito di un\'altra pagina; tornando in vista si allinea subito', async ({ openTab, shell }) => {
  const page = await apri(openTab, [
    fb('f716', 716, 'design'),
    fb('f515', 515, 'working', { workingSince: new Date().toISOString() }),
  ]);
  await expect.poll(() => page.evaluate(() => window.__srv.letture)).toBeGreaterThan(1);

  const snap = await shell.evaluate(() => window.filoShell.tabs.snapshot());
  const feedback = snap.tabs.find((t) => String(t.url || '').startsWith('filo://feedback')).id;
  await shell.evaluate(() => window.filoShell.tabs.open('filo://newtab/'));
  await page.waitForTimeout(600);
  const fuori = await page.evaluate(() => window.__srv.letture);
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.__srv.letture)).toBe(fuori);

  // Il giro di un'altra pagina arriva anche qui: le versioni restano lì, rilette solo al rientro.
  await page.evaluate(() => window.__fbTest.setLiveTiming({ pollMs: 10 * 60 * 1000 }));
  await ilServerScrive(page, 'f515', { status: 'design', statusReason: 'clarify', workingSince: null });
  await page.evaluate(() => window.__fbTest.liveMessage({
    kind: 'reconcile',
    versions: Object.values(window.__srv.docs).map((d) => ({ _id: d._id, _updateTime: d._updateTime, createdAt: d.createdAt })),
  }));
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__srv.letture)).toBe(fuori);
  expect(await page.evaluate(() => window.__srv.dettagli)).toBe(0);

  // Al rientro il giro della pagina non porta niente: il cambio può venire solo dall'esito messo da parte.
  await page.evaluate(() => window.__fbTest.setLiveSources({ giro: async () => ({ ok: true, giro: { kind: 'skipped' } }) }));
  await shell.evaluate((id) => window.filoShell.tabs.activate(id), feedback);
  await expect(linguetta(page, 'inbox')).toHaveText('Ricevuti (2)', { timeout: 4000 });
  await expect(linguetta(page, 'queue')).toHaveText('In coda (0)');
});

test('un giro senza risposta non ferma la pagina: oltre il tempo se ne fa un altro', async ({ openTab }) => {
  const page = await apri(openTab, [fb('f716', 716, 'design'), fb('f600', 600, 'design')],
    { tempi: { pollMs: 400, rientroMs: 300, clockMs: 100, bloccatoMs: 1500 } });
  await page.evaluate(() => {
    window.__giri = 0;
    window.__fbTest.setLiveSources({
      giro: async () => {
        window.__giri += 1;
        if (window.__giri === 1) return new Promise(() => {});
        return {
          ok: true,
          giro: { kind: 'reconcile', versions: Object.values(window.__srv.docs).map((d) => ({ _id: d._id, _updateTime: d._updateTime })) },
        };
      },
    });
  });
  await ilServerScrive(page, 'f600', { status: 'todo' });
  await expect(linguetta(page, 'queue')).toHaveText('In coda (1)', { timeout: 10_000 });
  expect(await page.evaluate(() => window.__giri)).toBeGreaterThan(1);
});

test('il ridisegno aspetta chi scrive e chi punta un pulsante; i numeri no', async ({ openTab }) => {
  const docs = [
    fb('f700', 700, 'design', { statusReason: 'clarify', notes: 'Quale pagina?' }),
    fb('f699', 699, 'design'),
    fb('f698', 698, 'design'),
  ];
  const page = await apri(openTab, docs);
  await expect.poll(() => ids(page)).toEqual(['f700', 'f699', 'f698']);

  // Una risposta a metà: la lista non si ricompone, il numero della sezione sì.
  const risposta = scheda(page, 'f700').locator('.fb-reply-text');
  await risposta.fill('Risposta a metà');
  await ilServerScrive(page, 'f699', { status: 'todo' });
  await expect(linguetta(page, 'queue')).toHaveText('In coda (1)', { timeout: 10_000 });
  await page.waitForTimeout(1000);
  expect(await ids(page)).toEqual(['f700', 'f699', 'f698']);
  await expect(risposta).toHaveValue('Risposta a metà');

  // Svuotata la casella, il ridisegno che aspettava passa.
  await risposta.fill('');
  await risposta.evaluate((el) => el.blur());
  await expect.poll(() => ids(page), { timeout: 5000 }).toEqual(['f700', 'f698']);

  // Col puntatore fermo su un pulsante la lista non si muove: sotto arriverebbe quello di un'altra scheda.
  await page.locator('#list .fb-card[data-id="f698"] .fb-act').first().hover();
  await ilServerScrive(page, 'f700', { status: 'todo', statusReason: null });
  await expect(linguetta(page, 'queue')).toHaveText('In coda (2)', { timeout: 10_000 });
  await page.waitForTimeout(2500);
  expect(await ids(page)).toEqual(['f700', 'f698']);
  await page.mouse.move(2, 2);
  await expect.poll(() => ids(page), { timeout: 5000 }).toEqual(['f698']);
  expect(await page.evaluate(() => window.__nonRicaricata)).toBe(true);
});

test('lo scorrimento resta sulla scheda che si guardava quando ne escono di più su', async ({ openTab }) => {
  const docs = [];
  for (let n = 730; n > 700; n -= 1) docs.push(fb(`f${n}`, n, 'design', { text: `Testo ${n}\n`.repeat(4) }));
  const page = await apri(openTab, docs);
  await expect(page.locator('#list .fb-card')).toHaveCount(30);
  const primaVisibile = () => page.evaluate(() => [...document.querySelectorAll('#list .fb-card')]
    .find((el) => el.getBoundingClientRect().bottom > 1)?.dataset.id);
  await page.locator('#list .fb-card[data-id="f715"]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  expect(await primaVisibile()).toBe('f715');

  await ilServerScrive(page, 'f730', { status: 'todo' });
  await ilServerScrive(page, 'f729', { status: 'todo' });
  await expect(linguetta(page, 'queue')).toHaveText('In coda (2)', { timeout: 10_000 });
  await expect.poll(() => ids(page).then((l) => l.length), { timeout: 5000 }).toBe(28);
  expect(await primaVisibile()).toBe('f715');
});
