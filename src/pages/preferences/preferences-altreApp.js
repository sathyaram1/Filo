// La riga del componente delle altre applicazioni sotto il suo interruttore (#779): a che punto è, con la barra vera mentre
// scarica, cosa manca e cosa si può fare. Non decide niente: accendere e spegnere li salva la pagina, il resto lo fa il main.
// Al caricamento registra e basta: il DOM lo tocca init().
(function (global) {
  'use strict';

  let MSG = null;
  let $ = null;
  let ultimo = null;

  const mb = (b) => (Number(b) / 1048576).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: true });
  const senzaNumeri = { verifica: 'Controllo l\'impronta del file scaricato…', estrae: 'Installo il componente…', prova: 'Controllo che il componente parta…' };

  function bottone(el, testo, visibile) {
    el.hidden = !visibile;
    if (testo) el.textContent = testo;
  }

  function disegnaPermessi(box, permessi) {
    box.textContent = '';
    for (const p of Array.isArray(permessi) ? permessi : []) {
      const riga = document.createElement('div');
      riga.className = 'aa-permesso';
      const t = document.createElement('span');
      t.textContent = p.frase || `Manca il permesso «${p.nome}».`;
      riga.appendChild(t);
      if (p.apribile) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sn-btn sn-btn-secondary';
        b.textContent = 'Apri le impostazioni del sistema';
        b.addEventListener('click', async () => {
          b.disabled = true;
          try { await chrome.runtime.sendMessage({ type: MSG.ALTRE_APP_PERMESSO, permesso: p.id }); } catch (_) {}
          b.disabled = false;
        });
        riga.appendChild(b);
      }
      box.appendChild(riga);
    }
  }

  function disegna(s) {
    if (!$ || !s) return;
    ultimo = s;
    const box = $('altreAppStato');
    const frase = $('altreAppFrase');
    const numeri = $('altreAppNumeri');
    const barra = $('altreAppBarra');
    const riempi = barra.firstElementChild;
    const acceso = $('altreAppEnabled').checked;
    // Da spenta non resta niente da mostrare: il componente si toglie con lei.
    box.hidden = !(acceso || s.attiva) || s.fase === 'assente';
    box.classList.toggle('aa-errore', s.fase === 'errore');
    numeri.textContent = '';
    barra.hidden = true;
    barra.classList.remove('aa-senza-numeri');
    barra.removeAttribute('aria-valuenow');
    disegnaPermessi($('altreAppPermessi'), s.fase === 'pronto' ? s.permessi : []);
    bottone($('altreAppAnnulla'), null, s.fase === 'scarica' || s.fase in senzaNumeri);
    bottone($('altreAppRiprova'), null, false);

    if (s.fase === 'scarica') {
      const tot = Number(s.totali) || 0;
      const fatti = Math.min(Number(s.ricevuti) || 0, tot || Infinity);
      const pc = tot ? Math.floor((fatti / tot) * 100) : 0;
      frase.textContent = 'Scarico il componente…';
      numeri.textContent = tot ? `${mb(fatti)} MB di ${mb(tot)} MB · ${pc}%` : `${mb(fatti)} MB`;
      barra.hidden = false;
      if (tot) { riempi.style.width = `${pc}%`; barra.setAttribute('aria-valuenow', String(pc)); }
      else barra.classList.add('aa-senza-numeri');
    } else if (s.fase in senzaNumeri) {
      frase.textContent = senzaNumeri[s.fase];
      barra.hidden = false;
      barra.classList.add('aa-senza-numeri');
      riempi.style.width = '';
    } else if (s.fase === 'pronto') {
      frase.textContent = s.permessi && s.permessi.length ? 'Il componente è installato, ma il sistema non gli dà ancora tutto quello che serve:' : 'Il componente è installato e pronto.';
      numeri.textContent = `Cua Driver ${s.versione}${s.byte ? ` · ${mb(s.byte)} MB` : ''}`;
    } else if (s.fase === 'errore') {
      const e = s.errore || {};
      frase.textContent = e.frase || 'L\'installazione del componente non è riuscita.';
      if (e.codice === 'non-parte') bottone($('altreAppRiprova'), 'Reinstalla', true);
      else if (e.codice !== 'non-supportato') bottone($('altreAppRiprova'), 'Riprova', true);
    }
  }

  async function carica() {
    let r = null;
    try { r = await chrome.runtime.sendMessage({ type: MSG.ALTRE_APP_STATO }); } catch (_) { r = null; }
    if (r && r.ok && r.stato) disegna(r.stato);
  }

  function init(deps) {
    MSG = deps.MSG;
    $ = deps.$;
    if (!$('altreAppStato')) return;
    $('altreAppAnnulla').addEventListener('click', () => {
      const t = $('altreAppEnabled');
      if (!t.checked) return;
      t.checked = false;
      t.dispatchEvent(new Event('change'));
    });
    $('altreAppRiprova').addEventListener('click', async () => {
      const b = $('altreAppRiprova');
      b.disabled = true;
      let r = null;
      try { r = await chrome.runtime.sendMessage({ type: MSG.ALTRE_APP_REINSTALLA }); } catch (_) { r = null; }
      b.disabled = false;
      if (r && r.ok && r.stato) disegna(r.stato);
    });
    // Accesa qui, la barra deve comparire subito, prima che il main risponda col primo pezzo scaricato.
    $('altreAppEnabled').addEventListener('change', () => {
      if ($('altreAppEnabled').checked) disegna({ ...(ultimo || {}), attiva: true, fase: 'scarica', ricevuti: 0, totali: 0 });
      else disegna({ ...(ultimo || {}), attiva: false, fase: 'assente' });
    });
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === MSG.ALTRE_APP_CAMBIATO && msg.stato) disegna(msg.stato);
      });
    } catch (_) {}
    document.addEventListener('visibilitychange', () => { if (!document.hidden) carica(); });
    carica();
  }

  global.SN_PREF_ALTRE_APP = { init, disegna };
})(globalThis);
