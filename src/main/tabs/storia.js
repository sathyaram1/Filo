// La cronologia di una scheda oltre la sua vista (#871): ricreare la vista (pagina di Filo ↔ sito, privacy fra
// siti, proxy, crash) non cancella la strada del ritorno. Pura, senza Electron: tabs.js la applica alla vista.
// Sentinella: tests/unit/storiaScheda.test.mjs.

const tornabile = (url) => /^(https?|filo):/i.test(String(url || ''));

function nuova() { return { prima: [], dopo: [] }; }

// Le voci della vista come le vede l'utente: la pagina d'errore vale per l'indirizzo fallito, il resto non si riapre.
// `inArrivo`: la pagina che una vista appena nata sta caricando conta già, o un secondo Indietro di fila la perde.
function vociDellaVista(entries, attiva, utente = (u) => u, inArrivo = null) {
  const voci = [];
  let a = -1;
  (Array.isArray(entries) ? entries : []).forEach((e, i) => {
    const url = String(utente(String((e && e.url) || '')) || '');
    if (!tornabile(url)) return;
    voci.push({ url, titolo: String((e && e.title) || '') });
    if (i <= attiva) a = voci.length - 1;
  });
  return { voci, attiva: Math.max(0, a) };
}

// Prima di buttare la vista. 'nuova': un indirizzo nuovo, il davanti si perde come in ogni browser.
// 'ritorno': un salto fermato riporta la pagina di prima, che non resta anche dietro. Altrimenti è la stessa pagina.
function conserva(storia, { voci, attiva }, modo, url) {
  const s = storia || nuova();
  if (modo === 'ritorno') {
    const ultima = s.prima[s.prima.length - 1];
    return ultima && ultima.url === url ? { prima: s.prima.slice(0, -1), dopo: s.dopo } : s;
  }
  if (!voci.length) return modo === 'nuova' ? { prima: s.prima, dopo: [] } : s;
  if (modo === 'nuova') return { prima: [...s.prima, ...voci.slice(0, attiva + 1)], dopo: [] };
  return { prima: [...s.prima, ...voci.slice(0, attiva)], dopo: [...voci.slice(attiva + 1), ...s.dopo] };
}

// Un salto fuori dalla vista, `k` voci oltre la più vicina: la vista intera passa dall'altra parte.
function salta(storia, voci, verso, k = 0) {
  const s = storia || nuova();
  const avanti = verso === 'avanti';
  const lista = avanti ? s.dopo : s.prima;
  if (!Number.isInteger(k) || k < 0 || k >= lista.length) return null;
  if (avanti) {
    return { meta: s.dopo[k], storia: { prima: [...s.prima, ...voci, ...s.dopo.slice(0, k)], dopo: s.dopo.slice(k + 1) } };
  }
  const i = s.prima.length - 1 - k;
  return { meta: s.prima[i], storia: { prima: s.prima.slice(0, i), dopo: [...s.prima.slice(i + 1), ...voci, ...s.dopo] } };
}

// Il seguito dell'elenco del tasto destro su Indietro e Avanti, dalla più vicina. Gli indici fuori dalla vista
// sono negativi dietro e oltre la sua lunghezza davanti: vaiAllaVoce li riconosce con `fuori`.
function elenco(storia, verso, lunghezza) {
  const s = storia || nuova();
  if (verso === 'avanti') return s.dopo.map((v, k) => ({ indice: lunghezza + k, titolo: v.titolo, url: v.url }));
  return s.prima.slice().reverse().map((v, k) => ({ indice: -(k + 1), titolo: v.titolo, url: v.url }));
}

function fuori(indice, lunghezza) {
  if (indice < 0) return { verso: 'indietro', k: -indice - 1 };
  if (indice >= lunghezza) return { verso: 'avanti', k: indice - lunghezza };
  return null;
}

// Una pagina nuova dentro la stessa vista toglie il davanti, come in ogni browser; un passo nella cronologia no.
// `prima` è la misura precedente della stessa vista, `passo` dice se il movimento l'ha chiesto Filo (Indietro, Avanti).
function paginaNuova(prima, ora, passo) {
  if (!prima || !ora || passo) return false;
  if (ora.a !== ora.n - 1) return false;
  return ora.n > prima.n || ora.a === prima.a + 1;
}

module.exports = { nuova, vociDellaVista, conserva, salta, elenco, fuori, paginaNuova, tornabile };
