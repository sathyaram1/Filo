// LA FIDUCIA IN GESTIONE (#1575).
//
// COSA DEVE ESSERE VERO
//   1. Non c'è una scheda «Lavori server»: un lavoro col segno sta «In coda» con l'etichetta «server».
//   2. Ogni pratica dice a colpo d'occhio se è fidata: bordo destro e scudo nel colore della fiducia, diversi fra
//      fidata e non fidata, in Ricevuti, In coda, Aspettano, Risolti, Archiviati e nelle tre schede delle Domande,
//      nei due temi; lo scudo cambia forma, non solo colore, e il bordo sinistro tiene i colori di attacco e spam.
//      L'hover dice che è la fiducia del feedback, e che il registro del ramo da qui non si legge.
//   3. «Solo non fidate» lascia solo le non fidate in ogni scheda, i numeri della barra lo seguono, e con zero non
//      fidate lo dice; «Ri-valuta» e «Approva tutti gli allineati» toccano solo le righe che si vedono.
//   4. Lo stesso filtro vale nelle Domande, coi loro numeri; aprire una pratica o una domanda fidata lo spegne.

import { test, expect } from './fixtures/electron.mjs';
import { apriScheda } from './helpers/gestione.mjs';
import { domanda } from './helpers/gestioneMainFinto.mjs';

const MANAGE = 'filo://manage/manage.html';
const VERSIONE = '2.0.0';

function fb(over = {}) {
  return Object.assign({
    _id: `fb-${over.seq}`, name: `Pratica ${over.seq}`, text: 'Testo.', subSeq: 0,
    status: 'todo', statusPublic: 'open', clientId: 'utente-x', createdAt: '2026-10-10T08:00:00Z', images: [],
  }, over);
}
const FIDATO = { clientId: 'owner:me', senderProof: 'admin', fiducia: 'fidato' };
const PANEL_SPAM = { verdicts: [{ judge: 'A', class: 'spam' }, { judge: 'B', class: 'spam' }], expectedJudges: ['A', 'B'] };
const ASPETTATO = fb({ seq: 990, name: 'Quello da fondere prima', ...FIDATO });

// Una coppia fidata / non fidata per ogni scheda dei feedback.
const COPPIE = {
  inbox: [fb({ seq: 901, status: 'aligned', ...FIDATO }), fb({ seq: 902, status: 'spam', fiducia: 'non_fidato', pipeline: PANEL_SPAM })],
  queue: [fb({ seq: 911, ...FIDATO }), fb({ seq: 912, fiducia: 'non_fidato' })],
  waiting: [
    fb({ seq: 921, ...FIDATO, waitsFor: [{ id: ASPETTATO._id, num: '990' }] }),
    fb({ seq: 922, waitsFor: [{ id: ASPETTATO._id, num: '990' }] }),
  ],
  resolved: [
    fb({ seq: 931, status: 'done', resolvedInVersion: '1.0.0', statusPublic: 'closed', ...FIDATO }),
    fb({ seq: 932, status: 'done', resolvedInVersion: '1.0.0', statusPublic: 'closed' }),
  ],
  archived: [fb({ seq: 941, status: 'archived', statusPublic: 'closed', ...FIDATO }), fb({ seq: 942, status: 'archived', statusPublic: 'closed' })],
};
// Il lavoro col segno dei lavori server, fidato, In coda.
const SERVER = fb({ seq: 913, name: 'Lavoro del server', ...FIDATO, localOnly: { by: 'routine', at: Date.parse('2026-10-17T08:00:00Z') } });
const TUTTE = [...Object.values(COPPIE).flat(), SERVER, ASPETTATO];

