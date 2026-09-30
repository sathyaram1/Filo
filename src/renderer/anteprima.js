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

  api.onImmagine((d) => {
    if (!d || typeof d.id !== 'string' || typeof d.src !== 'string' || !d.src.startsWith('data:image/')) return;
    const img = new Image();
    img.alt = '';
    img.draggable = false;
    img.src = d.src;
    img.decode().catch(() => {});
    immagini.set(d.id, { img, w: Number(d.w) || 16, h: Number(d.h) || 10 });
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

  api.onMostra((d) => {
    if (!d) return;
    tema(d);
    const m = d.margine || { su: 0, lati: 0, giu: 0 };
    document.body.style.padding = `${m.su}px ${m.lati}px ${m.giu}px`;
    const larghezza = Math.max(120, Math.min(800, Number(d.larghezza) || 280));
    carta.style.width = larghezza + 'px';
    titolo.textContent = String(d.titolo || '');
    indirizzo.textContent = String(d.indirizzo || '');
    foto.replaceChildren();
    const f = d.immagine ? immagini.get(d.id) : null;
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
  });

  api.onNascondi(() => {
    carta.hidden = true;
    foto.replaceChildren();
    requestAnimationFrame(() => requestAnimationFrame(() => api.vuota()));
  });
})();
