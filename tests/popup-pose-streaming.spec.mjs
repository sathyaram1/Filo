// #502 — "La finestra della spiegazione approfondita esce dal fondo dello
// schermo quando la risposta arriva": il riquadro `.sn-popup` si apre vuoto
// sopra la selezione, poi il testo in streaming lo allunga fino al suo tetto e
// nessuno lo rimisura. Chi seleziona una parola nella metà bassa della finestra
// si ritrova la riga per scrivere la domanda successiva fuori dallo schermo, e
// da lì non può più chiedere niente.
//
// Qui giriamo lo scenario vero: selezione a tre quarti dell'altezza, risposta
// lunga che arriva a pezzi, e asseriamo il SUCCESSO dal punto di vista
// dell'utente — a risposta finita la riga per scrivere è dentro lo schermo E
// cliccabile (il punto sotto il cursore è davvero la casella di testo), e non
// è mai uscita nemmeno per un istante mentre la risposta arrivava.
//
// Senza il fix: il riquadro cresce da ~210px al tetto restando ancorato dov'era
// stato posato da vuoto, il fondo scende sotto il bordo e l'assert sulla
// casella di testo dentro il viewport diventa rosso.

import { test, expect } from './fixtures/electron.mjs';

// Provider finto: manda una risposta lunga a pezzi, con una pausa fra uno e
// l'altro. La lunghezza serve a portare il riquadro al suo tetto d'altezza; le
// pause servono a poterlo guardare MENTRE cresce, che è il momento del difetto.
// Il corpo della funzione gira nel processo main, dove le variabili del file di
// test non arrivano: i pezzi si costruiscono lì dentro.
async function preparaProvider(app, attesaMs = 4000) {
  // NB: il primo argomento che arriva qui è il modulo Electron; il nostro
  // parametro è il SECONDO. Scambiarli fa diventare l'attesa uno zero, e il
  // test non guarda più il riquadro da vuoto.
  await app.evaluate(async (_electron, attesa) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { gemini: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'flash-lite-3' },
      modelRegistry: C.DEFAULT_MODEL_REGISTRY,
    });
    const pezzi = Array.from({ length: 12 }, (_, i) =>
      `Paragrafo ${i + 1}: una spiegazione distesa della parola selezionata, con abbastanza testo da far crescere il riquadro fino al suo tetto di altezza. `);
    globalThis.__origGemPose = globalThis.SN_PROVIDER_GEMINI;
    globalThis.SN_PROVIDER_GEMINI = {
      ...globalThis.__origGemPose,
      streamComplete: async ({ onDelta }) => {
        // Attesa iniziale come quella vera di un modello: è la finestra in cui
        // il riquadro sta aperto e vuoto, e in cui l'utente può spostarlo.
        await new Promise((r) => setTimeout(r, attesa));
        for (const p of pezzi) {
          onDelta(p);
          await new Promise((r) => setTimeout(r, 40));
        }
        return { text: pezzi.join(''), usage: {} };
      },
    };
  }, attesaMs);
}

async function ripristinaProvider(app) {
  await app.evaluate(() => {
    if (globalThis.__origGemPose) globalThis.SN_PROVIDER_GEMINI = globalThis.__origGemPose;
  });
}

// L'apertura ha una sua animazione (dissolvenza con 2px di scivolata): non è la
// posa, è l'ingresso. Chi misura prima che finisca legge una posizione che
// nessuno ha deciso. Aspettiamo che sia finita e poi guardiamo.
const attendiIngresso = async (page) => {
  await page.evaluate(async () => {
    const root = document.querySelector('.sn-popup');
    if (!root?.getAnimations) return;
    await Promise.all(root.getAnimations().map((a) => a.finished.catch(() => {})));
  });
};

// Legge la posa corrente: ingombro del riquadro e della riga per scrivere.
const misura = () => {
  const root = document.querySelector('.sn-popup');
  if (!root) return null;
  const input = root.querySelector('.sn-popup-input');
  const send = root.querySelector('.sn-popup-send');
  const r = root.getBoundingClientRect();
  const i = input.getBoundingClientRect();
  const s = send ? send.getBoundingClientRect() : null;
  const compose = root.querySelector('.sn-popup-compose');
  const c = compose ? compose.getBoundingClientRect() : null;
  return {
    vh: window.innerHeight,
    vw: window.innerWidth,
    top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height,
    inputTop: i.top, inputBottom: i.bottom, inputLeft: i.left, inputRight: i.right,
    sendRight: s ? s.right : 0,
    composeBottom: c ? c.bottom : 0,
  };
};

// Elenco dei bordi da cui il riquadro (o la riga per scrivere) sta uscendo.
// Vuoto = è tutto dentro lo schermo. Gira nel processo di test, su una misura
// già presa: torna un elenco e non un booleano così il messaggio d'errore dice
// da che parte è uscito e di quanto.
const fuoriDaiBordi = (m) => {
  if (!m) return ['riquadro sparito'];
  const fuori = [];
  // Prima di tutto: sta dentro il RIQUADRO STESSO. Quando il tetto d'altezza
  // scende sotto la somma dei minimi dei pezzi interni, il riquadro smette di
  // accorciarsi e i pezzi escono dal suo bordo — e il conto del minimo si
  // dimenticava dell'imbottitura del corpo, che `min-height: 0` non toglie.
  // Il risultato: la riga per scrivere sporgeva oltre il bordo arrotondato, e
  // dentro un riquadro incorporato basso il browser la tagliava a metà. Si vede
  // anche quando il riquadro nel suo insieme è dentro lo schermo, quindi va
  // guardato per primo e in ogni scenario.
  if (m.composeBottom > m.bottom + 1) {
    fuori.push(`riga per scrivere oltre il bordo del riquadro di ${Math.round(m.composeBottom - m.bottom)}px`);
  }
  if (m.bottom > m.vh + 1) fuori.push(`fondo oltre il bordo di ${Math.round(m.bottom - m.vh)}px (vh=${m.vh})`);
  if (m.top < -1) fuori.push(`cima oltre il bordo di ${Math.round(-m.top)}px`);
  if (m.inputBottom > m.vh) fuori.push(`riga per scrivere sotto il bordo di ${Math.round(m.inputBottom - m.vh)}px`);
  if (m.inputTop < 0) fuori.push(`riga per scrivere sopra il bordo di ${Math.round(-m.inputTop)}px`);
  // Anche di lato: dentro un riquadro incorporato stretto è da destra che esce
  // il tasto di invio, e lì il browser lo taglia via esattamente come sotto.
  if (m.right > m.vw + 1) fuori.push(`destra oltre il bordo di ${Math.round(m.right - m.vw)}px (vw=${m.vw})`);
  if (m.left < -1) fuori.push(`sinistra oltre il bordo di ${Math.round(-m.left)}px`);
  if (m.sendRight > m.vw + 1) fuori.push(`tasto di invio oltre il bordo destro di ${Math.round(m.sendRight - m.vw)}px`);
  return fuori;
};

// La riga per scrivere non è solo "dentro le coordinate": sotto il cursore, al
// centro della casella, ci deve essere davvero la casella.
const casellaCliccabile = () => {
  const root = document.querySelector('.sn-popup');
  if (!root) return false;
  const input = root.querySelector('.sn-popup-input');
  const r = input.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!el && (el === input || input.contains(el));
};

