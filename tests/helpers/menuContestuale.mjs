// Dove sta il menu del tasto destro, per le prove: l'unico punto che lo sa (#1052). Gli spec lo trovano da qui, mai
// con un selettore sulla pagina, perché il menu uscirà dalla pagina del sito in uno strato di Filo sopra la scheda.
// Sentinella: tests/unit/menuSoloDallAiuto.test.mjs (il marcatore per lo script del sito che cerca il menu sta lì).

const MONDO_CONTENT_SCRIPT = 999;

// IL punto da cambiare quando il menu starà in una vista filo://menu/ sopra la scheda (passo 3 di #1052): oggi è
// disegnato nel documento della scheda stessa (o del riquadro, se si passa un Frame).
export function superficieDelMenu(scheda) {
  return scheda;
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
  return {
    superficie,
    locator,
    valuta: (fn, arg) => superficie.evaluate(fn, arg),
    /** Ogni pannello del menu aperto, principale e sottomenu. */
    pannelli: locator('.sn-menu'),
    principale: locator('.sn-menu:not(.sn-menu-sub)'),
    voci: locator('.sn-menu-item'),
    voce: (testo) => locator('.sn-menu-item', { hasText: testo }),
    icona: (id) => locator(`[data-sn-icon-id="${id}"]`),
    sottomenu: locator('.sn-menu-sub'),
    /** La griglia di «Altro…». */
    griglia: locator('.sn-menu-icon-grid'),
  };
}

/** Il menu è aperto (almeno un pannello a schermo). */
export async function menuAperto(scheda) {
  return (await menuDi(scheda).pannelli.count()) > 0;
}

// Lo stato del pannello della cronologia degli appunti, dall'hook SN_MENU._test del mondo dei content script: quello
// isolato sui siti, la pagina stessa su filo://. { voci: [{ testo, incolla, rimuovi, tolta, miniatura, fuocoRimuovi }],
// vuoto, cerca, svuota, riquadro, lista, sfondo } | null a pannello chiuso.
export async function statoCronologia(app, scheda) {
  const superficie = superficieDelMenu(scheda);
  const url = superficie.url();
  if (url.startsWith('filo://')) return superficie.evaluate(() => globalThis.SN_MENU?._test?.cronologia() ?? null);
  return app.evaluate(async ({ BrowserWindow }, { u, mondo }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      const tab = (win._filoTabs?.tabs || []).find((t) => {
        try { return t.view?.webContents?.getURL() === u; } catch (_) { return false; }
      });
      if (tab) {
        return tab.view.webContents.executeJavaScriptInIsolatedWorld(mondo, [
          { code: 'globalThis.SN_MENU?._test?.cronologia() ?? null' },
        ]);
      }
    }
    return null;
  }, { u: url, mondo: MONDO_CONTENT_SCRIPT });
}
