// I rimedi dell'avviso dei crediti (#818) come righe con un pulsante: lo stesso pulsante applica e rimette com'era.
// Lo usano la chat della home e la pagina Crediti; cosa cambia lo ricalcola il main (handlers/avvisoCrediti.js).
// Testi sempre come textContent. Un ridisegno tiene i pulsanti che non cambiano: patterns/un-elenco-che-si-aggiorna-non-rifa-i-pulsanti.md.

(function (global) {
  'use strict';

  const MSG = () => (global.SN_MSG && global.SN_MSG.MSG) || {};

  // { avviso, invia(msg) → Promise<risposta>, classeBottone, apriChiave(), esito: { id, frase }, onEsito(id, frase) } → <ul>
  // `esito` rimette sotto il suo rimedio la frase dell'ultimo clic, se chi ridisegna la vuole tenere.
  function elenco(opz = {}) {
    const ul = document.createElement('ul');
    ul.className = 'sn-crediti-rimedi';
    return aggiorna(ul, opz);
  }

  // Ridisegna `ul` sul posto: una riga resta, e il suo pulsante pure se fa ancora la stessa cosa.
  function aggiorna(ul, { avviso, invia, classeBottone = '', apriChiave = null, esito = null, onEsito = null } = {}) {
    const opz = { invia, classeBottone, apriChiave, onEsito };
    const vecchie = new Map();
    for (const li of Array.from(ul.children)) if (li.dataset && li.dataset.rimedio) vecchie.set(li.dataset.rimedio, li);
    const righe = (avviso && Array.isArray(avviso.rimedi) ? avviso.rimedi : []).map((r) => {
      const li = vecchie.get(r.id) || document.createElement('li');
      li.className = 'sn-crediti-rimedio';
      disegna(li, r, opz, esito && esito.id === r.id ? esito.frase : '');
      return li;
    });
    allinea(ul, righe);
    return ul;
  }

  // Prima si tolgono i figli che non restano, poi i nuovi davanti ai rimasti: un nodo che resta non si stacca mai.
  function allinea(padre, figli) {
    const tieni = new Set(figli);
    for (const f of Array.from(padre.children)) if (!tieni.has(f)) f.remove();
    figli.forEach((f, i) => { if (padre.children[i] !== f) padre.insertBefore(f, padre.children[i] || null); });
  }

  function disegna(li, r, opz, esito) {
    // Chi ascolta sul pulsante rimasto legge il rimedio di adesso, non quello con cui il pulsante è nato.
    li._rimedio = r;
    li._opz = opz;
    li.dataset.rimedio = r.id;
    li.dataset.applicato = r.applicato ? '1' : '0';
    const corpo = document.createElement('div');
    corpo.className = 'sn-crediti-rimedio-corpo';
    const testo = document.createElement('span');
    testo.className = 'sn-crediti-rimedio-testo';
    testo.textContent = r.testo || '';
    corpo.appendChild(testo);
    if (r.frase) {
      const cifra = document.createElement('span');
      cifra.className = 'sn-crediti-rimedio-cifra';
      cifra.textContent = r.frase;
      corpo.appendChild(cifra);
    }
    for (const d of r.dettagli || []) {
      const det = document.createElement('span');
      det.className = 'sn-crediti-rimedio-dettaglio';
      det.textContent = d;
      corpo.appendChild(det);
    }
    if (esito) {
      const e = document.createElement('span');
      e.className = 'sn-crediti-rimedio-esito';
      e.setAttribute('role', 'status');
      e.textContent = esito;
      corpo.appendChild(e);
    }
    const vecchio = li.querySelector(':scope > .sn-crediti-rimedio-corpo');
    if (vecchio) li.replaceChild(corpo, vecchio);
    else li.insertBefore(corpo, li.firstChild);

    const chiave = r.azione && r.etichetta ? `${r.azione}\u0001${r.etichetta}` : '';
    const classe = `sn-crediti-rimedio-btn ${opz.classeBottone || ''}`.trim();
    let btn = li.querySelector(':scope > .sn-crediti-rimedio-btn');
    if (btn && btn.dataset.chiave === chiave) {
      if (btn.className !== classe) btn.className = classe;
      return;
    }
    if (btn) btn.remove();
    if (!chiave) return;
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = classe;
    btn.dataset.chiave = chiave;
    btn.textContent = r.etichetta;
    btn.addEventListener('click', () => { premi(li, btn).catch(() => {}); });
    li.appendChild(btn);
  }

  async function premi(li, btn) {
    if (btn.disabled) return;
    const r = li._rimedio;
    const opz = li._opz || {};
    if (!r) return;
    if (r.azione === 'chiave') {
      // Il rimedio che il main non vede: lo dice ai contatori del servizio (#1472).
      try { if (opz.invia) Promise.resolve(opz.invia({ type: MSG().CONTATORI_EVENTO, misura: 'rimedio-crediti', id: 'chiave' })).catch(() => {}); } catch (_) {}
      if (opz.apriChiave) opz.apriChiave();
      return;
    }
    const tipo = r.azione === 'annulla' ? MSG().CREDITS_REMEDY_UNDO : MSG().CREDITS_REMEDY_APPLY;
    btn.disabled = true;
    let res = null;
    try { res = await opz.invia({ type: tipo, id: r.id }); } catch (_) { res = null; }
    btn.disabled = false;
    const attuale = li._rimedio || r;
    if (!res || res.ok === false) {
      const frase = (res && res.frase) || 'Non ci sono riuscito: riprova.';
      if (opz.onEsito) opz.onEsito(r.id, frase);
      disegna(li, attuale, li._opz || opz, frase);
      return;
    }
    const nuovo = res.avviso && Array.isArray(res.avviso.rimedi) ? res.avviso.rimedi.find((x) => x.id === r.id) : null;
    if (opz.onEsito) opz.onEsito(r.id, res.frase || '');
    // Rimesso com'era e la proposta non c'è più (le soglie non dicono più niente): resta solo l'esito.
    disegna(li, nuovo || { id: r.id, testo: '', applicato: false }, li._opz || opz, res.frase || '');
  }

  global.SN_CREDITI_AVVISO_UI = { elenco, aggiorna };
})(typeof globalThis !== 'undefined' ? globalThis : this);