test('spiegazione approfondita su selezione in basso: la riga per scrivere resta dentro lo schermo mentre la risposta arriva', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(
    () => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST,
    null, { timeout: 8000 },
  );

  await preparaProvider(app);

  // Selezione a tre quarti dell'altezza della finestra, come nella segnalazione.
  const ancora = await page.evaluate(() => {
    const y = Math.round(window.innerHeight * 0.75);
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y },
      title: 'Approfondisci',
    });
    return { y, vh: window.innerHeight };
  });

  // Il riquadro nasce vuoto: è questa l'altezza su cui il vecchio codice posava.
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await attendiIngresso(page);
  const daVuoto = await page.evaluate(misura);
  expect(daVuoto).not.toBeNull();
  // La misura è presa DAVVERO da vuoto: se la risposta fosse già arrivata il
  // test non guarderebbe più la crescita, e passerebbe senza provare niente.
  expect(daVuoto.height, 'la risposta è arrivata prima della misura da vuoto').toBeLessThan(350);

  // Mentre la risposta arriva, campiona la posa: nessun istante in cui il
  // riquadro sborda dal fondo (né dagli altri bordi).
  const sconfinamenti = [];
  const finoA = Date.now() + 12_000;
  let cresciuto = daVuoto.height;
  while (Date.now() < finoA) {
    const m = await page.evaluate(misura);
    if (!m) break;
    cresciuto = Math.max(cresciuto, m.height);
    if (m.bottom > m.vh + 1 || m.top < -1 || m.left < -1 || m.right > m.vw + 1) {
      sconfinamenti.push(m);
    }
    const fatto = await page.locator('.sn-popup .sn-popup-meta').textContent().catch(() => '');
    if (fatto && fatto.includes('€')) break;
    await page.waitForTimeout(60);
  }

  // Il turno è chiuso: quello che vediamo è la risposta finale, non un fotogramma.
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 15_000 });
  await expect(page.locator('.sn-popup .sn-msg-assistant .sn-msg-text').last())
    .toContainText('Paragrafo 12', { timeout: 5000 });

  // Lo scenario è quello vero: il riquadro è cresciuto parecchio dopo l'apertura.
  expect(cresciuto).toBeGreaterThan(daVuoto.height + 100);

  const finale = await page.evaluate(misura);

  // SUCCESSO 1 — la riga per scrivere la domanda successiva è dentro lo schermo.
  expect(finale.inputBottom).toBeLessThanOrEqual(finale.vh);
  expect(finale.inputTop).toBeGreaterThanOrEqual(0);
  // E tutto il riquadro con lei.
  expect(finale.bottom).toBeLessThanOrEqual(finale.vh + 1);
  expect(finale.top).toBeGreaterThanOrEqual(-1);

  // SUCCESSO 2 — non è solo "dentro le coordinate": è CLICCABILE. Puntiamo il
  // centro della casella e sotto il cursore deve esserci la casella stessa.
  const cliccabile = await page.evaluate(() => {
    const root = document.querySelector('.sn-popup');
    const input = root.querySelector('.sn-popup-input');
    const r = input.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!el && (el === input || input.contains(el));
  });
  expect(cliccabile).toBe(true);

  // SUCCESSO 3 — e ci si può davvero scrivere dentro.
  await page.locator('.sn-popup .sn-popup-input').click();
  await page.locator('.sn-popup .sn-popup-input').fill('e questo cosa vuol dire?');
  await expect(page.locator('.sn-popup .sn-popup-input')).toHaveValue('e questo cosa vuol dire?');

  // Nessuno sconfinamento nemmeno a metà streaming.
  expect(sconfinamenti, `posa fuori dallo schermo durante lo streaming: ${JSON.stringify(sconfinamenti.slice(0, 3))}`).toEqual([]);

  // Traccia visiva della run (gitignorata).
  try { await page.screenshot({ path: 'tests/.shots/popup-pose-streaming.png' }); } catch (_) {}

  expect(ancora.y).toBeGreaterThan(0);
  await ripristinaProvider(app);
});

test('selezione a metà finestra: il riquadro si accorcia invece di sbordare, e non salta', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(
    () => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST,
    null, { timeout: 8000 },
  );

  await preparaProvider(app);

  // A metà finestra il riquadro VUOTO ci sta comodo sotto la selezione: il
  // vecchio codice lo posava lì e non ci tornava più, poi la risposta lo
  // allungava e il fondo scendeva sotto il bordo. È l'altra metà del difetto —
  // dove non basta "girarlo di sopra", perché sopra lo spazio non è di più:
  // l'altezza va stretta a quella disponibile e il corpo deve scorrere.
  await page.evaluate(() => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y: Math.round(window.innerHeight * 0.5) },
      title: 'Approfondisci',
    });
  });

  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await attendiIngresso(page);
  const daVuoto = await page.evaluate(misura);
  expect(daVuoto.height, 'la risposta è arrivata prima della misura da vuoto').toBeLessThan(350);

  const cime = new Set();
  const finoA = Date.now() + 12_000;
  while (Date.now() < finoA) {
    const m = await page.evaluate(misura);
    if (!m) break;
    cime.add(Math.round(m.top));
    // Nemmeno per un fotogramma: se sborda, qui il test è già rosso.
    expect(m.bottom, `riquadro fuori dal fondo a metà risposta (vh=${m.vh})`).toBeLessThanOrEqual(m.vh + 1);
    const fatto = await page.locator('.sn-popup .sn-popup-meta').textContent().catch(() => '');
    if (fatto && fatto.includes('€')) break;
    await page.waitForTimeout(60);
  }

  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 15_000 });

  const finale = await page.evaluate(misura);
  // Il lato scelto è "sotto" e non cambia: la cima non si è mai mossa, niente
  // salto a metà risposta.
  expect([...cime]).toEqual([Math.round(daVuoto.top)]);
  expect(Math.round(finale.top)).toBe(Math.round(daVuoto.top));
  // E la riga per scrivere è dentro lo schermo, cliccabile.
  expect(finale.inputBottom).toBeLessThanOrEqual(finale.vh);
  const cliccabile = await page.evaluate(() => {
    const input = document.querySelector('.sn-popup .sn-popup-input');
    const r = input.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!el && (el === input || input.contains(el));
  });
  expect(cliccabile).toBe(true);

  // Il testo non è andato perduto con l'altezza: il corpo scorre.
  await expect(page.locator('.sn-popup .sn-msg-assistant .sn-msg-text').last())
    .toContainText('Paragrafo 12', { timeout: 5000 });

  await ripristinaProvider(app);
});

// I due test sopra aprono il riquadro chiamando l'app dall'interno. Questo fa
// esattamente quello che fa chi ha segnalato: pagina web vera, parola
// selezionata col mouse a tre quarti dell'altezza, Alt+E, e si aspetta la
// risposta. È la strada che passa per la scorciatoia globale e per l'ancora
// ricavata dalla selezione — se il rimedio non arrivasse fin qui, qui si vede.
const PAGINA = `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; font: 16px/1.6 system-ui, sans-serif; }
  #riempitivo { height: 300vh; padding: 20px; }
  #bersaglio { position: fixed; left: 40px; top: 75vh; font-size: 20px; }
</style>
<div id="riempitivo">Testo di contorno, serve solo a dare corpo alla pagina.</div>
<p id="bersaglio">supercalifragilistico</p>`;

test('Alt+E su una parola in basso in una pagina vera: la riga per scrivere resta usabile', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await preparaProvider(app);

  // Selezione col mouse, come la fa un utente: doppio clic sulla parola.
  await page.locator('#bersaglio').dblclick();
  await expect
    .poll(() => page.evaluate(() => String(window.getSelection())), { timeout: 5000 })
    .toContain('supercalifragilistico');

  // La scorciatoia globale, la stessa strada di Alt+E.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });

  await page.waitForSelector('.sn-popup', { timeout: 10_000 });
  await attendiIngresso(page);
  const daVuoto = await page.evaluate(misura);
  expect(daVuoto).not.toBeNull();
  // La misura è presa DAVVERO da vuoto: se la risposta fosse già arrivata il
  // test non guarderebbe più la crescita, e passerebbe senza provare niente.
  expect(daVuoto.height, 'la risposta è arrivata prima della misura da vuoto').toBeLessThan(350);

  // Guarda la posa MENTRE la risposta arriva: non deve sbordare mai.
  const sconfinamenti = [];
  let cresciuto = daVuoto.height;
  const finoA = Date.now() + 20_000;
  while (Date.now() < finoA) {
    const m = await page.evaluate(misura);
    if (!m) break;
    cresciuto = Math.max(cresciuto, m.height);
    if (m.bottom > m.vh + 1 || m.top < -1) sconfinamenti.push(m);
    const fatto = await page.locator('.sn-popup .sn-popup-meta').textContent().catch(() => '');
    if (fatto && fatto.includes('€')) break;
    await page.waitForTimeout(60);
  }

  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
  // Lo scenario è quello vero: il riquadro è cresciuto parecchio dopo l'apertura.
  expect(cresciuto).toBeGreaterThan(daVuoto.height + 100);

  const finale = await page.evaluate(misura);
  expect(finale.bottom).toBeLessThanOrEqual(finale.vh + 1);
  expect(finale.top).toBeGreaterThanOrEqual(-1);
  expect(finale.inputBottom).toBeLessThanOrEqual(finale.vh);
  expect(finale.inputTop).toBeGreaterThanOrEqual(0);
  expect(sconfinamenti, `posa fuori dallo schermo durante lo streaming: ${JSON.stringify(sconfinamenti.slice(0, 3))}`).toEqual([]);

  // E la domanda successiva si può davvero fare: la casella si clicca e accetta
  // testo. È questo che l'utente non riusciva più a fare.
  await page.locator('.sn-popup .sn-popup-input').click();
  await page.locator('.sn-popup .sn-popup-input').fill('e questo cosa vuol dire?');
  await expect(page.locator('.sn-popup .sn-popup-input')).toHaveValue('e questo cosa vuol dire?');

  await ripristinaProvider(app);
});

