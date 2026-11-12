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
  // Quello che della vista è dell'utente (una carta, i comandi della pila); il resto è vuoto, della pagina sotto.
  const SOPRA = '.shell-notif.show, .avvisi-testa.show';
  const SOPRA_HOVER = '.shell-notif.show:hover, .avvisi-testa.show:hover';
  let ultimaMisura = '';
  // Le azioni di un avviso che la pagina fa comparire (e spostare) sotto il cursore si armano quando
  // la pila è ferma da ARMA_MS; la X resta sempre viva. patterns/una-conferma-non-e-un-avviso-sopra-un-fatto-gia-compiuto.md
  const ARMA_MS = 1000;
  let firmaPila = '';
  let timerArma = null;
  // «Chiudi tutti» porta via anche quello che non si è letto: si arma come le azioni delle carte.
  const ARMABILI = '.shell-notif-action, .avvisi-testa [data-pila="chiudi-tutti"]';

  // In cima alla pila i comandi della pila intera: «+N» per quelle che aspettano oltre il tetto (le tiene la shell),
  // aperto Riduci e Chiudi tutti.
  const testa = document.createElement('div');
  testa.className = 'avvisi-testa';
  testa.hidden = true;
  const comando = (nome, etichetta) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.pila = nome;
    b.textContent = etichetta;
    testa.appendChild(b);
    return b;
  };
  const tastoTutte = comando('chiudi-tutti', 'Chiudi tutti');
  const tastoAltre = comando('apri', '');
  tastoAltre.dataset.tip = 'Mostra tutti';
  const tastoRiduci = comando('riduci', 'Riduci');
  pila.appendChild(testa);
  let aperta = false;
  // Appena aperto il «+N» in vista restano le più vecchie e i comandi; un avviso nuovo riporta giù.
  let cima = false;
  let ultimaVista = '';

  function disegnaTesta(altre, ora) {
    testa.hidden = !(altre > 0 || ora);
    tastoAltre.hidden = ora || !(altre > 0);
    tastoRiduci.hidden = !ora;
    tastoTutte.hidden = !ora;
    const scritta = `+${altre} ${altre === 1 ? 'avviso' : 'avvisi'}`;
    if (!tastoAltre.hidden && tastoAltre.textContent !== scritta) tastoAltre.textContent = scritta;
    if (!testa.hidden && !testa.classList.contains('show')) {
      // eslint-disable-next-line no-unused-expressions
      testa.offsetHeight;
      testa.classList.add('show');
    } else if (testa.hidden) testa.classList.remove('show');
  }

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
      trascina: !!(c && c.trascina),
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
    // #588.8 — l'avviso di un file arrivato si trascina come il file (il trascinamento lo fa il sistema, dal main).
    card.draggable = c.trascina;
    if (c.trascina) card.dataset.trascina = '1'; else delete card.dataset.trascina;
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
    for (const b of pila.querySelectorAll(ARMABILI)) b.disabled = true;
    clearTimeout(timerArma);
    timerArma = setTimeout(() => {
      for (const b of pila.querySelectorAll(ARMABILI)) b.disabled = false;
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
      if (pila.children[i + 1] !== el) pila.insertBefore(el, pila.children[i + 1] || null);
      aggiorna(el, c);
      if (c.chiusa) el.classList.remove('show');
    });
    if (nuove.length) {
      // eslint-disable-next-line no-unused-expressions
      pila.offsetHeight;
      for (const el of nuove) el.classList.add('show');
    }
    const ora = !!(stato && stato.aperta) && lista.length > 0;
    const altre = Math.max(0, Number(stato && stato.altre) || 0);
    const vive = lista.filter((c) => !c.chiusa);
    const ultima = vive.length ? vive[vive.length - 1].id : '';
    const arrivata = !!ultima && ultima !== ultimaVista;
    ultimaVista = ultima;
    const appenaAperta = ora && !aperta;
    if (appenaAperta) cima = true;
    if (!ora || arrivata) cima = false;
    aperta = ora;
    disegnaTesta(lista.length ? altre : 0, ora);
    arma(JSON.stringify(lista));
    misura();
    if (nuove.length || appenaAperta) inVista();
    if (tipSu && (!tipSu.isConnected || tipSu.hidden || !tipSu.closest(SOPRA))) nascondiTip();
    // La carta sotto il puntatore se n'è andata (o la pila si è svuotata, e la vista sparisce senza un mouseout).
    if (!pila.querySelector(SOPRA_HOVER)) segnaSopra(false);
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

  // Finestra bassa: la vista è più corta della pila e scorre; in vista resta la più recente, o la cima appena aperto «+N».
  function inVista() {
    const fondo = vassoio.scrollHeight - vassoio.clientHeight;
    const dove = cima ? 0 : fondo;
    if (fondo > 0 && vassoio.scrollTop !== dove) vassoio.scrollTop = dove;
  }
  try { new ResizeObserver(misura).observe(pila); } catch (_) {}
  window.addEventListener('resize', inVista);

  pila.addEventListener('click', (e) => {
    const p = e.target.closest('.avvisi-testa button[data-pila]');
    if (p) {
      if (!p.disabled && !p.hidden && !testa.hidden) { nascondiTip(); api.pila(p.dataset.pila); }
      return;
    }
    const b = e.target.closest('button[data-azione]');
    const card = b && b.closest('.shell-notif');
    if (!card || b.disabled || !card.classList.contains('show')) return;
    api.clic(card.dataset.nid, b.dataset.azione);
  });

  // Il vuoto della vista (margine, spazio accanto a una carta più stretta) è della pagina sotto: i gesti che
  // ci cadono tornano alla scheda. Un gesto partito dal vuoto resta della pagina fino al rilascio (trascinare
  // la barra di scorrimento, selezionare del testo), anche se passa sopra una carta.
  const cartaSotto = (e) => e.target && e.target.closest && e.target.closest(SOPRA);
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
    if (!(r && r.closest && r.closest(SOPRA))) segnaSopra(false);
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

  pila.addEventListener('dragstart', (e) => {
    const card = e.target && e.target.closest && e.target.closest('.shell-notif[data-trascina="1"]');
    if (!card || !api.trascina) return;
    e.preventDefault();
    nascondiTip();
    api.trascina(card.dataset.nid);
  });

  // Tasto destro su una carta: il menu di Filo con le sue azioni; nel vuoto è della pagina (già rigirato).
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const card = cartaSotto(e);
    if (!card || vuoto.gestoDellaPagina()) return;
    nascondiTip();
    if (card === testa) api.menuPila(e.clientX, e.clientY);
    else api.menu(card.dataset.nid, e.clientX, e.clientY);
  }, true);
})();