async function apri(page, lista = TUTTE) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      const t = msg && msg.type;
      if (t === 'auth_status') return { ok: true, signedIn: true, isAdmin: true, profile: null };
      if (t === 'merge_approvals_get') return { ok: true, pending: [], failed: [], recent: [], preapproved: [], ttlMs: 1 };
      if (t === 'feedback_update' || t === 'feedback_reevaluate') { window.__updates.push(msg); return { ok: true, outcome: 'noop' }; }
      return orig(msg);
    };
  });
  await page.evaluate(({ l, v }) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(l); window.__mgTest.setReleasedVersion(v); }, { l: lista, v: VERSIONE });
}

// Il colore che un token dà a un elemento, letto come lo legge il browser: così il confronto vale in ogni tema.
const coloreDelToken = (page, token) => page.evaluate((t) => {
  const p = document.createElement('span');
  p.style.color = `var(${t})`;
  document.body.appendChild(p);
  const c = getComputedStyle(p).color;
  p.remove();
  return c;
}, token);
const bordi = (loc) => loc.evaluate((el) => {
  const s = getComputedStyle(el);
  return { destro: s.borderRightColor, larghezza: s.borderRightWidth, sinistro: s.borderLeftColor };
});
const scudo = (loc) => loc.locator('.mg-fiducia-segno').evaluate((el) => {
  const s = getComputedStyle(el.querySelector('path'));
  const r = el.getBoundingClientRect();
  return { color: getComputedStyle(el).color, fill: s.fill, tratteggio: s.strokeDasharray, titolo: el.getAttribute('title'), parola: el.getAttribute('aria-label'), w: r.width };
});

async function controllaCoppia(page, fidata, nonFidata, dove) {
  const muschio = await coloreDelToken(page, '--mg-fidata-color');
  const prugna = await coloreDelToken(page, '--mg-nonfidata-color');
  expect(muschio, dove).not.toBe(prugna);
  const a = await bordi(fidata);
  const b = await bordi(nonFidata);
  expect(a.destro, `${dove}: bordo della fidata`).toBe(muschio);
  expect(b.destro, `${dove}: bordo della non fidata`).toBe(prugna);
  expect(a.larghezza, dove).toBe('3px');
  expect(b.larghezza, dove).toBe('3px');
  const sa = await scudo(fidata);
  const sb = await scudo(nonFidata);
  expect(sa.w, `${dove}: lo scudo si vede`).toBeGreaterThan(6);
  expect(sa.color, dove).toBe(muschio);
  expect(sb.color, dove).toBe(prugna);
  // Il colore non è l'unico segnale: pieno contro vuoto e tratteggiato, e la parola sotto il puntatore.
  expect(sa.fill, dove).toBe(muschio);
  expect(sb.fill, dove).toBe('none');
  expect(sb.tratteggio, dove).not.toBe('none');
  expect(sa.parola).toBe('Fidata');
  expect(sb.parola).toBe('Non fidata');
  expect(sa.titolo).toMatch(/^Fidata\. /);
  expect(sb.titolo).toMatch(/^Non fidata\. /);
  return { muschio, prugna, sinistroNonFidata: b.sinistro };
}

const riga = (page, f) => page.locator(`#mgList .mg-item[data-id="${f._id}"]`);
const tabBtn = (page, tab) => page.locator(`.mg-tab[data-tab="${tab}"]`);
const tema = (page, t) => page.evaluate((x) => document.documentElement.setAttribute('data-sn-theme', x), t);

test('nessuna scheda «Lavori server»: il lavoro col segno sta In coda con l’etichetta «server»', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await expect(tabBtn(page, 'local')).toHaveCount(0);
  await expect(page.locator('.mg-tab', { hasText: 'Lavori server' })).toHaveCount(0);
  await apriScheda(page, 'queue');
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (4)');
  const server = riga(page, SERVER);
  await expect(server).toBeVisible();
  await expect(server.locator('.mg-local-badge')).toHaveText('server');
  await expect(server.locator('.mg-local-badge')).toHaveAttribute('title', /^Lavoro server\./);
  await expect(riga(page, COPPIE.queue[0]).locator('.mg-local-badge')).toHaveCount(0);
});