// Il riquadro posato SOPRA la selezione è agganciato col fondo, non con la
// cima. Chi lo trascina passa all'aggancio dall'alto: se il passaggio non fosse
// pulito il riquadro resterebbe legato a tutti e due i bordi e si stirerebbe da
// cima a fondo dello schermo. E una volta spostato deve restare dove l'utente
// l'ha messo, anche mentre la risposta continua ad arrivare.
test('trascinato mentre la risposta arriva: si sposta, non si stira e non torna indietro', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await page.waitForFunction(
    () => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST,
    null, { timeout: 8000 },
  );

  // Attesa lunga di proposito: il trascinamento deve avvenire mentre il
  // riquadro è ancora VUOTO, altrimenti non si distingue la crescita del
  // contenuto da uno stiramento.
  await preparaProvider(app, 9000);

  // In basso: il riquadro va sopra la selezione, quindi agganciato col fondo.
  await page.evaluate(() => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y: Math.round(window.innerHeight * 0.75) },
      title: 'Approfondisci',
    });
  });
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await attendiIngresso(page);
  const prima = await page.evaluate(misura);

  // Trascina l'intestazione verso l'alto a sinistra, come farebbe un utente.
  const header = page.locator('.sn-popup-header');
  const hb = await header.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 60, hb.y + hb.height / 2 - 120, { steps: 10 });
  await page.mouse.up();

  const dopo = await page.evaluate(misura);
  // Si è spostato davvero…
  expect(Math.round(dopo.top)).toBeLessThan(Math.round(prima.top));
  expect(Math.round(dopo.left)).toBeLessThan(Math.round(prima.left));
  // …e NON si è stirato: l'altezza è quella di prima, non tutto lo schermo.
  expect(Math.abs(dopo.height - prima.height)).toBeLessThanOrEqual(2);
  expect(dopo.height).toBeLessThan(dopo.vh - 50);

  // La risposta finisce di arrivare: il riquadro resta dove l'utente l'ha messo.
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
  const finale = await page.evaluate(misura);
  expect(Math.round(finale.left)).toBe(Math.round(dopo.left));
  expect(finale.bottom).toBeLessThanOrEqual(finale.vh + 1);
  expect(finale.top).toBeGreaterThanOrEqual(-1);
  // E la riga per scrivere è comunque raggiungibile.
  expect(finale.inputBottom).toBeLessThanOrEqual(finale.vh);

  await ripristinaProvider(app);
});

// La scorciatoia ancora il riquadro al FONDO del rettangolo della selezione. Se
// la selezione continua sotto la piega quel fondo è fuori dallo schermo, e
// "sopra il punto" è fuori a sua volta: il riquadro nascerebbe già sbordato,
// senza nemmeno aspettare la risposta.
const PAGINA_LUNGA = `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; font: 16px/1.6 system-ui, sans-serif; }
  #testa { height: 60vh; padding: 20px; }
  #lungo { padding: 0 20px; }
</style>
<div id="testa">Intestazione della pagina.</div>
<p id="lungo">${'Un paragrafo che comincia in fondo alla finestra e prosegue ben oltre la piega, tanto da avere il proprio fondo fuori dallo schermo. '.repeat(40)}</p>`;

test('selezione che prosegue sotto la piega: il riquadro nasce dentro lo schermo, non fuori', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA_LUNGA);
  await preparaProvider(app);

  // Seleziona tutto il paragrafo: comincia visibile, finisce sotto la piega.
  const fuori = await page.evaluate(() => {
    const p = document.querySelector('#lungo');
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const r = range.getBoundingClientRect();
    return { fondo: r.bottom, vh: window.innerHeight };
  });
  // Lo scenario è quello vero: il fondo della selezione è fuori dallo schermo.
  expect(fuori.fondo).toBeGreaterThan(fuori.vh);

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });

  await page.waitForSelector('.sn-popup', { timeout: 10_000 });
  await attendiIngresso(page);

  // Già da vuoto è dentro lo schermo.
  const daVuoto = await page.evaluate(misura);
  expect(daVuoto.bottom, 'il riquadro nasce già fuori dal fondo').toBeLessThanOrEqual(daVuoto.vh + 1);
  expect(daVuoto.top).toBeGreaterThanOrEqual(-1);

  // E ci resta quando la risposta lo fa crescere.
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
  const finale = await page.evaluate(misura);
  expect(finale.bottom).toBeLessThanOrEqual(finale.vh + 1);
  expect(finale.top).toBeGreaterThanOrEqual(-1);
  expect(finale.inputBottom).toBeLessThanOrEqual(finale.vh);
  expect(finale.inputTop).toBeGreaterThanOrEqual(0);

  await ripristinaProvider(app);
});

// ─────────────────────────────────────────────────────────────────────────────
// Lo spazio a disposizione può cambiare DOPO che il riquadro si è posato: in
// Filo lo zoom della pagina si usa di continuo (Ctrl +/-, pinch, rotella) e la
// finestra dell'app si ridimensiona. Il punto a cui il riquadro si aggancia
// veniva riportato dentro lo schermo una volta sola, all'apertura: se poi la
// finestra si accorciava, quel punto restava dov'era — ormai oltre il bordo —
// e il riquadro veniva riposato rispetto a un posto che non esiste più. Stesso
// sintomo del difetto segnalato (la riga per scrivere fuori dallo schermo), da
// un'altra porta, e senza nemmeno bisogno che arrivi una risposta.
// ─────────────────────────────────────────────────────────────────────────────

// Cambia lo zoom della SCHEDA: è la strada in cui finiscono tutte le vie di
// zoom di Filo (Ctrl +/-, pinch, rotella passano da webFrame.setZoomLevel, che
// è la stessa manopola di webContents).
async function zoomScheda(app, fattore) {
  await app.evaluate(({ BrowserWindow }, f) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    for (const t of (win?._filoTabs?.tabs || [])) {
      try { t.view.webContents.setZoomFactor(f); } catch (_) {}
    }
  }, fattore);
}

// Accorcia la FINESTRA come la vede la pagina.
//
// Perché non `win.setBounds`: durante i test la finestra sta fuori schermo
// (`src/main/test-window-mode.js`) e la nuova altezza arriva sì alla vista, ma
// NON al renderer — `window.innerHeight` resta quello di prima, misurato. Fatto
// così il test non proverebbe niente. `setViewportSize` consegna alla pagina
// esattamente quello che le arriva quando l'utente rimpicciolisce la finestra:
// viewport più bassa ed evento `resize`, che è tutto ciò su cui la posa ragiona.
async function altezzaFinestra(page, px) {
  const w = await page.evaluate(() => window.innerWidth);
  await page.setViewportSize({ width: w, height: px });
}

// Apre il riquadro su una selezione in basso e aspetta che la risposta sia
// finita: da qui in poi il riquadro è alto quanto può, ed è posato.
async function riquadroPosato(app, page, frazione = 0.75) {
  await page.waitForFunction(
    () => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST,
    null, { timeout: 8000 },
  );
  await preparaProvider(app, 300);
  await page.evaluate((f) => {
    window.SN_POPUP.openStreaming({
      action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
      payload: { selection: 'parola', sentence: 'una frase con parola dentro' },
      anchor: { x: 120, y: Math.round(window.innerHeight * f) },
      title: 'Approfondisci',
    });
  }, frazione);
  await page.waitForSelector('.sn-popup', { timeout: 8000 });
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
  await attendiIngresso(page);
  return page.evaluate(misura);
}

