// «Le tue segnalazioni» in bacheca (#986): la copia locale di ciò che questo computer ha mandato, con data e stato.
// Legge e toglie solo dal main (SEGNALAZIONI_MIE_*): niente rete. Le regole dell'elenco: src/main/services/segnalazioniMie.js.

(function () {
  'use strict';

  let sezione, conto, lista, vuoto, altre, titoloMigliorie;

  // Chiusa, la sezione mostra le più recenti: in cima alla bacheca non deve spingere giù i miglioramenti.
  const RECENTI = 3;
  const CONFERMA_MS = 3000;
  const STATI = {
    in_partenza: { testo: 'in partenza', hover: 'Parte da sola appena c’è la rete' },
    inviata: { testo: 'inviata', hover: 'È arrivata. Quando sarà risolta, Filo te lo dice all’avvio' },
    non_partita: { testo: 'non partita', hover: 'Non è arrivata. Per rimandarla usa «Invia feedback» dal tasto destro' },
    risolta: { testo: 'risolta', hover: 'È stata sistemata' },
    chiusa: { testo: 'chiusa', hover: 'Chiusa senza modifiche' },
  };

  let tutte = location.hash === '#segnalazioni';
  let voci = [];
  let precedenti = false;
  const righe = new Map();
  let giro = 0;

  function send(msg) {
    if (window.filo?.message) return window.filo.message(msg);
    if (window.chrome?.runtime?.sendMessage) return window.chrome.runtime.sendMessage(msg);
    return Promise.reject(new Error('canale main non disponibile'));
  }

  function quando(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function titoloDi(v) {
    const primaRiga = String(v.testo || '').trim().split('\n')[0].trim();
    const base = v.titolo || primaRiga || (v.allegati || []).join(', ') || 'Segnalazione';
    return v.num ? `#${v.num} ${base}` : base;
  }

  function nuovaRiga(id) {
    const el = document.createElement('article');
    el.className = 'bd-mia';
    el.dataset.id = id;

    const testa = document.createElement('button');
    testa.type = 'button';
    testa.className = 'bd-mia-testa';
    testa.setAttribute('aria-expanded', 'false');
    const titolo = document.createElement('span');
    titolo.className = 'bd-mia-titolo';
    const sub = document.createElement('span');
    sub.className = 'bd-mia-sub';
    testa.append(titolo, sub);

    const stato = document.createElement('span');
    stato.className = 'bd-mia-stato';

    const togli = document.createElement('button');
    togli.type = 'button';
    togli.className = 'bd-mia-togli';
    const icona = (window.SN_ICONS?.trash?.(15)) || '×';

    const corpo = document.createElement('div');
    corpo.className = 'bd-mia-corpo';
    corpo.hidden = true;
    const testo = document.createElement('p');
    testo.className = 'bd-mia-testo';
    const allegati = document.createElement('p');
    allegati.className = 'bd-mia-allegati';
    const risposta = document.createElement('p');
    risposta.className = 'bd-mia-risposta';
    corpo.append(testo, allegati, risposta);

    el.append(testa, stato, togli, corpo);

    testa.addEventListener('click', () => {
      const aperta = corpo.hidden;
      corpo.hidden = !aperta;
      testa.setAttribute('aria-expanded', String(aperta));
      el.classList.toggle('bd-mia-aperta', aperta);
    });

    // Togliere non si annulla: il pulsante chiede conferma sul posto e torna com'era da solo.
    let timer = null;
    function riposo() {
      clearTimeout(timer); timer = null;
      togli.classList.remove('bd-mia-togli-conferma');
      togli.innerHTML = icona;
      togli.title = 'Togli dall’elenco';
      togli.setAttribute('aria-label', 'Togli dall’elenco');
    }
    riposo();
    togli.addEventListener('click', async () => {
      if (!timer) {
        togli.classList.add('bd-mia-togli-conferma');
        togli.textContent = 'Togli?';
        togli.title = 'Clicca di nuovo per toglierla';
        togli.setAttribute('aria-label', 'Conferma: togli dall’elenco');
        timer = setTimeout(riposo, CONFERMA_MS);
        return;
      }
      clearTimeout(timer); timer = null;
      togli.disabled = true;
      try {
        const r = await send({ type: 'segnalazioni_mie_togli', id });
        if (r && r.ok && Array.isArray(r.voci)) { voci = r.voci; disegna(); return; }
      } catch (_) {}
      togli.disabled = false;
      riposo();
    });

    return { el, titolo, sub, stato, testo, allegati, risposta };
  }

  function aggiornaRiga(r, v) {
    const t = titoloDi(v);
    r.titolo.textContent = t;
    r.titolo.title = t;
    const n = (v.allegati || []).length;
    r.sub.textContent = [quando(v.creataIl), n ? (n === 1 ? '1 allegato' : `${n} allegati`) : ''].filter(Boolean).join(' · ');
    const s = STATI[v.stato] || STATI.in_partenza;
    r.stato.textContent = s.testo;
    r.stato.title = s.hover;
    r.stato.dataset.stato = STATI[v.stato] ? v.stato : 'in_partenza';
    r.testo.textContent = String(v.testo || '').trim();
    r.testo.hidden = !r.testo.textContent;
    r.allegati.textContent = n ? `Allegati: ${v.allegati.join(', ')}` : '';
    r.allegati.hidden = !n;
    r.risposta.textContent = v.risposta ? `Risposta: ${v.risposta}` : '';
    r.risposta.hidden = !v.risposta;
  }

  function ordinate() {
    return voci.slice().sort((a, b) => {
      const ta = Date.parse(a.creataIl || '') || 0;
      const tb = Date.parse(b.creataIl || '') || 0;
      return tb - ta;
    });
  }

  function disegna() {
    const tutteLe = ordinate();
    const visibili = tutte ? tutteLe : tutteLe.slice(0, RECENTI);
    const vivi = new Set(tutteLe.map((v) => v.id));
    for (const [id, r] of righe) if (!vivi.has(id)) { r.el.remove(); righe.delete(id); }
    const mostrati = new Set(visibili.map((v) => v.id));
    for (const [id, r] of righe) if (!mostrati.has(id)) r.el.remove();
    // Le righe che restano non si ricreano: una riga aperta resta aperta e un «Togli?» in attesa non si perde.
    let prima = null;
    for (const v of visibili) {
      let r = righe.get(v.id);
      if (!r) { r = nuovaRiga(v.id); righe.set(v.id, r); }
      aggiornaRiga(r, v);
      const dopo = prima ? prima.nextSibling : lista.firstChild;
      if (r.el !== dopo) lista.insertBefore(r.el, dopo);
      prima = r.el;
    }

    const n = tutteLe.length;
    conto.textContent = n ? String(n) : '';
    const mostra = n > 0 || location.hash === '#segnalazioni';
    sezione.hidden = !mostra;
    if (titoloMigliorie) titoloMigliorie.hidden = !mostra;
    vuoto.hidden = n > 0;
    // Chi ha mandato segnalazioni prima che l'elenco esistesse non deve leggere che non ne ha mai mandate.
    vuoto.textContent = precedenti
      ? 'Quelle che hai mandato prima di questa versione compaiono qui quando vengono risolte.'
      : 'Da questo computer non hai ancora mandato segnalazioni.';
    altre.hidden = n <= RECENTI;
    altre.textContent = tutte ? 'Solo le ultime' : `Tutte e ${n}`;
    altre.setAttribute('aria-expanded', String(tutte));
  }

  async function carica() {
    const mio = ++giro;
    let r = null;
    try { r = await send({ type: 'segnalazioni_mie_list' }); } catch (_) { r = null; }
    if (mio !== giro) return;
    // L'incognito non vede l'elenco: la sezione non compare, come se non ci fosse.
    if (!r || !r.ok || r.incognito) { sezione.hidden = true; if (titoloMigliorie) titoloMigliorie.hidden = true; return; }
    voci = Array.isArray(r.voci) ? r.voci : [];
    precedenti = !!r.precedenti;
    disegna();
    if (location.hash === '#segnalazioni' && !carica.portata) {
      carica.portata = true;
      sezione.scrollIntoView({ block: 'start' });
    }
  }

  function init() {
    sezione = document.getElementById('bdMie');
    conto = document.getElementById('bdMieConto');
    lista = document.getElementById('bdMieLista');
    vuoto = document.getElementById('bdMieVuoto');
    altre = document.getElementById('bdMieAltre');
    titoloMigliorie = document.getElementById('bdMiglioramentiTitolo');
    if (!sezione || !lista) return;

    altre.addEventListener('click', () => { tutte = !tutte; disegna(); });

    window.addEventListener('hashchange', () => {
      if (location.hash !== '#segnalazioni') return;
      tutte = true;
      carica.portata = false;
      carica();
    });

    if (window.chrome?.runtime?.onMessage?.addListener) {
      window.chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === 'segnalazioni_mie_cambiate') carica();
      });
    }

    carica();
  }

  window.SN_BOARD_SEGNALAZIONI = { init };
})();
