// Dove sta il menu del tasto destro, per le prove: l'unico punto che lo sa (#1052). Gli spec lo trovano da qui, mai
// con un selettore sulla pagina, perché il menu uscirà dalla pagina del sito in uno strato di Filo sopra la scheda.
// Sentinella: tests/unit/menuSoloDallAiuto.test.mjs (il marcatore per lo script del sito che cerca il menu sta lì).

import { createRequire } from 'node:module';

const { MONDO: MONDO_CONTENT_SCRIPT } = createRequire(import.meta.url)('../../src/preload/mondo-esente.js');

function paginaDi(scheda) {
  if (typeof scheda.context === 'function') return scheda;
  if (typeof scheda.page === 'function') return scheda.page();
  if (typeof scheda.owner === 'function') return scheda.owner().page();
  return null;
}

// Con lo strato acceso (#1054) il menu di una pagina web sta nella vista filo://menu/ sopra la scheda, qualunque
// riquadro l'abbia aperto; spento, e sulle pagine di Filo, nel documento della scheda (o del riquadro, se è un Frame).
export function superficieDelMenu(scheda) {
  const url = typeof scheda.url === 'function' ? scheda.url() : '';
  const pagina = url.startsWith('filo://') ? null : paginaDi(scheda);
  const strato = pagina && pagina.context().pages().find((p) => p.url().startsWith('filo://menu/'));
  return strato || scheda;
}

/**
 * Il menu del tasto destro di una scheda (Page, Frame o FrameLocator), dovunque sia disegnato.
 * `locator(sel)` cerca nella superficie del menu con i selettori di oggi (`.sn-menu-item`…); `valuta(fn, arg)` esegue
 * nel documento dove il menu è disegnato (non su un FrameLocator). La cronologia degli appunti sta in un'ombra chiusa:
 * si legge con `statoCronologia`.
 */
export function menuDi(scheda) {
  const superficie = superficieDelMenu(scheda);
  const locator = (sel, opzioni) => superficie.locator(sel, opzioni);
  const voce = (testo) => locator('.sn-menu-item, .sn-menu-griglia .sn-menu-row-btn:not(.sn-menu-row-overflow)', { hasText: testo });
  const piu = locator('.sn-menu-griglia .sn-menu-row-overflow');
  // Il gesto dell'utente: un'azione rara sta dietro il «+», e prima di cliccarla si apre il «+» (#2555).
  async function scegli(icona, opzioni) {
    const v = typeof icona === 'string' ? voce(icona).first() : icona;
    await v.waitFor({ state: 'attached' });
    if (!(await v.isVisible()) && await v.evaluate((b) => !!b.closest('.sn-menu-altro'))) await piu.click();
    await v.click(opzioni);
  }
  // Una variante sta nel menu della sua icona, che si apre col tasto destro sull'icona.
  async function variante(icona, testo) {
    await scegli(icona, { button: 'right' });
    await locator('.sn-menu-sub .sn-menu-item', { hasText: testo }).first().click();
  }
  return {
    superficie,
    locator,
    valuta: (fn, arg) => superficie.evaluate(fn, arg),
    /** Ogni pannello del menu aperto, principale e sottomenu. */
    pannelli: locator('.sn-menu'),
    principale: locator('.sn-menu:not(.sn-menu-sub)'),
    /** La prima voce del pannello principale: la prima icona della griglia, che sta sempre in cima (#1434, #2555). */
    primaVoce: locator('.sn-menu:not(.sn-menu-sub) .sn-menu-griglia .sn-menu-row-btn:visible').first(),
    /** Le voci: le icone della griglia (il nome sta nell'icona, nascosto alla vista) e le voci scritte dei sottomenu. */
    voci: locator('.sn-menu-item, .sn-menu-griglia .sn-menu-row-btn:not(.sn-menu-row-overflow)'),
    voce,
    /** Clic su una voce per il suo nome, aprendo prima il «+» se sta fra le rare. */
    scegli,
    /** Tasto destro sull'icona (nome o locator) e clic sulla variante col testo dato. */
    variante,
    /** Un'icona della griglia per il suo verbo dell'elenco unico (`copy`, `save`…). */
    icona: (verbo) => locator(`.sn-menu-griglia [data-sn-verbo="${verbo}"]`),
    /** L'icona Incolla: il tasto destro su di lei apre la cronologia degli appunti. */
    incolla: locator('.sn-menu-griglia [data-sn-verbo="paste"]'),
    /** Il «+» che apre le azioni rare nello stesso menu. */
    piu,
    nome: locator('.sn-menu-nome'),
    sottomenu: locator('.sn-menu-sub'),
  };
}

