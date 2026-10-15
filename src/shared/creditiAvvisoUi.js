// I rimedi dell'avviso dei crediti (#818) come righe con un pulsante: lo stesso pulsante applica e rimette com'era.
// Lo usano la chat della home e la pagina Crediti; cosa cambia lo ricalcola il main (handlers/avvisoCrediti.js).
// Testi sempre come textContent: arrivano dal main, ma i nomi dei modelli li scrive la configurazione.

(function (global) {
  'use strict';

  const MSG = () => (global.SN_MSG && global.SN_MSG.MSG) || {};

  // { avviso, invia(msg) → Promise<risposta>, classeBottone, apriChiave(), esito: { id, frase }, onEsito(id, frase) } → <ul>
  // `esito` rimette sotto il suo rimedio la frase dell'ultimo clic, se chi ridisegna la vuole tenere.
  function elenco({ avviso, invia, classeBottone = '', apriChiave = null, esito = null, onEsito = null } = {}) {
    const ul = document.createElement('ul');
    ul.className = 'sn-crediti-rimedi';
    const opz = { invia, classeBottone, apriChiave, onEsito };
    for (const r of (avviso && Array.isArray(avviso.rimedi) ? avviso.rimedi : [])) {
      const li = document.createElement('li');
      li.className = 'sn-crediti-rimedio';
      disegna(li, r, opz, esito && esito.id === r.id ? esito.frase : '');
      ul.appendChild(li);
    }
    return ul;
  }

  function disegna(li, r, opz, esito) {
    li.textContent = '';
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
    li.appendChild(corpo);
    if (!r.azione || !r.etichetta) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `sn-crediti-rimedio-btn ${opz.classeBottone || ''}`.trim();
    btn.textContent = r.etichetta;
    btn.addEventListener('click', () => { premi(li, r, opz, btn).catch(() => {}); });
    li.appendChild(btn);
  }

  async function premi(li, r, opz, btn) {
    if (btn.disabled) return;
    if (r.azione === 'chiave') {
      if (opz.apriChiave) opz.apriChiave();
      return;
    }
    const tipo = r.azione === 'annulla' ? MSG().CREDITS_REMEDY_UNDO : MSG().CREDITS_REMEDY_APPLY;
    btn.disabled = true;
    let res = null;
    try { res = await opz.invia({ type: tipo, id: r.id }); } catch (_) { res = null; }
    if (!res || res.ok === false) {
      btn.disabled = false;
      const frase = (res && res.frase) || 'Non ci sono riuscito: riprova.';
      if (opz.onEsito) opz.onEsito(r.id, frase);
      disegna(li, r, opz, frase);
      return;
    }
    const nuovo = res.avviso && Array.isArray(res.avviso.rimedi) ? res.avviso.rimedi.find((x) => x.id === r.id) : null;
    if (opz.onEsito) opz.onEsito(r.id, res.frase || '');
    // Rimesso com'era e la proposta non c'è più (le soglie non dicono più niente): resta solo l'esito.
    disegna(li, nuovo || { id: r.id, testo: '', applicato: false }, opz, res.frase || '');
  }

  global.SN_CREDITI_AVVISO_UI = { elenco };
})(typeof globalThis !== 'undefined' ? globalThis : this);
