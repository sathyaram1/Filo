// La carta di anteprima di una scheda (#430): tiene pronte le foto di tutte le schede, così a una comparsa
// non c'è niente da scaricare né da decodificare. Disegna soltanto: quando e dove lo decidono shell e main.

(() => {
  const api = window.anteprima;
  const carta = document.getElementById('carta');
  const titolo = document.getElementById('titolo');
  const indirizzo = document.getElementById('indirizzo');
  const foto = document.getElementById('foto');
  const NOME_VAR = /^--[a-z][a-z0-9-]*$/;
  const immagini = new Map();
  let temaMesso = [];
  let ultima = null;

  api.onImmagine((d) => {
    if (!d || typeof d.id !== 'string' || typeof d.src !== 'string' || !d.src.startsWith('data:image/')) return;
    const img = new Image();
    img.alt = '';
    img.draggable = false;
    img.src = d.src;
    const f = { img, w: Number(d.w) || 16, h: Number(d.h) || 10, pronta: false };
    f.decodifica = img.decode().catch(() => {}).then(() => { f.pronta = true; });
    immagini.set(d.id, f);
  });

  api.onDimentica((ids) => {
    for (const id of Array.isArray(ids) ? ids : []) immagini.delete(id);
  });

  function tema(d) {
    const root = document.documentElement;
    root.classList.toggle('scuro', !!d.scuro);
    for (const k of temaMesso) root.style.removeProperty(k);
    temaMesso = [];
    for (const [k, v] of Object.entries(d.tema || {})) {
      if (!NOME_VAR.test(k) || typeof v !== 'string' || !v) continue;
      root.style.setProperty(k, v);
      temaMesso.push(k);
    }
  }

  // Una foto arrivata un istante fa si aspetta decodificata: la carta non compare mai con un buco al suo posto.
  api.onMostra((d) => {
    if (!d) return;
    ultima = d.n;
    const f = d.immagine ? immagini.get(d.id) : null;
    if (f && !f.pronta) {
      // Col tetto: una decodifica che non torna non deve tenere la carta chiusa.
      Promise.race([f.decodifica, new Promise((r) => setTimeout(r, 150))])
        .then(() => { if (ultima === d.n) disegna(d, f); });
      return;
    }
    disegna(d, f);
  });

  function disegna(d, f) {
    tema(d);
    const m = d.margine || { su: 0, lati: 0, giu: 0 };
    document.body.style.padding = `${m.su}px ${m.lati}px ${m.giu}px`;
    const larghezza = Math.max(120, Math.min(800, Number(d.larghezza) || 280));
    carta.style.width = larghezza + 'px';
    titolo.textContent = String(d.titolo || '');
    indirizzo.textContent = String(d.indirizzo || '');
    foto.replaceChildren();
    if (f) {
      const interna = larghezza - 2;
      // L'altezza segue la pagina, ma una pagina stretta e alta non diventa un poster.
      const alta = Math.round(Math.max(interna * 0.5, Math.min(interna * 0.75, interna * f.h / f.w)));
      foto.style.height = alta + 'px';
      foto.appendChild(f.img);
    }
    carta.hidden = false;
    const r = carta.getBoundingClientRect();
    api.misura(d.n, Math.ceil(r.width), Math.ceil(r.height));
  }

  api.onNascondi(() => {
    ultima = null;
    carta.hidden = true;
    foto.replaceChildren();
    // Due fotogrammi perché il vuoto arrivi a schermo; il tetto per quando la finestra non disegna (coperta, fuori schermo).
    let detto = false;
    const vuota = () => { if (!detto) { detto = true; api.vuota(); } };
    requestAnimationFrame(() => requestAnimationFrame(vuota));
    setTimeout(vuota, 100);
  });
})();