// Con più finestre ci sono più strati (la finestrella di accesso ha il suo): il menu di quello che ne ha uno aperto.
export async function menuDelloStratoAperto(app) {
  for (const w of app.windows().filter((x) => x.url().startsWith('filo://menu/'))) {
    if (await w.locator('.sn-menu').count()) return menuDi(w);
  }
  return null;
}

/** Il menu è aperto (almeno un pannello a schermo). */
export async function menuAperto(scheda) {
  return (await menuDi(scheda).pannelli.count()) > 0;
}

// Esegue `codice` (un'espressione come testo, o una funzione senza argomenti) nel mondo dei content script dove vive il
// menu: quello isolato sui siti, la pagina stessa su filo://. Lì stanno SN_MENU, SN_VISTO e la cronologia degli appunti.
export async function nelMondoDelMenu(app, scheda, codice) {
  if (typeof codice === 'function') codice = `(${codice})()`;
  const superficie = superficieDelMenu(scheda);
  const url = superficie.url();
  if (url.startsWith('filo://')) return superficie.evaluate(codice);
  return app.evaluate(async ({ BrowserWindow }, { u, mondo, codice }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const tab = (win._filoTabs?.tabs || []).find((t) => {
        try { return t.view?.webContents?.getURL() === u; } catch (_) { return false; }
      });
      if (tab) return tab.view.webContents.executeJavaScriptInIsolatedWorld(mondo, [{ code: codice }]);
    }
    return null;
  }, { u: url, mondo: MONDO_CONTENT_SCRIPT, codice });
}

// Lo stato del pannello della cronologia degli appunti: { voci: [{ testo, incolla, rimuovi, tolta, miniatura,
// fuocoRimuovi }], vuoto, cerca, svuota, riquadro, lista, sfondo } | null a pannello chiuso.
export function statoCronologia(app, scheda) {
  return nelMondoDelMenu(app, scheda, 'globalThis.SN_MENU?._test?.cronologia() ?? null');
}

/** Il font-family calcolato delle voci della cronologia aperta (#1342), null a pannello chiuso. */
export function carattereCronologia(app, scheda) {
  return nelMondoDelMenu(app, scheda, `(() => {
    const T = globalThis.SN_FILO_UI && globalThis.SN_FILO_UI._test;
    const el = T ? T.trova('.sn-menu-history-paste') : document.querySelector('.sn-menu-history-paste');
    return el ? getComputedStyle(el).fontFamily : null;
  })()`);
}

// Lo strato del menu sopra la scheda (#1053, spento di serie: `test.use({ stratoDelMenu: true })`). La sua pagina
// filo://menu/ fuori dal documento del sito, e lo stato visto dal main: aperto, punto (px della scheda), area, e se la
// vista è a schermo, in cima alle viste della finestra e dove dice l'area.
export async function paginaDelloStrato(app) {
  const { expect } = await import('@playwright/test');
  let pagina = null;
  await expect.poll(() => Boolean(pagina = app.windows().find((w) => w.url().startsWith('filo://menu/')) || null),
    { message: 'lo strato del menu non è nato', timeout: 0, intervals: [100] }).toBe(true);
  return pagina;
}

export function statoDelloStrato(app) {
  return app.evaluate(({ BrowserWindow, webContents }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs && w._filoTabs.strato);
    if (!win) return null;
    const strato = win._filoTabs.strato;
    const s = strato.stato();
    const v = strato.vista;
    const figli = win.contentView.children || [];
    return {
      ...s,
      visibile: !!v && v.getVisible(),
      // Sopra tutte le viste, barra laterale a parte (#871: la si raggiunge anche a menu aperto).
      inCima: !!v && figli.indexOf(v) >= 0 && figli.slice(figli.indexOf(v) + 1).every((x) => x === win._filoTabs.barra?.vista),
      bounds: v ? v.getBounds() : null,
      tastiera: !!v && webContents.getFocusedWebContents() === v.webContents,
    };
  });
}