test('fidata e non fidata si distinguono in ogni scheda dei feedback, nei due temi, senza coprire spam e attacco', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  const visti = {};
  for (const t of ['light', 'dark']) {
    await tema(page, t);
    for (const [scheda, [si, no]] of Object.entries(COPPIE)) {
      await apriScheda(page, scheda);
      await expect(riga(page, si), `${scheda}: la fidata`).toBeVisible();
      await expect(riga(page, no), `${scheda}: la non fidata`).toBeVisible();
      const c = await controllaCoppia(page, riga(page, si), riga(page, no), `${t} ${scheda}`);
      visti[t] = c;
      // Il bordo sinistro dice ancora la decisione: lo spam resta arancio sotto la fiducia.
      if (scheda === 'inbox') expect(c.sinistroNonFidata, `${t}: lo spam tiene il suo colore`).toBe('rgb(224, 142, 11)');
      // Senza altro a destra, lo scudo sta sulla riga del titolo e non va a capo da solo.
      if (scheda === 'resolved' || scheda === 'archived') {
        for (const f of [si, no]) {
          const tit = await riga(page, f).locator('.mg-item-title').boundingBox();
          const sc = await riga(page, f).locator('.mg-fiducia-segno').boundingBox();
          expect(Math.abs((sc.y + sc.height / 2) - (tit.y + tit.height / 2)), `${t} ${scheda}: scudo sulla riga del titolo`).toBeLessThan(6);
        }
      }
      if (scheda !== 'waiting') {
        await page.locator('#mgListCol').screenshot({ path: `tests/.shots/fiducia-${scheda}-${t}.png` });
      }
    }
    await page.screenshot({ path: `tests/.shots/fiducia-pagina-${t}.png` });
  }
  // I due temi hanno i loro toni: lo scuro più acceso.
  expect(visti.light.muschio).not.toBe(visti.dark.muschio);
  expect(visti.light.prugna).not.toBe(visti.dark.prugna);
});

test('l’hover dello scudo dice che è la fiducia del feedback, e che il registro del ramo da qui non si legge', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await apriScheda(page, 'queue');
  const si = riga(page, COPPIE.queue[0]).locator('.mg-fiducia-segno');
  await expect(si).toHaveAttribute('title', /fiducia del feedback/);
  await expect(si).toHaveAttribute('title', /registro del ramo, che questa pagina non legge, e se il registro è rotto ferma la fusione lo stesso/);
  await expect(riga(page, COPPIE.queue[1]).locator('.mg-fiducia-segno')).toHaveAttribute('title', /^Non fidata\. È la fiducia del feedback\./);
  // Lo scudo risponde al puntatore.
  await si.hover();
  await expect.poll(() => si.evaluate((el) => getComputedStyle(el).transform)).not.toBe('none');
});

