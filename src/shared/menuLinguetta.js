// Le voci del tasto destro sulla linguetta di una scheda (#2086, #2087) e i nomi dei permessi del sito: logica pura,
// la shell la chiama a ogni apertura del menu. Ordine e condizioni: tests/unit/menuLinguetta.test.mjs.

(function (global) {
  'use strict';

  // Le parti dei permessi come le scrive src/main/services/permessiPagine.js: icona del segno sulla linguetta, nome,
  // genere e numero per accordare «consentito» e «negato».
  const PARTI = Object.freeze({
    schermo: { icona: 'windowFrame', nome: 'Schermo', g: 'ms' },
    video: { icona: 'camera', nome: 'Fotocamera', g: 'fs' },
    audio: { icona: 'mic', nome: 'Microfono', g: 'ms' },
    posizione: { icona: 'location', nome: 'Posizione', g: 'fs' },
    notifiche: { icona: 'bell', nome: 'Notifiche', g: 'fp' },
    appunti: { icona: 'clipboard', nome: 'Appunti', g: 'mp' },
    schermi: { icona: 'windowFrame', nome: 'Schermi', g: 'mp' },
    presenza: { icona: 'user', nome: 'Presenza al computer', g: 'fs' },
    strumenti: { icona: 'readAloud', nome: 'Strumenti musicali', g: 'mp' },
    rete: { icona: 'wifi', nome: 'Rete locale', g: 'fs' },
    file: { icona: 'pencil', nome: 'Modifica dei file', g: 'fs' },
    scaricamenti: { icona: 'download', nome: 'Scaricamenti senza un tuo clic', g: 'mp' },
  });
  const FINE = { ms: 'o', fs: 'a', mp: 'i', fp: 'e' };

  // «consentito», «negate»…; una parte sconosciuta si dice al maschile singolare.
  function esito(parte, si) {
    const p = PARTI[parte];
    return (si ? 'consentit' : 'negat') + FINE[(p && p.g) || 'ms'];
  }

  // «Microfono: consentito». Una parte che Filo non conosce non ha riga: non saprebbe dirne il nome.
  function rigaPermesso(scelta) {
    const p = scelta && PARTI[scelta.parte];
    if (!p) return null;
    return {
      label: `${p.nome}: ${esito(scelta.parte, scelta.si === true)}`,
      icon: p.icona,
      hint: 'Togli',
      action: `tab-permesso-togli:${scelta.parte}`,
    };
  }

  const ORDINE_PARTI = Object.keys(PARTI);

  // Blocca/Sblocca, Duplica, Muta | paese | cookie, Resta connesso, permessi | Chiudi (decisione dell'owner, #2087).
  // `proxy`: lo stato del fornitore di rete; `permessi`: le scelte ricordate per il sito della scheda.
  function voci(t, { proxy = null, permessi = [] } = {}) {
    const tab = t || {};
    const gruppi = [];
    gruppi.push([
      tab.bloccata
        ? { label: 'Sblocca', icon: 'lockOpen', action: 'tab-sblocca' }
        : { label: 'Blocca', icon: 'lock', action: 'tab-blocca' },
      { label: 'Duplica', icon: 'duplicate', action: 'tab-duplicate' },
      tab.muted
        ? { label: 'Riattiva audio', icon: 'mute', action: 'tab-mute' }
        : { label: 'Muta', icon: 'sound', action: 'tab-mute' },
    ]);
    // Le voci del paese solo con un fornitore configurato: una voce che non può funzionare non compare.
    const paese = [];
    if (proxy && proxy.configured) {
      if (tab.proxy) {
        paese.push({ label: 'Cambia paese', icon: 'globe', action: 'tab-proxy-pick' });
        paese.push({ label: 'Torna in Italia', icon: 'globe', action: 'tab-proxy-clear' });
      } else {
        paese.push({ label: 'Apri da un altro paese', icon: 'globe', action: 'tab-proxy-default', subAction: 'tab-proxy-pick' });
      }
    }
    gruppi.push(paese);
    // #754 — cosa ha fatto Filo col banner dei cookie di questo sito, e la strada per rivederlo.
    const sito = [];
    const ck = tab.cookies;
    if (ck && ck.shown) {
      sito.push({ label: 'Rifiuta i cookie in automatico qui', icon: 'cookie', action: 'tab-cookies-auto' });
    } else if (ck && (ck.rejected || ck.hidden)) {
      if (ck.rejected) sito.push({ label: 'Cookie non necessari rifiutati', icon: 'cookie', disabled: true });
      if (ck.hidden) sito.push({ label: 'Banner dei cookie nascosto', icon: 'cookie', disabled: true });
      sito.push({ label: 'Mostra il banner dei cookie', icon: 'eye', action: 'tab-cookies-show' });
    }
    // #759 — con la privacy massima l'accesso al sito si perde alla chiusura, se non resta connesso.
    if (tab.connesso) {
      sito.push(tab.connesso.fidato
        ? { label: 'Non restare connesso', icon: 'key', action: 'tab-connesso-no' }
        : { label: 'Resta connesso qui', icon: 'key', action: 'tab-connesso-si' });
    }
    const scelte = (Array.isArray(permessi) ? permessi : [])
      .filter((s) => s && typeof s.parte === 'string')
      .sort((a, b) => ORDINE_PARTI.indexOf(a.parte) - ORDINE_PARTI.indexOf(b.parte));
    for (const s of scelte) {
      const r = rigaPermesso(s);
      if (r) sito.push(r);
    }
    gruppi.push(sito);
    gruppi.push([tab.bloccata
      ? { label: 'Sblocca e chiudi', icon: 'close', action: 'tab-close-sblocca' }
      : { label: 'Chiudi', icon: 'close', action: 'tab-close' }]);
    const out = [];
    for (const g of gruppi) {
      if (!g.length) continue;
      if (out.length) out.push({ type: 'separator' });
      out.push(...g);
    }
    return out;
  }

  global.SN_MENU_LINGUETTA = Object.freeze({ PARTI, esito, rigaPermesso, voci });
})(typeof globalThis !== 'undefined' ? globalThis : this);
