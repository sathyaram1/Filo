// La home (filo://newtab/): zone, menu, messaggi col main, aggiornamenti live, comandi della barra. Una sola app per il
// file, riportata com'era appena aperta prima di ogni prova (tests/helpers/appCondivisa.mjs); un describe per gruppo.

import { appCondivisa } from './helpers/appCondivisa.mjs';
import { barraPage, comandaBarra, pannelloFermo } from './helpers/barra.mjs';
import { home } from './helpers/chatFinta.mjs';
import { CONFIRM_HOST, confirmState } from './helpers/confirm.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const { test, expect } = appCondivisa();

test.describe('dashboard', () => {
  // Dashboard / newtab. Verifica layout + IPC con il main process.

  async function newtabPage(app) {
    // Poll: la newtab è aperta dal main subito dopo did-finish-load della shell,
    // ma il "window" event in Playwright può arrivare con qualche ms di ritardo.
    const deadline = Date.now() + 10_000;
    let win = null;
    while (Date.now() < deadline) {
      win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
      if (win) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(win, 'newtab non trovata entro 10s').toBeTruthy();
    await win.waitForLoadState('domcontentloaded');
    return win;
  }

  test('tasto destro sulla dashboard apre il menu Filo', async ({ app, shell }) => {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    // I content script vengono iniettati anche su filo://newtab/ via
    // internal-preload, quindi il menu Filo deve apparire.
    await page.waitForFunction(
      () => document.documentElement.dataset.filoContentScripts === '1',
      null,
      { timeout: 8_000 },
    );
    await page.locator('#center').click({ button: 'right' });
    await expect(menuDi(page).locator('.sn-menu')).toBeVisible({ timeout: 5_000 });
  });

  test('la dashboard renderizza le tre zone + barra input', async ({ app, shell }) => {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);

    await expect(page.locator('#center')).toBeVisible();
    await expect(page.locator('#left')).toBeAttached();
    await expect(page.locator('#right')).toBeAttached();
    await expect(page.locator('#input')).toBeVisible();
    await expect(page.locator('#sendBtn')).toBeVisible();
    // Il centro è il filo (#869), col campo per cercarci dentro.
    await expect(page.locator('#threadView')).toBeVisible();
    await expect(page.locator('#cercaInput')).toBeVisible();
  });

  test('senza API key la home indica il codice d\'invito (non una chiave da mettere)', async ({ app, shell }) => {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    // Il messaggio "Filo non è attivo" è quello prodotto dal main quando non c'è
    // nessuna chiave risolvibile (test isolato: né chiavi utente né default) — è
    // la parte che il feedback #356 riguarda. Lo leggiamo direttamente dall'IPC,
    // non dal DOM, perché alla primissima apertura la home mostra il messaggio di
    // benvenuto e non il messaggio della dashboard.
    const r = await page.evaluate(() => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'filo_generate_dashboard', force: true }, (res) => resolve(res));
    }));
    expect(r?.ok).toBe(true);
    const txt = String(r.message || '');
    expect(txt.length).toBeGreaterThan(0);
    // Feedback #356 e #598: la strada consigliata è quella che non costa niente
    // all'utente — prima il login (fino al #598), ora il codice d'invito nella
    // pagina Crediti — e va detta PRIMA di qualsiasi menzione della chiave API,
    // che resta l'alternativa per chi ne ha una.
    expect(txt.toLowerCase()).toContain('invito');
    expect(txt).toContain('Crediti');
    const iInvito = txt.toLowerCase().indexOf('invito');
    const iChiave = txt.toLowerCase().indexOf('chiave');
    if (iChiave !== -1) expect(iInvito).toBeLessThan(iChiave);
    // La vecchia formulazione che spingeva la chiave come attivazione non deve tornare.
    expect(txt).not.toContain('Imposta una chiave API nelle Opzioni per attivare Filo');
  });

  test('FILO_GET_STATE risponde con tab e tempo via runtime.sendMessage', async ({ app, shell }) => {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    const result = await page.evaluate(() => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'filo_get_state' }, (r) => resolve(r));
    }));
    expect(result?.ok).toBe(true);
    expect(typeof result.stateText).toBe('string');
    expect(result.stateText).toContain('FILO STATE');
    expect(result.state).toBeTruthy();
    expect(Array.isArray(result.state.tabs)).toBe(true);
  });

  test('FILO_ADD_TIMER crea un timer leggibile via FILO_GET_TIMERS', async ({ app, shell }) => {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    const created = await page.evaluate(() => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'filo_add_timer', label: 'Test', seconds: 30 }, (r) => resolve(r));
    }));
    expect(created?.ok).toBe(true);
    expect(created.timer?.label).toBe('Test');

    const list = await page.evaluate(() => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'filo_get_timers' }, (r) => resolve(r));
    }));
    expect(list?.ok).toBe(true);
    expect(list.timers.some((t) => t.label === 'Test')).toBe(true);

    await page.evaluate((id) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'filo_delete_timer', id }, (r) => resolve(r));
    }), created.timer.id);
  });

  // Gli appunti non hanno più un archivio proprio da leggere/scrivere via
  // messaggi: Filo li scrive nei file dell'editor. Il percorso vero è coperto da
  // audit-notes-visibility.spec.mjs (Filo scrive → il testo compare nell'editor) e
  // da editor-notes-migration.spec.mjs (gli appunti storici finiscono nell'editor).
});

