// Disegna sopra la pagina gli avvisi della barra (#588.5). Non decide niente: tetto, tempi,
// chiavi e azioni restano nella shell, che qui manda lo stato; i clic tornano a lei.
(() => {
  'use strict';
  const api = window.avvisi;
  if (!api) return;
  const root = document.documentElement;
  const vassoio = document.getElementById('vassoio');
  const pila = document.getElementById('pila');
  const carte = new Map();
  const NOME_VAR = /^--[a-z][a-z0-9-]*$/;
  let ultimaMisura = '';
  // Le azioni di un avviso che la pagina fa comparire (e spostare) sotto il cursore si armano quando
  // la pila è ferma da ARMA_MS; la X resta sempre viva. patterns/una-conferma-non-e-un-avviso-sopra-un-fatto-gia-compiuto.md
  const ARMA_MS = 1000;
  let firmaPila = '';
  let timerArma = null;

  function applicaTema(tema) {
    const vars = tema && typeof tema.vars === 'object' && tema.vars ? tema.vars : {};
    for (const [k, v] of Object.entries(vars)) {
      if (!NOME_VAR.test(k)) continue;
      if (typeof v === 'string' && v.trim()) root.style.setProperty(k, v.trim());
      else root.style.removeProperty(k);
    }
  }

  function normalizza(stato) {
    const lista = Array.isArray(stato && stato.carte) ? stato.carte : [];
    return lista.map((c) => ({
      id: String((c && c.id) || ''),
      testo: String((c && c.testo) || ''),
      azioni: Array.isArray(c && c.azioni) ? c.azioni.map((a) => String(a || '')) : [],
      chiusa: !!(c && c.chiusa),
    })).filter((c) => c.id);
  }

  function pulsante(classe, testo, azione) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = classe;
    b.textContent = testo;
    b.dataset.azione = azione;
    return b;
  }

  function costruisci(c) {
    const card = document.createElement('div');
    card.className = 'shell-notif';
    card.dataset.nid = c.id;
    const msg = document.createElement('div');
    msg.className = 'shell-notif-msg';
    card.appendChild(msg);
    const chiudi = pulsante('shell-notif-close', '×', 'chiudi');
    chiudi.setAttribute('aria-label', 'Chiudi notifica');
    chiudi.dataset.tip = 'Chiudi';
    card.appendChild(chiudi);
    return card;
  }

  function aggiorna(card, c) {
    const msg = card.querySelector('.shell-notif-msg');
    if (msg.textContent !== c.testo) msg.textContent = c.testo;
    const firma = JSON.stringify(c.azioni);
    if (card.dataset.firma !== firma) {
      card.dataset.firma = firma;
      const vecchia = card.querySelector('.shell-notif-actions');
      if (vecchia) vecchia.remove();
      if (c.azioni.length) {
        const bar = document.createElement('div');
        bar.className = 'shell-notif-actions';
        c.azioni.forEach((etichetta, i) => bar.appendChild(pulsante('shell-notif-action', etichetta, String(i))));
        card.insertBefore(bar, card.querySelector('.shell-notif-close'));
      }
    }
  }

  // Misura sincrona a ogni disegno: la vista nasce nascosta e grande zero, e lì il giro di
  // rendering (e con lui il ResizeObserver) può non partire mai.
  function misura() {
    const w = carte.size ? Math.ceil(pila.offsetWidth) : 0;
    const h = carte.size ? Math.ceil(pila.offsetHeight) : 0;
    const chiave = w + 'x' + h;
    if (chiave === ultimaMisura) return;
    ultimaMisura = chiave;
    api.misura(w, h);
  }

  function arma(firma) {
    if (firma === firmaPila) return;
    firmaPila = firma;
    for (const b of pila.querySelectorAll('.shell-notif-action')) b.disabled = true;
    clearTimeout(timerArma);
    timerArma = setTimeout(() => {
      for (const b of pila.querySelectorAll('.shell-notif-action')) b.disabled = false;
    }, ARMA_MS);
  }

  api.onStato((stato) => {
    applicaTema(stato && stato.tema);
    const lista = normalizza(stato);
    const vivi = new Set(lista.map((c) => c.id));
    for (const [id, el] of carte) {
      if (!vivi.has(id)) { el.remove(); carte.delete(id); }
    }
    const nuove = [];
    lista.forEach((c, i) => {
      let el = carte.get(c.id);
      if (!el) { el = costruisci(c); carte.set(c.id, el); if (!c.chiusa) nuove.push(el); }
      if (pila.children[i] !== el) pila.insertBefore(el, pila.children[i] || null);
      aggiorna(el, c);
      if (c.chiusa) el.classList.remove('show');
    });
    if (nuove.length) {
      // eslint-disable-next-line no-unused-expressions
      pila.offsetHeight;
      for (const el of nuove) el.classList.add('show');
    }
    arma(JSON.stringify(lista));
    misura();
    if (nuove.length) inFondo();
    if (tipSu && (!tipSu.isConnected || !tipSu.closest('.shell-notif.show'))) nascondiTip();
    // La carta sotto il puntatore se n'è andata (o la pila si è svuotata, e la vista sparisce senza un mouseout).
    if (!pila.querySelector('.shell-notif.show:hover')) segnaSopra(false);
  });

  // Il suggerimento di Filo sulle icone, come nella barra (shell.js, data-tip): lo disegna il main.
  let tipSu = null;
  let tipTimer = null;
  function nascondiTip() {
    clearTimeout(tipTimer);
    tipTimer = null;
    if (!tipSu) return;
    tipSu = null;
    api.suggerimento('');
  }
  pila.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t || t === tipSu) return;
    nascondiTip();
    tipSu = t;
    tipTimer = setTimeout(() => {
      const r = t.getBoundingClientRect();
      // Sopra l'icona e allineato alla sua destra: sotto c'è il testo della carta, a destra il bordo della finestra.
      api.suggerimento(t.dataset.tip, Math.round(r.right - 58), Math.round(r.top - 28));
    }, 350);
  });
  pila.addEventListener('mouseout', (e) => {
    const t = e.target.closest('[data-tip]');
    if (t && t === tipSu && !(e.relatedTarget && t.contains(e.relatedTarget))) nascondiTip();
  });
  document.addEventListener('mousedown', nascondiTip, true);
  document.documentElement.addEventListener('mouseleave', nascondiTip);
  window.addEventListener('blur', nascondiTip);

  // Finestra bassa: la vista è più corta della pila e scorre; in vista resta la più recente.
  function inFondo() {
    const fondo = vassoio.scrollHeight - vassoio.clientHeight;
    if (fondo > 0 && vassoio.scrollTop !== fondo) vassoio.scrollTop = fondo;
  }
  try { new ResizeObserver(misura).observe(pila); } catch (_) {}
  window.addEventListener('resize', inFondo);

  pila.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-azione]');
    const card = b && b.closest('.shell-notif');
    if (!card || b.disabled || !card.classList.contains('show')) return;
    api.clic(card.dataset.nid, b.dataset.azione);
  });

  // Il vuoto della vista (margine, spazio accanto a una carta più stretta) è della pagina sotto: i gesti che
  // ci cadono tornano alla scheda. Un gesto partito dal vuoto resta della pagina fino al rilascio (trascinare
  // la barra di scorrimento, selezionare del testo), anche se passa sopra una carta.
  const cartaSotto = (e) => e.target && e.target.closest && e.target.closest('.shell-notif.show');
  // Col puntatore sopra una carta i tempi della pila aspettano: li tiene la shell, qui si dice solo entra/esce.
  let sopra = false;
  function segnaSopra(ora) {
    if (ora === sopra || !api.sopra) return;
    sopra = ora;
    api.sopra(ora);
  }
  pila.addEventListener('mouseover', (e) => { if (cartaSotto(e)) segnaSopra(true); });
  document.addEventListener('mouseout', (e) => {
    const r = e.relatedTarget;
    if (!(r && r.closest && r.closest('.shell-notif.show'))) segnaSopra(false);
  }, true);
  root.addEventListener('mouseleave', () => segnaSopra(false));
  // La barra con cui scorre la pila stessa (finestra bassa) resta sua.
  const suBarraDellaPila = (e) => e.target === vassoio && e.offsetX >= vassoio.clientWidth;
  const vuoto = window.SN_VUOTO.collega({
    inoltra: (gesto) => api.inoltra(gesto),
    onCursore: api.onCursore,
    // La rotella scorre la pagina anche sopra le carte (come sopra le pile della pagina), finché la pila non scorre da sé.
    proprio: (e, tipo) => (tipo === 'rotella'
      ? !!cartaSotto(e) && vassoio.scrollHeight > vassoio.clientHeight
      : !!cartaSotto(e) || (tipo === 'giu' && suBarraDellaPila(e))),
    // La vista tocca i bordi destro e basso della finestra: uscendo di lì il puntatore lascia anche la pagina.
    versoLaPagina: (e) => e.clientX < innerWidth - 1 && e.clientY < innerHeight - 1,
  });

  // Tasto destro su una carta: il menu di Filo con le sue azioni; nel vuoto è della pagina (già rigirato).
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const card = cartaSotto(e);
    if (!card || vuoto.gestoDellaPagina()) return;
    nascondiTip();
    api.menu(card.dataset.nid, e.clientX, e.clientY);
  }, true);
})();
