// Specifica Bombadil per una pagina interna di Filo (filo://…).
//
// Vale per qualunque pagina interna: tutte caricano gli stessi gettoni del tema
// (`--sn-bg` e compagnia), quindi le proprietà qui sotto non nominano nessuna
// pagina in particolare. La pagina da provare la decide chi lancia, aprendola
// con tests/bombadil/apri-filo.mjs.
//
// Azioni: i generatori di serie, tranne andare avanti e indietro nella
// cronologia. In una scheda di Filo «indietro» porta fuori dalla pagina (alla
// newtab), e da quel momento Bombadil proverebbe un'altra pagina credendo di
// provare questa: i rilievi che trovasse non sarebbero attribuibili.

import { always } from "@antithesishq/bombadil";
// `extract` dalla porta del driver browser, non dalla radice: quella radice è
// generica sul driver e lascia lo stato senza tipo.
import { extract } from "@antithesishq/bombadil/browser";

export {
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
  noConsoleErrors,
} from "@antithesishq/bombadil/browser/defaults/properties";

export {
  clicks,
  inputs,
  scroll,
  reload,
  waitOnce,
} from "@antithesishq/bombadil/browser/defaults/actions";

// Testo visibile della pagina. `innerText` e non `textContent`: quello che conta
// è ciò che l'utente legge, non quello che resta appeso in un nodo nascosto.
const testoVisibile = extract((state) =>
  (state.document.body?.innerText ?? "").trim(),
);

const elementiVisibili = extract(
  (state) => state.document.body?.querySelectorAll("*").length ?? 0,
);

// Valori che non dovrebbero mai finire sotto gli occhi di chi legge: sono il
// segno di un dato che non c'era, di un numero che non si è calcolato o di un
// oggetto stampato come fosse testo.
const SPORCO = ["undefined", "NaN", "[object Object]", "[object Undefined]"];

const testoSporco = extract((state) => {
  const sporco: string[] = [];
  const cammino = state.document.createTreeWalker(
    state.document.body,
    // NodeFilter.SHOW_TEXT
    4,
  );
  let nodo = cammino.nextNode();
  while (nodo) {
    const testo = (nodo.textContent ?? "").trim();
    if (testo) {
      const padre = nodo.parentElement;
      // Solo ciò che è davvero disegnato: un nodo in un ramo nascosto non
      // mente a nessuno, e contarlo riempirebbe il giro di rilievi finti.
      const disegnato = padre
        ? (padre as HTMLElement).offsetParent !== null ||
          padre === state.document.body
        : false;
      if (disegnato) {
        for (const brutto of SPORCO) {
          if (testo.includes(brutto)) {
            sporco.push(`${brutto} in <${padre?.tagName?.toLowerCase()}>: ${testo.slice(0, 120)}`);
          }
        }
      }
    }
    nodo = cammino.nextNode();
  }
  return sporco;
});

// I gettoni del tema, letti dal documento. Se `--sn-bg` si svuota, o lo sfondo
// diventa trasparente, la pagina resta leggibile solo per caso.
const tema = extract((state) => {
  const stile = state.window.getComputedStyle(state.document.documentElement);
  const sfondoCorpo = state.document.body
    ? state.window.getComputedStyle(state.document.body).backgroundColor
    : "";
  return {
    sfondoGettone: stile.getPropertyValue("--sn-bg").trim(),
    testoGettone: stile.getPropertyValue("--sn-fg").trim(),
    sfondoCorpo,
  };
});

/** La pagina non resta bianca: qualcosa da leggere e qualcosa da cliccare. */
export const paginaNonVuota = always(
  () => testoVisibile.current.length >= 20 && elementiVisibili.current >= 10,
);

/** Nessun valore di servizio arriva sotto gli occhi dell'utente. */
export const nienteValoriSporchi = always(() => testoSporco.current.length === 0);

/** Il tema resta dichiarato: sfondo e testo hanno un colore, non il caso. */
export const temaCoerente = always(() => {
  const t = tema.current;
  if (!t) return true;
  if (t.sfondoGettone === "" || t.testoGettone === "") return false;
  return t.sfondoCorpo !== "rgba(0, 0, 0, 0)" && t.sfondoCorpo !== "transparent";
});