test('zoom della pagina col riquadro aperto: resta dentro lo schermo, e tornando allo zoom di prima torna alto com\'era', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  const prima = await riquadroPosato(app, page);
  expect(prima.bottom).toBeLessThanOrEqual(prima.vh + 1);

  // Zoom al 150% mentre il riquadro sta lì. Lo spazio si accorcia sotto il
  // punto ancorato: senza il rimedio il riquadro non si sposta e il suo fondo
  // resta dov'era, decine di pixel sotto il bordo.
  await zoomScheda(app, 1.5);
  await expect.poll(
    () => page.evaluate(() => window.innerHeight),
    { timeout: 5000, message: 'lo zoom non ha accorciato la finestra: lo scenario non è quello vero' },
  ).toBeLessThan(prima.vh - 50);

  // Il browser aggiorna `innerHeight` prima di consegnare `resize` a JS: per un
  // fotogramma il riquadro è ancora posato sulla finestra di prima. Quello che
  // conta è dove si ferma — senza il rimedio ci resta e basta.
  await expect.poll(
    async () => fuoriDaiBordi(await page.evaluate(misura)),
    { timeout: 5000, message: 'dopo lo zoom il riquadro è rimasto fuori dallo schermo' },
  ).toEqual([]);

  const zoomato = await page.evaluate(misura);
  // È questo che l'utente non riusciva più a fare.
  expect(await page.evaluate(casellaCliccabile)).toBe(true);
  await page.locator('.sn-popup .sn-popup-input').click();
  await page.locator('.sn-popup .sn-popup-input').fill('e adesso?');
  await expect(page.locator('.sn-popup .sn-popup-input')).toHaveValue('e adesso?');

  // Quando lo spazio torna, il riquadro deve poter tornare alto com'era: non
  // resta stretto per sempre solo perché per un momento c'era meno posto.
  await zoomScheda(app, 1);
  await expect.poll(() => page.evaluate(() => window.innerHeight), { timeout: 5000 })
    .toBeGreaterThan(zoomato.vh + 50);
  await expect.poll(
    async () => (await page.evaluate(misura)).height,
    { timeout: 5000, message: 'tornato lo spazio, il riquadro è rimasto stretto' },
  ).toBeGreaterThan(prima.height - 3);

  expect(fuoriDaiBordi(await page.evaluate(misura))).toEqual([]);
  expect(await page.evaluate(casellaCliccabile)).toBe(true);

  await zoomScheda(app, 1);
  await ripristinaProvider(app);
});

test('finestra rimpicciolita col riquadro aperto: resta dentro lo schermo e la riga per scrivere si clicca', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  const prima = await riquadroPosato(app, page);

  // Un terzo di altezza in meno, come nella critica (da 910 a 660): abbastanza
  // da portare fuori un punto ancorato a tre quarti.
  const alta = prima.vh;
  await altezzaFinestra(page, Math.max(420, Math.round(alta * 0.62)));
  await expect.poll(
    () => page.evaluate(() => window.innerHeight),
    { timeout: 5000, message: 'la finestra non si è rimpicciolita: lo scenario non è quello vero' },
  ).toBeLessThan(prima.vh - 50);

  await expect.poll(
    async () => fuoriDaiBordi(await page.evaluate(misura)),
    { timeout: 5000, message: 'dopo il ridimensionamento il riquadro è rimasto fuori dallo schermo' },
  ).toEqual([]);
  expect(await page.evaluate(casellaCliccabile)).toBe(true);
  await page.locator('.sn-popup .sn-popup-input').click();
  await page.locator('.sn-popup .sn-popup-input').fill('e adesso?');
  await expect(page.locator('.sn-popup .sn-popup-input')).toHaveValue('e adesso?');

  // Riallargata, il riquadro torna alto com'era.
  await altezzaFinestra(page, alta);
  await expect.poll(
    async () => (await page.evaluate(misura)).height,
    { timeout: 5000, message: 'tornato lo spazio, il riquadro è rimasto stretto' },
  ).toBeGreaterThan(prima.height - 3);

  await ripristinaProvider(app);
});