test('«Solo non fidate»: in ogni scheda restano le non fidate, e i numeri della barra lo seguono', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await apriScheda(page, 'queue');
  const filtro = page.locator('#mgFiduciaFiltro');
  await expect(filtro).toBeVisible();
  await expect(filtro).toHaveAttribute('aria-pressed', 'false');
  await expect(filtro).toContainText('Solo non fidate (1)');
  await expect(page.locator('#mgList .mg-item')).toHaveCount(4);
  const prima = { inbox: 'Ricevuti (2)', queue: 'In coda (4)', waiting: 'Aspettano (2)', resolved: 'Risolti (2)', archived: 'Archiviati (2)' };
  for (const [t, testo] of Object.entries(prima)) await expect(tabBtn(page, t)).toHaveText(testo);
  await page.locator('#mgListCol').screenshot({ path: 'tests/.shots/fiducia-filtro-spento.png' });

  await filtro.click();
  await expect(filtro).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mgList .mg-item')).toHaveCount(1);
  await expect(riga(page, COPPIE.queue[1])).toBeVisible();
  await expect(page.locator('#mgList .mg-fiducia-segno--fidata')).toHaveCount(0);
  const dopo = { inbox: 'Ricevuti (1)', queue: 'In coda (1)', waiting: 'Aspettano (1)', resolved: 'Risolti (1)', archived: 'Archiviati (1)' };
  for (const [t, testo] of Object.entries(dopo)) await expect(tabBtn(page, t)).toHaveText(testo);
  await expect(page.locator('#mgListHead')).toHaveText('In coda (1)');
  await page.locator('#mgListCol').screenshot({ path: 'tests/.shots/fiducia-filtro-acceso.png' });
  // Vale in ogni scheda dei feedback, finché non si spegne.
  for (const [scheda, [si, no]] of Object.entries(COPPIE)) {
    await apriScheda(page, scheda);
    await expect(page.locator('#mgFiduciaFiltro')).toHaveAttribute('aria-pressed', 'true');
    await expect(riga(page, no), scheda).toBeVisible();
    await expect(riga(page, si), scheda).toHaveCount(0);
  }
  expect(await page.evaluate(() => window.__mgTest.fiduciaFiltro())).toBe(true);
  // I livelli dei Ricevuti contano quello che il filtro lascia.
  await apriScheda(page, 'inbox');
  const l2 = page.locator('#mgLivelliFiltro .mg-livello-btn[data-livello="l2"] .mg-livello-count');
  await expect(l2).toHaveText(' (1)');
  await page.locator('#mgFiduciaFiltro').click();
  await expect(page.locator('#mgList .mg-item')).toHaveCount(2);
  await expect(tabBtn(page, 'queue')).toHaveText('In coda (4)');
});

test('con zero non fidate la scheda lo dice, e la ricerca non offre il filtro', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page, [COPPIE.queue[0], SERVER]);
  await apriScheda(page, 'queue');
  const filtro = page.locator('#mgFiduciaFiltro');
  await expect(filtro).toContainText('Solo non fidate (0)');
  await filtro.click();
  await expect(page.locator('#mgList .mg-item')).toHaveCount(0);
  await expect(page.locator('#mgListEmpty')).toBeVisible();
  await expect(page.locator('#mgListEmpty')).toHaveText('Qui sono tutte fidate.');
  // Una scheda vuota davvero dice la sua frase di sempre.
  await apriScheda(page, 'archived');
  await expect(page.locator('#mgListEmpty')).toHaveText('Nessun feedback archiviato.');
  await page.evaluate(() => window.__mgTest.fiduciaFiltro(false));
  await apriScheda(page, 'queue');
  await expect(page.locator('#mgList .mg-item')).toHaveCount(2);
});

test('col filtro acceso «Approva tutti gli allineati» e «Ri-valuta» toccano solo le righe che si vedono', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  const allineataFidata = fb({ seq: 951, status: 'aligned', ...FIDATO });
  const allineataNon = fb({ seq: 952, status: 'aligned' });
  const parziale = { verdicts: [{ judge: 'A', class: 'aligned' }], expectedJudges: ['A', 'B', 'C'] };
  const biancaFidata = fb({ seq: 953, status: 'unlabeled', pipeline: parziale, ...FIDATO });
  const biancaNon = fb({ seq: 954, status: 'unlabeled', pipeline: parziale });
  await apri(page, [allineataFidata, allineataNon, biancaFidata, biancaNon]);
  await apriScheda(page, 'inbox');
  await expect(page.locator('#mgAlignedBtn')).toHaveText('Approva tutti gli allineati (2) → In coda');
  await expect(page.locator('#mgReevalBtn')).toHaveText('Ri-valuta i non filtrati (2)');
  await page.locator('#mgFiduciaFiltro').click();
  await expect(page.locator('#mgAlignedBtn')).toHaveText('Approva tutti gli allineati (1) → In coda');
  await expect(page.locator('#mgReevalBtn')).toHaveText('Ri-valuta i non filtrati (1)');
  await page.locator('#mgAlignedBtn').click();
  await expect(page.locator('#mgAlignedMsg')).toContainText('1 approvati');
  await page.locator('#mgReevalBtn').click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(2);
  const scritte = await page.evaluate(() => window.__updates);
  expect(scritte.find((u) => u.type === 'feedback_update')).toMatchObject({ id: allineataNon._id, status: 'todo' });
  expect(scritte.find((u) => u.type === 'feedback_reevaluate')).toMatchObject({ feedbackIds: [biancaNon._id] });
});

