// #648 (giro 1 di verifica) — la pila di riquadri, oltre i quattro chiesti.
//
// Il sintomo: a schermo intero, con quattro riquadri impilati sopra una pagina
// di Filo, il quarto Esc portava via la modalità invece di chiudere solo il
// riquadro in cima (#514: l'Esc chiude prima il riquadro, poi la modalità).
// Qui la lamentela si riproduce e poi si spinge oltre, perché il numero quattro
// non ha niente di speciale: si guarda il fondo della pila (il tetto vero), il
// primo Esc dopo il fondo — dove il rischio è l'errore opposto, cioè uscire
// SCAVALCANDO il riquadro ancora aperto — e l'Esc pigiato in fretta.

import { test, expect } from '../../fixtures/electron.mjs';

async function stato(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return { cf: !!t.contentFullscreen };
  });
}
const schermoIntero = async (app) => (await stato(app)).cf;

async function entra(app) {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.setContentFullscreen(true);
  });
  await new Promise((r) => setTimeout(r, 700));
}

// Il tasto vero: passa dal before-input-event del main, com'è quando lo preme
// una persona.
async function esc(app, attesa = 1200) {
  await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    const wc = t.tabs.find((x) => x.id === t.activeId).view.webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await new Promise((r) => setTimeout(r, attesa));
}

async function nuovaSchedaInPrimoPiano(app) {
  const scadenza = Date.now() + 10_000;
  while (Date.now() < scadenza) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded').catch(() => {}); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('nuova scheda non trovata');
}

// Provider finto: le risposte si devono poter aprire senza rete, e devono
// restare aperte (nessuna si chiude da sola mentre contiamo gli Esc).
async function preparaProvider(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.SN_PROVIDER_OPENROUTER,
      streamComplete: async ({ onDelta }) => {
        await new Promise((r) => setTimeout(r, 30_000));
        onDelta('.');
        return { text: '.', usage: {} };
      },
    };
  });
}

async function impila(app, quanti) {
  const page = await nuovaSchedaInPrimoPiano(app);
  await preparaProvider(app);
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 15_000 });
  await entra(app);
  await page.evaluate((n) => {
    for (let i = 1; i <= n; i += 1) {
      window.SN_POPUP.openStreaming({
        action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
        payload: { selection: 'r' + i, sentence: 'una frase con r' + i + ' dentro' },
        anchor: { x: 120, y: 300 },
        title: 'r' + i,
      });
    }
  }, quanti);
  await expect.poll(() => page.locator('.sn-popup').count(), { timeout: 10_000 }).toBe(quanti);
  await new Promise((r) => setTimeout(r, 400));
  return page;
}

// Una pila alta N: ogni Esc ne chiude uno e nessuno costa la modalità.
async function scendiLaPila(app, page, quanti) {
  for (let i = 1; i <= quanti; i += 1) {
    await esc(app);
    expect(
      { rimasti: await page.locator('.sn-popup').count(), modalita: await schermoIntero(app) },
      `Esc numero ${i} di ${quanti}: doveva chiudere solo il riquadro in cima`,
    ).toEqual({ rimasti: quanti - i, modalita: true });
  }
}