// Il caso che restava scoperto: finestra bassissima GIÀ PRIMA che il riquadro si
// apra. Qui non c'è nessuna posa da correggere — c'è da nascere giusti, in uno
// spazio che non basta al tetto d'altezza né sopra né sotto il punto ancorato.
// La risposta deve restare leggibile (il corpo scorre) e la riga per scrivere
// raggiungibile: è l'unica cosa che tiene viva la conversazione.
for (const altezza of [380, 260]) {
  test(`finestra alta ${altezza}px fin dall'apertura: il riquadro nasce dentro e la riga per scrivere si clicca`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    const page = await openTab('filo://newtab/');
    await altezzaFinestra(page, altezza);
    await expect.poll(() => page.evaluate(() => window.innerHeight), { timeout: 5000 })
      .toBeLessThanOrEqual(altezza);

    const posato = await riquadroPosato(app, page);
    expect(fuoriDaiBordi(posato), 'il riquadro nasce fuori da una finestra bassa').toEqual([]);
    expect(await page.evaluate(casellaCliccabile)).toBe(true);
    await page.locator('.sn-popup .sn-popup-input').click();
    await page.locator('.sn-popup .sn-popup-input').fill('e adesso?');
    await expect(page.locator('.sn-popup .sn-popup-input')).toHaveValue('e adesso?');

    // Il testo non è andato perduto con l'altezza: il corpo scorre.
    await expect(page.locator('.sn-popup .sn-msg-assistant .sn-msg-text').last())
      .toContainText('Paragrafo 12', { timeout: 5000 });

    await ripristinaProvider(app);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// La finestra del riquadro non è sempre quella dell'app. Dentro un riquadro
// incorporato — i box dei commenti, i lettori video, le anteprime di articoli —
// il content script di Filo gira nel frame del riquadro (#405: lì dentro tasto
// destro e Alt+E funzionano apposta), e per un elemento `position: fixed` lo
// "schermo" È il riquadro. Se il riquadro è basso, il popup nasce già mozzato:
// il browser taglia via quello che esce dal bordo del frame, e non si raggiunge
// né scorrendo né trascinando il popup altrove.
//
// Qui il tetto d'altezza da solo non basta: intestazione, corpo, riga del costo
// e riga per scrivere hanno ognuno un'altezza minima, e sotto la loro somma
// stringere il tetto non stringe più niente — i pezzi escono dal bordo del
// popup invece di comprimersi. A cedere deve essere il CORPO della risposta,
// che può accorciarsi e scorrere fino a sparire.
// ─────────────────────────────────────────────────────────────────────────────

const RIQUADRO_INTERNO = `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; padding: 10px; font: 16px/1.5 system-ui, sans-serif; }
</style>
<p id="bersaglio">supercalifragilistico</p>`;

const PAGINA_CON_RIQUADRO = (src, h, w = 560) => `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; font: 16px/1.6 system-ui, sans-serif; }
  h1 { margin: 24px; font-size: 20px; }
  iframe { display: block; width: ${w}px; height: ${h}px; border: 1px solid #ccc; margin: 0 24px; }
</style>
<h1>Pagina con un riquadro incorporato</h1>
<iframe id="riquadro" src="${src}"></iframe>`;

// Il frame del riquadro, come oggetto Playwright: da lì misuriamo con le sue
// coordinate, che sono quelle su cui il popup ragiona.
async function frameDelRiquadro(page, src) {
  let f = null;
  await expect.poll(() => {
    f = page.frames().find((fr) => fr.url() === src) || null;
    return !!f;
  }, { timeout: 8000, message: 'il riquadro incorporato non si è caricato' }).toBe(true);
  return f;
}

// 130px è il gradino che serve davvero: sotto quella soglia non basta più
// stringere il tetto e togliere la riga del costo — anche l'IMBOTTITURA del
// corpo deve cedere, perché `min-height: 0` azzera il contenuto e non
// l'ingombro. Quei venti pixel non contati facevano sporgere la riga per
// scrivere oltre il bordo del riquadro, dove il frame la taglia a metà.
for (const alto of [130, 180, 240]) {
  test(`Alt+E dentro un riquadro incorporato alto ${alto}px: il riquadro nasce intero e la riga per scrivere si clicca`, async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    const src = testServer.html(RIQUADRO_INTERNO);
    const page = await testServer.openReady(openTab, PAGINA_CON_RIQUADRO(src, alto));
    await preparaProvider(app, 300);

    const frame = await frameDelRiquadro(page, src);

    // Doppio clic sulla parola DENTRO il riquadro: seleziona, e insieme dice al
    // main che è questo il frame con cui l'utente sta interagendo (#405).
    await frame.locator('#bersaglio').dblclick();
    await expect
      .poll(() => frame.evaluate(() => String(window.getSelection())), { timeout: 5000 })
      .toContain('supercalifragilistico');

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      globalThis.__filoShortcuts.dispatch('explain-selection', win);
    });

    await frame.waitForSelector('.sn-popup', { timeout: 10_000 });
    await attendiIngresso(frame);

    // Lo scenario è quello vero: il popup vive dentro il riquadro, e il riquadro
    // è più basso del tetto d'altezza del popup.
    const daVuoto = await frame.evaluate(misura);
    expect(daVuoto.vh, 'il popup non sta nel frame del riquadro').toBeLessThanOrEqual(alto);

    // SUCCESSO 1 — già da vuoto è tutto dentro il riquadro: intestazione e riga
    // per scrivere comprese. Senza il rimedio nasce mozzato, prima ancora che
    // la risposta arrivi.
    expect(fuoriDaiBordi(daVuoto), 'il popup nasce fuori dal bordo del riquadro incorporato').toEqual([]);

    // …e ci resta quando la risposta lo fa crescere.
    await expect
      .poll(() => frame.evaluate(() => document.querySelector('.sn-popup-meta')?.textContent || ''), { timeout: 20_000 })
      .toContain('€');
    const finale = await frame.evaluate(misura);
    expect(fuoriDaiBordi(finale), 'il popup è uscito dal riquadro incorporato quando la risposta è arrivata').toEqual([]);

    // SUCCESSO 2 — la riga per scrivere si clicca davvero, e accetta testo: è
    // questo che dentro un riquadro basso non si riusciva più a fare.
    expect(await frame.evaluate(casellaCliccabile)).toBe(true);
    const casella = page.frameLocator('#riquadro').locator('.sn-popup .sn-popup-input');
    await casella.click();
    await casella.fill('e questo cosa vuol dire?');
    await expect(casella).toHaveValue('e questo cosa vuol dire?');

    // SUCCESSO 3 — il tasto di invio c'è ed è cliccabile.
    const inviaDentro = await frame.evaluate(() => {
      const b = document.querySelector('.sn-popup .sn-popup-send');
      if (!b) return false;
      const r = b.getBoundingClientRect();
      if (r.bottom > window.innerHeight || r.top < 0 || r.width === 0) return false;
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!el && (el === b || b.contains(el));
    });
    expect(inviaDentro, 'il tasto di invio è fuori dal riquadro incorporato').toBe(true);

    // SUCCESSO 4 — la risposta non è andata perduta con l'altezza: il corpo
    // scorre, e il testo completo è lì dentro.
    const testo = await frame.evaluate(() => document.querySelector('.sn-popup .sn-msg-assistant .sn-msg-text')?.textContent || '');
    expect(testo).toContain('Paragrafo 12');

    await ripristinaProvider(app);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// La spiegazione si deve LEGGERE, non solo starci dentro. Nei riquadri
// incorporati la parola sta spesso a metà del box: sopra e sotto restano due
// fette da un centinaio di pixel, e il riquadro che si aggrappa alla parola si
// schiaccia in una fessura — la risposta appena chiesta si scorre sei pixel per
// volta con la rotella — mentre metà del box resta vuota. Peggio: più spazio,
// meno spiegazione. In un box alto 220 il riquadro si staccava già e della
// risposta se ne leggevano 82px; a 240, venti pixel IN PIÙ, si agganciava alla
// parola e ne restavano 8.
//
// Qui il riquadro deve staccarsi e appoggiarsi al bordo del box, dove lo spazio
// c'è tutto. La soglia dello stacco non è "ci sta il riquadro ridotto all'osso"
// (all'osso della risposta non si vede niente) ma "il corpo tiene il minimo che
// gli dà il foglio di stile".
//
// Senza il rimedio: 8px di risposta a 240, 40 a 300, 32 a 340, 74 a 420 — tutti
// sotto il minimo comodo del corpo, e l'assert diventa rosso a ogni misura.
// ─────────────────────────────────────────────────────────────────────────────

// La parola a metà del riquadro incorporato: è la posizione che stringe TUTTI E
// DUE i lati, quella dei box dei commenti veri.
const RIQUADRO_INTERNO_A_META = (y) => `<!doctype html><meta charset="utf-8">
<style>
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; }
  #bersaglio { position: absolute; left: 10px; top: ${y}px; margin: 0; }
</style>
<p id="bersaglio">supercalifragilistico</p>`;

// Il minimo comodo del corpo si LEGGE dal foglio di stile (min-height più la
// sua imbottitura), come fa la posa: un numero ricopiato qui ricomincerebbe a
// mentire al primo ritocco del CSS.
const minimoComodoDelCorpo = () => {
  const d = document.createElement('div');
  d.className = 'sn-popup-body';
  d.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden';
  document.body.appendChild(d);
  let v = 0;
  try {
    const cs = getComputedStyle(d);
    const mh = parseFloat(cs.minHeight) || 0;
    const bordo = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    v = cs.boxSizing === 'border-box' ? Math.max(mh, bordo) : mh + bordo;
  } catch (_) { v = 0; }
  d.remove();
  return v;
};

for (const alto of [240, 300, 340, 420]) {
  test(`Alt+E su una parola a metà di un riquadro incorporato alto ${alto}px: la spiegazione si legge`, async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    const src = testServer.html(RIQUADRO_INTERNO_A_META(Math.round(alto * 0.5)));
    const page = await testServer.openReady(openTab, PAGINA_CON_RIQUADRO(src, alto));
    await preparaProvider(app, 300);

    const frame = await frameDelRiquadro(page, src);
    await frame.locator('#bersaglio').dblclick();
    await expect
      .poll(() => frame.evaluate(() => String(window.getSelection())), { timeout: 5000 })
      .toContain('supercalifragilistico');

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      globalThis.__filoShortcuts.dispatch('explain-selection', win);
    });

    await frame.waitForSelector('.sn-popup', { timeout: 10_000 });
    await attendiIngresso(frame);
    await expect
      .poll(() => frame.evaluate(() => document.querySelector('.sn-popup-meta')?.textContent || ''), { timeout: 20_000 })
      .toContain('€');

    // Lo scenario è quello vero: il box è più basso del tetto del riquadro, e
    // la parola sta a metà — nessuno dei due lati basta.
    const m = await frame.evaluate(misura);
    expect(m.vh, 'il popup non sta nel frame del riquadro').toBeLessThanOrEqual(alto);

    // SUCCESSO 1 — della spiegazione se ne legge almeno il minimo comodo: non
    // una fessura da scorrere con la rotella.
    const comodo = await frame.evaluate(minimoComodoDelCorpo);
    expect(comodo, 'il minimo comodo del corpo non si legge dal foglio di stile').toBeGreaterThan(0);
    const corpo = await frame.evaluate(() => {
      const b = document.querySelector('.sn-popup .sn-popup-body');
      return b ? b.getBoundingClientRect().height : 0;
    });
    expect(
      Math.round(corpo),
      `della spiegazione si leggono ${Math.round(corpo)}px in un riquadro alto ${alto}px, con ${Math.round(m.vh - m.height)}px di riquadro vuoto`,
    ).toBeGreaterThanOrEqual(Math.floor(comodo));

    // SUCCESSO 2 — e niente esce dal bordo del box né dal bordo del riquadro:
    // lo spazio guadagnato non si paga con la riga per scrivere tagliata.
    expect(fuoriDaiBordi(m), 'il popup è uscito dal riquadro incorporato').toEqual([]);
    expect(await frame.evaluate(casellaCliccabile)).toBe(true);

    // SUCCESSO 3 — la conversazione continua: la domanda dopo si scrive.
    const casella = page.frameLocator('#riquadro').locator('.sn-popup .sn-popup-input');
    await casella.click();
    await casella.fill('e questo cosa vuol dire?');
    await expect(casella).toHaveValue('e questo cosa vuol dire?');

    // SUCCESSO 4 — la risposta è tutta lì: il corpo scorre.
    const testo = await frame.evaluate(() => document.querySelector('.sn-popup .sn-msg-assistant .sn-msg-text')?.textContent || '');
    expect(testo).toContain('Paragrafo 12');

    // Traccia visiva della run (gitignorata).
    try { await page.screenshot({ path: `tests/.shots/popup-pose-riquadro-${alto}.png` }); } catch (_) {}

    await ripristinaProvider(app);
  });
}

