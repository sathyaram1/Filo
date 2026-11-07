// I gesti contati dove succedono (#1471): il segno di chi trascina, la classe di quello che arriva, il nome letto su
// un'icona prima di sceglierla. Escono solo nomi, mai quello che si trascina; il main rifiuta ciò che non è nei suoi
// elenchi chiusi. Elenchi e forma di quello che parte: src/shared/contatoriGiornalieri.js.

(function (global) {
  'use strict';

  // Il tipo con cui un trascinamento di Filo dice da dove parte: porta il nome dell'origine, niente del contenuto.
  const TIPO_ORIGINE = 'application/x-filo-origine';
  // Il nome comparso su un'icona, e un clic entro questo tempo: la scelta l'ha fatta leggendolo.
  const CLIC_DOPO_IL_NOME_MS = 3000;

  function marca(dt, origine) {
    try { if (dt && origine) dt.setData(TIPO_ORIGINE, String(origine)); } catch (_) {}
  }

  function tipiDi(dt) {
    try { return Array.from((dt && dt.types) || []); } catch (_) { return []; }
  }

  // Da dove viene quello che arriva: il segno di Filo, o la classe del tipo (un file dal disco, un'immagine o un testo
  // presi da una pagina). Il contenuto si guarda solo qui, per la classe, e non esce.
  function origineDi(dt) {
    const tipi = tipiDi(dt);
    if (!tipi.length) return '';
    if (tipi.includes(TIPO_ORIGINE)) {
      try { return String(dt.getData(TIPO_ORIGINE) || ''); } catch (_) { return ''; }
    }
    const daPagina = tipi.includes('text/html') || tipi.includes('text/uri-list');
    if (tipi.includes('Files')) return daPagina ? 'immagine' : 'file_disco';
    let html = '';
    try { html = tipi.includes('text/html') ? String(dt.getData('text/html') || '') : ''; } catch (_) { html = ''; }
    if (/^\s*(<meta[^>]*>\s*)?<img\b/i.test(html)) return 'immagine';
    return daPagina || tipi.includes('text/plain') ? 'testo_pagina' : '';
  }

  function trascinamento(da, a, esito) {
    return { misura: 'gesto', gesto: 'trascinamento', da: String(da || ''), a: String(a || ''), esito };
  }

  // Al rilascio su una destinazione: `usato` dice se quello che è arrivato è servito a qualcosa.
  function rilascio(dt, a, usato = true) { return trascinamento(origineDi(dt), a, usato ? 'posato' : 'annullato'); }

  // A fine trascinamento, nella pagina da cui parte: nessuno l'ha preso. Un rilascio preso lo conta chi lo prende.
  function fine(e, da) {
    const dt = e && e.dataTransfer;
    let effetto = '';
    try { effetto = String((dt && dt.dropEffect) || ''); } catch (_) { effetto = ''; }
    return effetto === 'none' ? trascinamento(da, 'nessuna', 'annullato') : null;
  }

  // Una lettura si chiude una volta: col clic sulla stessa icona (entro il tempo «clic», dopo «via»), o lasciandola.
  function lettore(manda, adesso = () => Date.now()) {
    let aperta = null;
    const chiudi = (esito) => {
      const l = aperta;
      aperta = null;
      if (l) { try { manda({ misura: 'gesto', gesto: 'suggerimento_letto', icona: l.icona, dove: l.dove, esito }); } catch (_) {} }
    };
    return {
      mostrato(icona, dove) {
        chiudi('via');
        if (icona) aperta = { icona: String(icona), dove: String(dove || ''), t: adesso() };
      },
      clic(icona) {
        if (aperta && aperta.icona === String(icona)) chiudi(adesso() - aperta.t <= CLIC_DOPO_IL_NOME_MS ? 'clic' : 'via');
      },
      via() { chiudi('via'); },
    };
  }

  global.SN_GESTI = { TIPO_ORIGINE, CLIC_DOPO_IL_NOME_MS, marca, origineDi, trascinamento, rilascio, fine, lettore };
})(typeof globalThis !== 'undefined' ? globalThis : self);