// ── 1. Otto riquadri impilati ────────────────────────────────────────────────
// Il doppio dei quattro segnalati: se il difetto fosse stato curato alzando il
// conto di uno, qui tornerebbe.
test('otto riquadri impilati: ogni Esc ne chiude uno, e la modalità resta fino all\'ultimo', async ({ app }) => {
  test.setTimeout(240_000);
  const page = await impila(app, 8);
  await scendiLaPila(app, page, 8);
  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

// ── 2. Il fondo della pila ───────────────────────────────────────────────────
// Dieci è il tetto dichiarato: la pila più alta che Filo promette di reggere.
// Un tetto che vale uno in meno di quanto dice rifà il danno di #648 a chi ci
// arriva davvero.
test('dieci riquadri impilati: la modalità regge fino in fondo, e il decimo Esc non se la porta via', async ({ app }) => {
  test.setTimeout(300_000);
  const page = await impila(app, 10);
  await scendiLaPila(app, page, 10);
  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});

// ── 3. Oltre il fondo: si esce, ma il riquadro non resta appeso ──────────────
// Sopra il tetto Filo smette di credere alla pagina — è la difesa contro un
// sito che si mangia ogni Esc. Smettere di credere però non autorizza a
// scavalcare: se l'uscita si prendesse il tasto, l'ultimo riquadro resterebbe
// aperto su una pagina che nessuno aveva chiesto di lasciare, che è esattamente
// il danno di #514 rifatto da noi.
test('oltre il tetto: la modalità può andarsene, ma nessun riquadro resta aperto sullo schermo', async ({ app }) => {
  test.setTimeout(300_000);
  const page = await impila(app, 12);
  for (let i = 1; i <= 12; i += 1) {
    await esc(app);
    const modalita = await schermoIntero(app);
    if (modalita) continue;
    // La modalità se n'è andata: da qui l'unica cosa che conta è che non abbia
    // scavalcato nessuno. Il riquadro in cima deve essersi chiuso con lo stesso
    // tasto, e quelli sotto si chiudono coi tasti dopo.
    const rimastiSubito = await page.locator('.sn-popup').count();
    expect(
      rimastiSubito,
      `all'Esc numero ${i} la modalità se n'è andata scavalcando i ${12 - i + 1} riquadri ancora aperti`,
    ).toBeLessThanOrEqual(12 - i);
    for (let j = rimastiSubito; j > 0; j -= 1) await esc(app);
    await expect.poll(() => page.locator('.sn-popup').count(), { timeout: 6000 }).toBe(0);
    return;
  }
  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
  await expect.poll(() => page.locator('.sn-popup').count(), { timeout: 4000 }).toBe(0);
});

// ── 4. Esc pigiato in fretta ─────────────────────────────────────────────────
// Chi vuole chiudere quattro riquadri pigia quattro volte di seguito, non uno
// ogni secondo: la modalità non deve sparire perché i tasti sono arrivati
// vicini.
test('quattro riquadri e quattro Esc pigiati di fila: la modalità non se ne va con dei riquadri ancora aperti', async ({ app }) => {
  test.setTimeout(240_000);
  const page = await impila(app, 4);
  for (let i = 1; i <= 3; i += 1) await esc(app, 80);
  await new Promise((r) => setTimeout(r, 1500));
  const rimasti = await page.locator('.sn-popup').count();
  if (rimasti > 0) {
    expect(
      await schermoIntero(app),
      `restano ${rimasti} riquadri aperti e la modalità se n'è già andata`,
    ).toBe(true);
  }
});

// ── 5. Pila mista: una risposta e il menu del tasto destro sopra ─────────────
// La pila vera non è fatta di riquadri tutti uguali. Il menu del tasto destro
// sopra due risposte è la pila che capita davvero.
test('pila mista su una pagina di Filo: menu del tasto destro sopra due risposte', async ({ app }) => {
  test.setTimeout(240_000);
  const page = await impila(app, 2);
  await page.mouse.click(600, 500, { button: 'right' });
  await expect(page.locator('.sn-menu').first()).toBeVisible({ timeout: 8000 });
  await new Promise((r) => setTimeout(r, 400));
  // Quante risposte sono rimaste dopo il clic si CONTA: il clic fuori da un
  // riquadro ne chiude già qualcuna, e darne per scontato il numero farebbe
  // fallire la prova per un motivo che con #648 non c'entra niente.
  const risposte = await page.locator('.sn-popup').count();

  await esc(app);
  expect(
    { menu: await page.locator('.sn-menu').count(), modalita: await schermoIntero(app) },
    'il primo Esc era del menu, non della modalità',
  ).toEqual({ menu: 0, modalita: true });

  // Quante risposte restano lo decide Filo (un Esc può chiuderne più d'una, ed
  // è comportamento di sempre, dentro e fuori dallo schermo intero). Quello che
  // si giudica qui è la modalità: finché c'è qualcosa aperto sopra la pagina,
  // nessun Esc se la porta via.
  for (let i = 0; i < risposte; i += 1) {
    if (await page.locator('.sn-popup').count() === 0) break;
    await esc(app);
    expect(
      await schermoIntero(app),
      `l'Esc numero ${i + 2} ha portato via la modalità con dei riquadri ancora aperti`,
    ).toBe(true);
  }
  expect(await page.locator('.sn-popup').count(), 'la pila si è svuotata').toBe(0);

  await esc(app);
  await expect.poll(() => schermoIntero(app), { timeout: 8000 }).toBe(false);
});