// Stesso danno, altra direzione: un riquadro incorporato STRETTO. Il popup ha
// una larghezza sua (380px) e i box dei commenti spesso sono più stretti di
// così: senza rimedio sborda a destra e il tasto di invio finisce oltre il
// bordo del riquadro, dove il browser lo taglia — di nuovo "non posso più
// chiedere niente", senza poterci arrivare né scorrendo né trascinando.
for (const largo of [320, 280]) {
  test(`Alt+E dentro un riquadro incorporato largo ${largo}px: il riquadro ci sta dentro e il tasto di invio si clicca`, async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    const src = testServer.html(RIQUADRO_INTERNO);
    const page = await testServer.openReady(openTab, PAGINA_CON_RIQUADRO(src, 400, largo));
    await preparaProvider(app, 300);

    const frame = await frameDelRiquadro(page, src);
    await frame.locator('#bersaglio').dblclick();
    await expect
      .poll(() => frame.evaluate(() => String(window.getSelection())), { timeout: 5000 })
      .toContain('supercalifragilistico');

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      globalThis.__filoShortcuts.dispatch('explain-selection', win);
    });

    await frame.waitForSelector('.sn-popup', { timeout: 10_000 });
    await attendiIngresso(frame);

    // Lo scenario è quello vero: il riquadro incorporato è più STRETTO della
    // larghezza naturale del popup.
    const daVuoto = await frame.evaluate(misura);
    expect(daVuoto.vw, 'il riquadro incorporato non è più stretto del popup').toBeLessThan(380);

    // SUCCESSO 1 — già da vuoto è tutto dentro, tasto di invio compreso.
    expect(fuoriDaiBordi(daVuoto), 'il popup nasce fuori dal bordo del riquadro stretto').toEqual([]);

    await expect
      .poll(() => frame.evaluate(() => document.querySelector('.sn-popup-meta')?.textContent || ''), { timeout: 20_000 })
      .toContain('€');
    expect(fuoriDaiBordi(await frame.evaluate(misura)), 'il popup è uscito dal riquadro stretto quando la risposta è arrivata').toEqual([]);

    // SUCCESSO 2 — la riga per scrivere accetta testo…
    expect(await frame.evaluate(casellaCliccabile)).toBe(true);
    const casella = page.frameLocator('#riquadro').locator('.sn-popup .sn-popup-input');
    await casella.click();
    await casella.fill('e questo cosa vuol dire?');
    await expect(casella).toHaveValue('e questo cosa vuol dire?');

    // SUCCESSO 3 — …e il tasto di invio si clicca davvero: è lui che in un
    // riquadro stretto finiva tagliato via.
    const inviaCliccabile = await frame.evaluate(() => {
      const b = document.querySelector('.sn-popup .sn-popup-send');
      if (!b) return false;
      const r = b.getBoundingClientRect();
      if (r.right > window.innerWidth || r.left < 0 || r.bottom > window.innerHeight || r.width === 0) return false;
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!el && (el === b || b.contains(el));
    });
    expect(inviaCliccabile, 'il tasto di invio è fuori dal bordo del riquadro stretto').toBe(true);

    // SUCCESSO 4 — la risposta è tutta lì: il testo va a capo, non viene tagliato.
    const testo = await frame.evaluate(() => document.querySelector('.sn-popup .sn-msg-assistant .sn-msg-text')?.textContent || '');
    expect(testo).toContain('Paragrafo 12');

    await ripristinaProvider(app);
  });
}

// Il posto che torna: se il riquadro si è stretto perché ce n'era poco, quando
// lo spazio torna deve tornare largo com'era. Un rimedio che stringe e basta
// lascerebbe il popup mingherlino per sempre dopo un ridimensionamento.
test('finestra ristretta col riquadro aperto: si stringe per starci, e riallargata torna largo com\'era', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  const prima = await riquadroPosato(app, page);
  const largo = prima.right - prima.left;
  expect(largo, 'in una finestra larga il riquadro deve avere la sua larghezza piena').toBeGreaterThan(300);

  const alta = prima.vh;
  await page.setViewportSize({ width: 300, height: alta });
  await expect.poll(
    () => page.evaluate(() => window.innerWidth),
    { timeout: 5000, message: 'la finestra non si è ristretta: lo scenario non è quello vero' },
  ).toBeLessThan(380);

  await expect.poll(
    async () => fuoriDaiBordi(await page.evaluate(misura)),
    { timeout: 5000, message: 'ristretta la finestra, il riquadro è rimasto fuori dal bordo' },
  ).toEqual([]);
  expect(await page.evaluate(casellaCliccabile)).toBe(true);

  // Tornato lo spazio, torna anche la larghezza: un rimedio che stringe e basta
  // lascerebbe il riquadro mingherlino per sempre.
  await page.setViewportSize({ width: Math.round(prima.vw), height: alta });
  await expect.poll(
    async () => {
      const m = await page.evaluate(misura);
      return Math.round(m.right - m.left);
    },
    { timeout: 5000, message: 'tornato lo spazio, il riquadro è rimasto stretto' },
  ).toBe(Math.round(largo));

  await ripristinaProvider(app);
});

// ─────────────────────────────────────────────────────────────────────────────
// Il riquadro SPOSTATO dall'utente. La posizione in cui l'ha messo è sua e non
// si tocca; l'ingombro no — quello non l'ha scelto lui. Il tetto d'altezza si
// rifaceva solo finché il riquadro era ancorato al punto della selezione: da
// spostato smetteva di accorciarsi, e appena la finestra scendeva sotto la sua
// altezza si appoggiava in cima col fondo — la riga per scrivere — fuori dallo
// schermo. Stesso danno della segnalazione, stesso unico rimedio: chiudere e
// ricominciare.
//
// E la faccia opposta dello stesso difetto: spostato mentre lo spazio era poco,
// restava schiacciato per sempre, con la risposta compressa in una striscia da
// scorrere anche dopo che lo spazio era tornato tutto.
//
// Il segnale che porta alla causa era un'asimmetria dentro il rimedio stesso:
// di LARGHEZZA il riquadro spostato si stringeva eccome, di ALTEZZA no.
// ─────────────────────────────────────────────────────────────────────────────

// Trascina il riquadro per la sua intestazione, come fa un utente.
async function trascina(page, dx, dy) {
  const hb = await page.locator('.sn-popup-header').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + dx, hb.y + hb.height / 2 + dy, { steps: 10 });
  await page.mouse.up();
}

test('riquadro spostato dall\'utente e finestra abbassata: si accorcia per starci, e riportata alta torna alto com\'era', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  const page = await openTab('filo://newtab/');
  const prima = await riquadroPosato(app, page);
  const alta = prima.vh;
  expect(fuoriDaiBordi(prima)).toEqual([]);

  // L'utente lo sposta dove gli fa comodo, a risposta arrivata.
  await trascina(page, -80, -140);
  const spostato = await page.evaluate(misura);
  expect(Math.round(spostato.top), 'il trascinamento non ha spostato niente')
    .toBeLessThan(Math.round(prima.top));
  expect(fuoriDaiBordi(spostato)).toEqual([]);

  // Poi abbassa la finestra di Filo (affiancarla a metà schermo basta). Sotto
  // i 480px utili il riquadro non ci sta più: deve accorciarsi.
  for (const h of [450, 380]) {
    await altezzaFinestra(page, h);
    await expect.poll(
      () => page.evaluate(() => window.innerHeight),
      { timeout: 5000, message: `la finestra non è scesa a ${h}px: lo scenario non è quello vero` },
    ).toBeLessThanOrEqual(h);

    // SUCCESSO — tutto dentro lo schermo, riga per scrivere compresa.
    await expect.poll(
      async () => fuoriDaiBordi(await page.evaluate(misura)),
      { timeout: 5000, message: `con la finestra a ${h}px il riquadro spostato è rimasto fuori dallo schermo` },
    ).toEqual([]);
    // E non "dentro le coordinate" e basta: cliccabile davvero.
    expect(await page.evaluate(casellaCliccabile), `con la finestra a ${h}px la riga per scrivere non si clicca`).toBe(true);
    await page.locator('.sn-popup .sn-popup-input').click();
    await page.locator('.sn-popup .sn-popup-input').fill(`e adesso a ${h}?`);
    await expect(page.locator('.sn-popup .sn-popup-input')).toHaveValue(`e adesso a ${h}?`);
    await page.locator('.sn-popup .sn-popup-input').fill('');
  }

  // Il posto che torna: riportata alta la finestra, il riquadro spostato torna
  // alto com'era. Un tetto che sa solo stringere lo lascerebbe schiacciato per
  // sempre, con la risposta in una striscia da scorrere e lo spazio tutto lì.
  await altezzaFinestra(page, alta);
  await expect.poll(
    () => page.evaluate(() => window.innerHeight),
    { timeout: 5000 },
  ).toBeGreaterThan(700);
  await expect.poll(
    async () => (await page.evaluate(misura)).height,
    { timeout: 5000, message: 'tornato lo spazio, il riquadro spostato è rimasto schiacciato' },
  ).toBeGreaterThan(prima.height - 3);

  expect(fuoriDaiBordi(await page.evaluate(misura))).toEqual([]);
  expect(await page.evaluate(casellaCliccabile)).toBe(true);

  await ripristinaProvider(app);
});

