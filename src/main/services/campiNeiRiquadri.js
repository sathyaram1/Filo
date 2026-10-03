// I campi segreti dentro i riquadri incorporati della pagina (#810.7): il campo della carta di un servizio di
// pagamento sta in un riquadro di un altro sito, che il content script della pagina non vede. Coordinate della
// finestra della pagina principale; le regole dei campi stanno in src/shared/campiSegreti.js.

const ATTESA_MS = 1000;

function entro(promessa, ms) {
  return Promise.race([Promise.resolve(promessa).catch(() => null), new Promise((ok) => setTimeout(() => ok(null), ms))]);
}

function codiceMisura() {
  const G = globalThis.SN_GUARDIANO_STATICO;
  const S = globalThis.SN_CAMPI_SEGRETI;
  return `(function () { const luhn = ${G.luhn}; const cartaValida = ${G.cartaValida};
    try { return (${S.crea})(window, cartaValida).campiInVista(); } catch (_) { return []; } })()`;
}

// Il riquadro che contiene `figlio`, misurato nel documento che lo ospita: il genitore riconosce il mittente di
// un messaggio, e il messaggio porta solo un segnale usa e getta.
async function boxNelGenitore(figlio) {
  const genitore = figlio.parent;
  if (!genitore) return null;
  const segnale = `filo-riquadro-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const risposta = genitore.executeJavaScript(`new Promise((ok) => {
    const fine = setTimeout(() => { removeEventListener('message', h, true); ok(null); }, ${ATTESA_MS - 100});
    function h(e) {
      if (e.data !== ${JSON.stringify(segnale)}) return;
      e.stopImmediatePropagation();
      for (const el of document.querySelectorAll('iframe, frame')) {
        if (el.contentWindow !== e.source) continue;
        clearTimeout(fine);
        removeEventListener('message', h, true);
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const pl = parseFloat(cs.paddingLeft) || 0, pt = parseFloat(cs.paddingTop) || 0;
        const pr = parseFloat(cs.paddingRight) || 0, pb = parseFloat(cs.paddingBottom) || 0;
        return ok({ left: r.left + el.clientLeft + pl, top: r.top + el.clientTop + pt,
          width: el.clientWidth - pl - pr, height: el.clientHeight - pt - pb });
      }
    }
    addEventListener('message', h, true);
  })`);
  // Gli script di uno stesso riquadro girano in ordine: quando questo risponde, l'ascolto è già acceso.
  if ((await entro(genitore.executeJavaScript('0'), ATTESA_MS)) === null) return null;
  await entro(figlio.executeJavaScript(`parent.postMessage(${JSON.stringify(segnale)}, '*')`), ATTESA_MS);
  return entro(risposta, ATTESA_MS);
}

function interseca(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

// `{ campi, nonCoperti }`: `nonCoperti` quando un riquadro ha campi segreti ma non si è riusciti a ritrovarlo nella
// pagina, e l'immagine non deve partire.
async function campiSegretiNeiRiquadri(webContents) {
  let riquadri = [];
  try { riquadri = webContents.mainFrame.framesInSubtree.filter((f) => f !== webContents.mainFrame); } catch (_) {}
  if (!riquadri.length) return { campi: [], nonCoperti: false };
  const codice = codiceMisura();
  const campi = [];
  let nonCoperti = false;
  await Promise.all(riquadri.map(async (f) => {
    const dentro = await entro(f.executeJavaScript(codice), ATTESA_MS);
    if (!Array.isArray(dentro) || !dentro.length) return;
    // Dal riquadro alla pagina: ogni livello sposta le coordinate e ritaglia quello che il riquadro non mostra.
    const scatole = [];
    for (let cur = f; cur.parent; cur = cur.parent) {
      const box = await boxNelGenitore(cur);
      if (!box) { nonCoperti = true; return; }
      scatole.push(box);
    }
    let dx = 0, dy = 0;
    let vista = null;
    for (const box of scatole) {
      const qui = { left: box.left, top: box.top, width: box.width, height: box.height };
      vista = vista ? interseca({ ...vista, left: vista.left + box.left, top: vista.top + box.top }, qui) : qui;
      dx += box.left;
      dy += box.top;
      if (!vista) return;
    }
    for (const c of dentro) {
      const r = interseca({ left: c.left + dx, top: c.top + dy, width: c.width, height: c.height }, vista);
      if (r) campi.push({ ...c, ...r });
    }
  }));
  return { campi, nonCoperti };
}

module.exports = { campiSegretiNeiRiquadri, codiceMisura };