test.describe('dashboard-live-refresh', () => {
  // Feedback #155, poi #869: la home non chiama il modello aprendosi. I suggerimenti si rifanno quando Filo scrive per
  // primo (o con «Aggiorna»), e la home aperta li riceve DA SOLA col broadcast FILO_DASHBOARD_UPDATED, senza ricaricare.
  // Arrivato un modello, la frase che spiegava perché Filo non poteva rispondere se ne va.

  async function newtabPage(app) {
    const deadline = Date.now() + 10_000;
    let win = null;
    while (Date.now() < deadline) {
      win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
      if (win) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(win, 'newtab non trovata entro 10s').toBeTruthy();
    await win.waitForLoadState('domcontentloaded');
    return win;
  }

  test('la home si aggiorna live al broadcast FILO_DASHBOARD_UPDATED', async ({ app, shell }) => {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage(app);
    await expect(page.locator('#homeMessage')).toBeVisible({ timeout: 8_000 });

    // Tipo messaggio dal catalogo condiviso (niente stringhe magiche nel test).
    const type = await page.evaluate(() => window.SN_MSG.MSG.FILO_DASHBOARD_UPDATED);

    // Il main spinge l'aggiornamento come fa generaPerFiloParla (src/main/services/handlers.js).
    await app.evaluate(({ BrowserWindow }, t) => {
      const msg = {
        type: t,
        suggestions: [{ icon: 'link', text: 'Suggerimento ricalcolato', action: null, importance: 3 }],
      };
      for (const win of BrowserWindow.getAllWindows()) {
        if (win._filoTabs) {
          for (const tab of win._filoTabs.tabs) {
            try { tab.view.webContents.send('filo:broadcast', msg); } catch (_) {}
          }
        }
        try { win.webContents.send('filo:broadcast', msg); } catch (_) {}
      }
    }, type);

    await expect(page.locator('#homeMessage')).toBeHidden({ timeout: 8_000 });
    await expect(page.locator('.dash-carta[data-tipo="suggerimenti"] .dash-carta-voce'))
      .toContainText('Suggerimento ricalcolato', { timeout: 8_000 });
  });
});

test.describe('dashboard-history-control', () => {
  // Feedback #2 + #281: il passato dev'essere a portata di un clic da ogni pagina. Da #871 il pulsante sta in fondo alla
  // barra laterale; dal #872 porta al quaderno delle memorie, che ha preso il posto della Cronologia (chat e schede
  // chiuse stanno nel filo della home):
  //   1) nella barra c'è il pulsante Memorie;
  //   2) cliccandolo si apre davvero il quaderno.

  test('la barra laterale ha un pulsante Memorie che apre il quaderno delle memorie', async ({ app, shell }) => {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const barra = await barraPage(app);
    await comandaBarra(app, 'clic');
    await pannelloFermo(barra);

    const bottone = barra.locator('#fisse [data-comando="history"]');
    await expect(bottone).toBeVisible();
    await expect(bottone).toHaveAttribute('aria-label', 'Memorie');

    await bottone.click();
    await expect.poll(() => app.windows().some((w) => { try { return w.url().startsWith('filo://quaderno/'); } catch (_) { return false; } }),
      { timeout: 10_000, message: 'il quaderno non si è aperto dopo il clic' }).toBe(true);
  });
});

test.describe('dashboard-pulisci-command', () => {
  // Feedback alpha: «aggiungi il comando /pulisci che avvia il riordino e pulizia
  // delle tab». Wiring di un nuovo comando slash della dashboard che riusa lo
  // stesso flusso del bottone "🧹 Riordina e archivia le schede": conferma Filo
  // (SN_CONFIRM_UI) e, su conferma, RUN_TAB_TRIAGE.
  //
  // Il test ASSERISCE il successo: "/pulisci" è classificato come comando Filo e
  // all'invio apre il popup di conferma del riordino. Senza il comando sarebbe
  // trattato come comando shell/sconosciuto e nessuna conferma comparirebbe.

  const NEWTAB = 'filo://newtab/';

  async function submit(page, command) {
    await page.evaluate((cmd) => {
      const input = document.getElementById('input');
      const form = document.getElementById('inputForm');
      input.value = cmd;
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }, command);
  }

  test('"/pulisci" è un comando Filo e, a livello Conservativo, apre la conferma di riordino delle schede', async ({ app, openTab }) => {
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'conservativo' } }));
    const page = await openTab(NEWTAB);
    const input = page.locator('#input');
    await expect(input).toBeVisible({ timeout: 8_000 });

    // Riconosciuto come comando interno di Filo (arancione), non shell/sconosciuto.
    await input.fill('/pulisci');
    await expect(input).toHaveClass(/is-cmd-filo/);
    await expect(input).not.toHaveClass(/is-cmd-unknown/);

    // All'invio compare il popup di conferma Filo del riordino.
    await submit(page, '/pulisci');
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 8_000 });
    await expect.poll(async () => (await confirmState(page)).title).toBe('Riordino delle schede');
  });

  test('"/pulizia" è un alias dello stesso comando', async ({ app, openTab }) => {
    await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ autonomia: { livello: 'conservativo' } }));
    const page = await openTab(NEWTAB);
    const input = page.locator('#input');
    await expect(input).toBeVisible({ timeout: 8_000 });
    await input.fill('/pulizia');
    await expect(input).toHaveClass(/is-cmd-filo/);
    await submit(page, '/pulizia');
    await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 8_000 });
  });

  // #530: a Normale, in una conversazione pulita, il riordino costa 2 e parte da solo, come chiesto in chat.
  // Nella home che c'è già: una seconda home aperta apposta sarebbe un doppione, e il riordino la archivierebbe.
  test('"/pulisci" a livello Normale riordina subito, senza popup, e dice com\'è andata', async ({ app }) => {
    const page = await home(app);
    await submit(page, '/pulisci');
    await expect(page.locator('body')).toContainText(/✓ (Archiviate \d+|Nessuna scheda da archiviare)/, { timeout: 15_000 });
    await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  });
});