// Nota su un caso che NON serve provare qui: zoom della pagina col riquadro
// spostato. La compensazione zoom contro-scala il riquadro, quindi zoomando il
// suo ingombro sullo schermo non cresce mai rispetto alla finestra e il
// guardiano gli basta. Un test lì sarebbe verde anche senza il rimedio: non
// proverebbe niente e costerebbe un avvio in più.

// Chi ha chiesto la spiegazione con la tastiera continua con la tastiera: il
// cursore deve essere GIÀ nella riga per scrivere. Prima ci si arrivava solo
// premendo Tab o tornando al mouse.
test('aperta con la scorciatoia: si può scrivere la domanda dopo senza toccare il mouse', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await preparaProvider(app, 300);

  await page.locator('#bersaglio').dblclick();
  await expect
    .poll(() => page.evaluate(() => String(window.getSelection())), { timeout: 5000 })
    .toContain('supercalifragilistico');

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });

  await page.waitForSelector('.sn-popup', { timeout: 10_000 });

  // Il cursore è nella riga per scrivere, senza aver toccato niente.
  await expect.poll(
    () => page.evaluate(() => {
      const input = document.querySelector('.sn-popup .sn-popup-input');
      return !!input && document.activeElement === input;
    }),
    { timeout: 5000, message: 'dopo la scorciatoia il cursore non è nella riga per scrivere' },
  ).toBe(true);

  // E si scrive davvero: tastiera e basta, niente clic e niente Tab.
  await page.keyboard.type('e questo cosa vuol dire?');
  await expect(page.locator('.sn-popup .sn-popup-input')).toHaveValue('e questo cosa vuol dire?');

  // Il fuoco nella casella spegne la selezione della pagina, che è una sola.
  // Chiuso il riquadro la parola deve tornare selezionata: da lì l'utente ci
  // fa la cosa dopo (tradurre, copiare, cercare) senza rifare la selezione.
  await page.keyboard.press('Escape');
  await expect(page.locator('.sn-popup')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => String(window.getSelection())), {
      timeout: 3000,
      message: 'chiuso il riquadro la parola non è più selezionata: va rifatta a mano',
    })
    .toContain('supercalifragilistico');

  await ripristinaProvider(app);
});

// ─────────────────────────────────────────────────────────────────────────────
// La parola resta LEGGIBILE. Il riquadro si stacca dalla parola su cui si è
// chiesta la spiegazione, e una parola ha un'altezza: staccarsi dal suo punto
// di partenza — il fondo del rettangolo, che è quello che passa la scorciatoia
// — vuol dire appoggiarsi otto pixel sopra il FONDO delle lettere, cioè dentro
// le lettere. Su una riga alta 19px ne restavano coperti gli ultimi 11: la
// metà bassa della parola spariva proprio mentre l'utente leggeva cosa vuol
// dire, ed è la prima cosa che si nota.
// ─────────────────────────────────────────────────────────────────────────────
test('la parola su cui hai chiesto la spiegazione resta scoperta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await preparaProvider(app, 300);

  await page.locator('#bersaglio').dblclick();
  await expect
    .poll(() => page.evaluate(() => String(window.getSelection())), { timeout: 5000 })
    .toContain('supercalifragilistico');

  // Il rettangolo della parola va letto PRIMA: il fuoco nella riga per scrivere
  // spegne la selezione della pagina, che è una sola.
  const parola = await page.evaluate(() => {
    const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, height: r.height };
  });
  expect(parola.height, 'la parola non ha altezza: lo scenario non è quello vero').toBeGreaterThan(8);

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await page.waitForSelector('.sn-popup', { timeout: 10_000 });
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
  await attendiIngresso(page);

  const m = await page.evaluate(misura);
  // Lo scenario è quello vero: il riquadro si è posato SOPRA la parola (in
  // basso nella pagina non ci sta sotto). È lì che il difetto si vedeva.
  expect(m.bottom, 'il riquadro non si è posato sopra la parola').toBeLessThan(parola.bottom);

  // SUCCESSO — nessuna sovrapposizione: la parola si legge tutta.
  const coperto = Math.min(m.bottom, parola.bottom) - Math.max(m.top, parola.top);
  expect(
    Math.max(0, Math.round(coperto)),
    `il riquadro copre ${Math.round(coperto)}px dei ${Math.round(parola.height)} della parola`,
  ).toBe(0);
  // E non si è allontanato: resta agganciato lì sopra.
  expect(parola.top - m.bottom).toBeLessThanOrEqual(12);

  expect(fuoriDaiBordi(m)).toEqual([]);
  await ripristinaProvider(app);
});

// Lo zoom massimo del browser (500%) è una porta vera per lo stesso difetto
// delle finestre bassissime: su una finestra normale lascia poco più di 150px
// di altezza utile, e lì il tetto d'altezza scende sotto la somma dei minimi
// dei pezzi interni. Senza contare l'imbottitura del corpo, la riga per
// scrivere sporgeva dal bordo arrotondato del riquadro — visibile anche quando
// il riquadro nel suo insieme sta dentro lo schermo.
test('zoom al massimo con la parola in basso: la riga per scrivere sta dentro il riquadro e si scrive', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, PAGINA);
  await preparaProvider(app, 300);

  await zoomScheda(app, 5);
  await expect.poll(
    () => page.evaluate(() => window.innerHeight),
    { timeout: 5000, message: 'lo zoom non ha accorciato la finestra: lo scenario non è quello vero' },
  ).toBeLessThan(220);

  await page.locator('#bersaglio').dblclick();
  await expect
    .poll(() => page.evaluate(() => String(window.getSelection())), { timeout: 5000 })
    .toContain('supercalifragilistico');

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
  await page.waitForSelector('.sn-popup', { timeout: 10_000 });
  await expect(page.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
  await attendiIngresso(page);

  const m = await page.evaluate(misura);
  // SUCCESSO 1 — niente sporge: né dal bordo del riquadro né dalla finestra.
  expect(fuoriDaiBordi(m), 'a zoom massimo qualcosa sporge').toEqual([]);
  // SUCCESSO 2 — e la riga per scrivere si clicca e accetta la domanda dopo.
  expect(await page.evaluate(casellaCliccabile)).toBe(true);
  await page.locator('.sn-popup .sn-popup-input').click();
  await page.locator('.sn-popup .sn-popup-input').fill('e adesso?');
  await expect(page.locator('.sn-popup .sn-popup-input')).toHaveValue('e adesso?');
  // SUCCESSO 3 — il tasto di invio si vede intero, non a metà.
  const inviaIntero = await page.evaluate(() => {
    const root = document.querySelector('.sn-popup');
    const b = root.querySelector('.sn-popup-send');
    const r = b.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    return r.bottom <= rr.bottom + 1 && r.bottom <= window.innerHeight + 1;
  });
  expect(inviaIntero, 'il tasto di invio è tagliato').toBe(true);

  await zoomScheda(app, 1);
  await ripristinaProvider(app);
});

// ─────────────────────────────────────────────────────────────────────────────
// #502, la porta rimasta aperta: a crescere non è solo la RISPOSTA.
//
// Il riquadro sa già accorciare il corpo e farlo scorrere quando lo spazio
// manca — ma rifà quel conto solo quando cambia la finestra o lo zoom. Quando a
// crescere è la RIGA PER SCRIVERE (la domanda successiva che passa le due
// righe: la casella si allunga fino a 120px) il conto resta quello di prima: il
// corpo è già al suo minimo comodo e non cede un pixel, così a uscire dal bordo
// del riquadro è proprio la riga in basso — con il tasto di invio, che sotto il
// cursore non c'è più.
//
// È la stessa asimmetria di sempre, un tasto più in là: un rimedio che vale per
// una causa di crescita (la risposta) e non per l'altra (la domanda).
// ─────────────────────────────────────────────────────────────────────────────