test('aprire una pratica fidata dal suo numero in una domanda la mostra anche col filtro acceso', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  const fidata = COPPIE.queue[0];
  await page.evaluate(({ l, r }) => window.__mgTest.setDomande(l, { riferimenti: r }), {
    l: [domanda(40, { fiducia: 'non_fidato', origine: { tipo: 'feedback', id: fidata._id } })],
    r: { [fidata._id]: { num: '#911' } },
  });
  await apriScheda(page, 'queue');
  await page.locator('#mgFiduciaFiltro').click();
  await expect(riga(page, fidata)).toHaveCount(0);
  await apriScheda(page, 'domande');
  await page.locator('#mgDomandaDettaglio [data-feedback="#911"]').click();
  await expect(page.locator('#mgFiduciaFiltro')).toHaveAttribute('aria-pressed', 'false');
  await expect(riga(page, fidata)).toHaveClass(/mg-item--selected/);
  await expect(page.locator('#mgDetail')).toBeVisible();
});

test('Domande: le righe portano lo stesso segno, la pastiglia aperta gli stessi colori, e il filtro le conta', async ({ openTab }) => {
  const page = await openTab(MANAGE);
  await apri(page);
  await page.evaluate((l) => window.__mgTest.setDomande(l), [
    domanda(31, { titolo: 'Da una sessione pulita', fiducia: 'fidato' }),
    domanda(32, { titolo: 'Ha letto testo di fuori', fiducia: 'non_fidato' }),
    domanda(33, { titolo: 'In lavorazione, pulita', fiducia: 'fidato', stato: 'in_lavorazione' }),
    domanda(34, { titolo: 'In lavorazione, sporca', fiducia: 'non_fidato', stato: 'in_lavorazione' }),
    domanda(35, { titolo: 'Archiviata, pulita', fiducia: 'fidato', stato: 'chiusa', esito: { archiviata: true } }),
    domanda(36, { titolo: 'Archiviata, sporca', fiducia: 'non_fidato', stato: 'chiusa', esito: { archiviata: true } }),
  ]);
  const d = (id) => page.locator(`#mgDomandeLista .mg-domanda[data-id="${id}"]`);
  const schede = { domande: ['D-31', 'D-32'], 'domande-lavoro': ['D-33', 'D-34'], 'domande-archivio': ['D-35', 'D-36'] };
  for (const t of ['light', 'dark']) {
    await tema(page, t);
    for (const [scheda, [si, no]] of Object.entries(schede)) {
      await apriScheda(page, scheda);
      await expect(d(si), scheda).toBeVisible();
      await controllaCoppia(page, d(si), d(no), `${t} ${scheda}`);
    }
    // La domanda aperta: la pastiglia ha i colori del suo segno in lista.
    await apriScheda(page, 'domande');
    await d('D-32').click();
    const pastiglia = page.locator('#mgDomandaDettaglio .mg-dq-meta .mg-dq-fiducia');
    await expect(pastiglia).toHaveText('Non fidata');
    expect(await pastiglia.evaluate((el) => getComputedStyle(el).color)).toBe(await coloreDelToken(page, '--mg-nonfidata-color'));
    await d('D-31').click();
    await expect(pastiglia).toHaveText('Fidata');
    expect(await pastiglia.evaluate((el) => getComputedStyle(el).color)).toBe(await coloreDelToken(page, '--mg-fidata-color'));
    await page.locator('#mgDomandeCol').screenshot({ path: `tests/.shots/fiducia-domande-${t}.png` });
  }
  await expect(d('D-31').locator('.mg-fiducia-segno')).toHaveAttribute('title', /^Fidata\. L’ha scritta una sessione/);
  await expect(tabBtn(page, 'domande')).toHaveText('Da rispondere (2)');
  const filtro = page.locator('#mgDomandeFiduciaFiltro');
  await expect(filtro).toBeVisible();
  await expect(filtro).toContainText('Solo non fidate (1)');
  await filtro.click();
  await expect(filtro).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mgDomandeLista .mg-domanda')).toHaveCount(1);
  await expect(d('D-32')).toBeVisible();
  for (const [t, testo] of Object.entries({ domande: 'Da rispondere (1)', 'domande-lavoro': 'In lavorazione (1)', 'domande-archivio': 'Archivio (1)' })) {
    await expect(tabBtn(page, t)).toHaveText(testo);
  }
  // La sezione conta come Feedback, a filtro spento.
  await expect(page.locator('.mg-sezione[data-sezione="domande"] .mg-sezione-count')).toHaveText('(2)');
  await page.locator('#mgDomandeCol').screenshot({ path: 'tests/.shots/fiducia-domande-filtro.png' });
  // Uno stato solo: la lista dei feedback lo vede acceso.
  await apriScheda(page, 'queue');
  await expect(page.locator('#mgFiduciaFiltro')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mgList .mg-item')).toHaveCount(1);
  // Aprire una domanda fidata la mostra: il filtro si spegne.
  await page.evaluate(() => window.SN_MG_DOMANDE.apriDomanda('D-31'));
  await expect(page.locator('#mgDomandeFiduciaFiltro')).toHaveAttribute('aria-pressed', 'false');
  await expect(d('D-31')).toHaveClass(/mg-domanda--aperta/);
});

// Il testo vero del titolo, non la sua scatola: un nome che non va a capo esce dalla scatola e passa sotto il tasto.
const testaDomande = (page) => page.evaluate(() => {
  const r = document.createRange();
  r.selectNodeContents(document.getElementById('mgDomandeTitolo'));
  const testo = [...r.getClientRects()];
  const p = document.getElementById('mgDomandeFiduciaFiltro').getBoundingClientRect();
  const btn = document.getElementById('mgDomandeConsiglioSel').getBoundingClientRect();
  const col = document.getElementById('mgDomandeCol').getBoundingClientRect();
  return {
    sotto: testo.some((x) => x.right > p.left + 1 && x.left < p.right - 1 && x.bottom > p.top + 1 && x.top < p.bottom - 1),
    fuori: btn.right > col.right + 0.5,
  };
});

for (const w of [1280, 1000]) {
  test(`Domande a ${w} px: il titolo della scheda, «Solo non fidate» e «Applica il consiglio» stanno tutti nella testa`, async ({ openTab }) => {
    const page = await openTab(MANAGE);
    await apri(page, []);
    await page.evaluate((l) => window.__mgTest.setDomande(l), [
      domanda(31, { fiducia: 'fidato' }), domanda(32, { fiducia: 'non_fidato' }),
      domanda(33, { fiducia: 'non_fidato', stato: 'in_lavorazione' }),
    ]);
    await page.setViewportSize({ width: w, height: 700 });
    await apriScheda(page, 'domande-lavoro');
    await expect(page.locator('#mgDomandeFiduciaFiltro')).toBeVisible();
    expect(await testaDomande(page), 'In lavorazione').toEqual({ sotto: false, fuori: false });
    await apriScheda(page, 'domande');
    await page.locator('#mgDomandeTutte').check();
    await expect(page.locator('#mgDomandeConsiglioSel')).toBeVisible();
    expect(await testaDomande(page), 'Da rispondere, con le domande scelte').toEqual({ sotto: false, fuori: false });
    await page.locator('#mgDomandeCol').screenshot({ path: `tests/.shots/fiducia-domande-testa-${w}.png` });
  });
}