// Il tasto di invio non basta che sia "dentro le coordinate": ci si deve poter
// cliccare sopra davvero.
const invioCliccabile = () => {
  const root = document.querySelector('.sn-popup');
  if (!root) return false;
  const b = root.querySelector('.sn-popup-send');
  const r = b.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!el && (el === b || b.contains(el));
};

// Scrive una domanda lunga come farebbe l'utente: quattro righe di testo, così
// la casella si allunga fino al suo tetto. `pressSequentially` batte `fill`
// perché fa scattare l'auto-grow a ogni carattere, come una vera digitazione.
const TESTO_DOMANDA = 'e questo invece cosa vorrebbe dire nel contesto della frase che avevo selezionato prima, e in che modo cambia se la frase parlasse di altro? aggiungi anche un esempio pratico che si capisca subito';
async function domandaLunga(page) {
  const input = page.locator('.sn-popup .sn-popup-input');
  await input.click();
  await input.fill('');
  await input.pressSequentially(TESTO_DOMANDA, { delay: 0 });
}

// Le coppie (altezza della finestra, dov'è la parola) in cui la domanda lunga
// spingeva fuori la riga per scrivere. Non sono casi di laboratorio: è
// "finestra fino a 540px, parola dalla metà in giù", cioè la finestra di un
// portatile con qualche pannello aperto e una parola a metà pagina. Sotto ogni
// coppia c'è di quanto sporgeva prima del rimedio.
const CASI_DOMANDA = [
  { altezza: 540, frazione: 0.5, sporgeva: 20 },
  { altezza: 480, frazione: 0.5, sporgeva: 50 },   // e 42px fuori dallo SCHERMO
  { altezza: 480, frazione: 0.55, sporgeva: 28 },
  { altezza: 420, frazione: 0.55, sporgeva: 61 },
  { altezza: 420, frazione: 0.65, sporgeva: 19 },
  { altezza: 380, frazione: 0.65, sporgeva: 45 },
];

for (const { altezza, frazione, sporgeva } of CASI_DOMANDA) {
  test(`domanda lunga dopo la risposta, finestra alta ${altezza}px e parola a ${frazione}: la riga per scrivere resta dentro (sporgeva di ${sporgeva}px)`, async ({ app, openTab }) => {
    test.setTimeout(90_000);
    const page = await openTab('filo://newtab/');
    await altezzaFinestra(page, altezza);
    await expect.poll(() => page.evaluate(() => window.innerHeight), { timeout: 5000 })
      .toBeLessThanOrEqual(altezza);

    // Parola dalla metà in giù e risposta arrivata: fin qui è tutto dentro.
    const posato = await riquadroPosato(app, page, frazione);
    expect(fuoriDaiBordi(posato), 'il riquadro sborda già prima della domanda').toEqual([]);

    // Adesso la domanda successiva, lunga.
    await domandaLunga(page);
    // La casella si è allungata davvero: senza, il test non prova niente.
    const cresciuta = await page.evaluate(() => {
      const i = document.querySelector('.sn-popup .sn-popup-input');
      return i.getBoundingClientRect().height;
    });
    expect(cresciuta, 'la casella non si è allungata: lo scenario non è quello vero').toBeGreaterThan(80);

    const m = await page.evaluate(misura);
    // SUCCESSO — niente sporge: né dal bordo arrotondato del riquadro né dalla
    // finestra. È la riga per scrivere a essere in gioco, quindi si guarda lei.
    expect(fuoriDaiBordi(m), 'scritta la domanda, qualcosa sporge').toEqual([]);
    expect(await page.evaluate(casellaCliccabile), 'la casella non si clicca più').toBe(true);
    expect(await page.evaluate(invioCliccabile), 'il tasto di invio non si clicca più').toBe(true);

    // E la domanda si può mandare col tasto, non solo indovinando l'Invio.
    await page.locator('.sn-popup .sn-popup-send').click();
    await expect(page.locator('.sn-popup .sn-msg-user .sn-msg-text').last())
      .toContainText('cosa vorrebbe dire', { timeout: 5000 });

    await ripristinaProvider(app);
  });
}

// Dentro un riquadro incorporato lo "schermo" È il riquadro e quello che esce
// dal suo bordo il browser lo TAGLIA: non lo recuperi né scorrendo né
// spostando il popup altrove. I box dei commenti stanno spesso fra i 230 e i
// 420px, quindi è lì che la domanda lunga fa più danno.
for (const alto of [420, 320, 240]) {
  test(`domanda lunga dentro un riquadro incorporato alto ${alto}px: la riga per scrivere resta dentro`, async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    const src = testServer.html(RIQUADRO_INTERNO);
    const page = await testServer.openReady(openTab, PAGINA_CON_RIQUADRO(src, alto));
    await preparaProvider(app, 300);

    const frame = await frameDelRiquadro(page, src);
    await frame.locator('#bersaglio').dblclick();
    await expect
      .poll(() => frame.evaluate(() => String(window.getSelection())), { timeout: 5000 })
      .toContain('supercalifragilistico');

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
      globalThis.__filoShortcuts.dispatch('explain-selection', win);
    });
    await frame.waitForSelector('.sn-popup', { timeout: 10_000 });
    await expect(frame.locator('.sn-popup .sn-popup-meta')).toContainText('€', { timeout: 20_000 });
    await frame.evaluate(async () => {
      const root = document.querySelector('.sn-popup');
      if (!root?.getAnimations) return;
      await Promise.all(root.getAnimations().map((a) => a.finished.catch(() => {})));
    });

    expect(fuoriDaiBordi(await frame.evaluate(misura)), 'sborda già prima della domanda').toEqual([]);

    await domandaLunga(frame);
    const cresciuta = await frame.evaluate(() => {
      const i = document.querySelector('.sn-popup .sn-popup-input');
      return i.getBoundingClientRect().height;
    });
    expect(cresciuta, 'la casella non si è allungata: lo scenario non è quello vero').toBeGreaterThan(45);

    const m = await frame.evaluate(misura);
    expect(fuoriDaiBordi(m), 'scritta la domanda, qualcosa sporge dal riquadro incorporato').toEqual([]);
    expect(await frame.evaluate(casellaCliccabile), 'la casella non si clicca più').toBe(true);
    expect(await frame.evaluate(invioCliccabile), 'il tasto di invio non si clicca più').toBe(true);

    await ripristinaProvider(app);
  });
}

// La faccia opposta, che un rimedio "che sa solo stringere" lascerebbe fuori:
// cancellata la domanda lunga la casella torna bassa, e lo spazio che aveva
// preso deve tornare alla RISPOSTA. Senza, il riquadro resta schiacciato per
// sempre solo perché per un momento c'era una domanda lunga.
test('cancellata la domanda lunga, la risposta si riprende lo spazio', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://newtab/');
  await altezzaFinestra(page, 480);
  await expect.poll(() => page.evaluate(() => window.innerHeight), { timeout: 5000 })
    .toBeLessThanOrEqual(480);

  await riquadroPosato(app, page, 0.6);
  const corpoPrima = await page.evaluate(() => (
    document.querySelector('.sn-popup .sn-popup-body').getBoundingClientRect().height
  ));

  await domandaLunga(page);
  const corpoStretto = await page.evaluate(() => (
    document.querySelector('.sn-popup .sn-popup-body').getBoundingClientRect().height
  ));
  expect(corpoStretto, 'il corpo non ha ceduto spazio alla domanda').toBeLessThan(corpoPrima - 5);

  await page.locator('.sn-popup .sn-popup-input').fill('');
  await page.locator('.sn-popup .sn-popup-input').press('Backspace');
  await expect.poll(
    async () => page.evaluate(() => (
      document.querySelector('.sn-popup .sn-popup-body').getBoundingClientRect().height
    )),
    { timeout: 5000, message: 'cancellata la domanda, il corpo è rimasto schiacciato' },
  ).toBeGreaterThan(corpoPrima - 5);

  expect(fuoriDaiBordi(await page.evaluate(misura))).toEqual([]);
  await ripristinaProvider(app);
});
