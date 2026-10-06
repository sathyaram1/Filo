// Cronologia appunti: le poche regole che devono valere UGUALI da tutte le
// parti da cui la si guarda (la freccia "Incolla" del tasto destro, la pagina
// Impostazioni → Sicurezza) e dalla parte che la tiene su disco.
//
// Nasce da #256: le due strade avevano ognuna la sua copia di "come si
// riconosce una voce" e di "cosa chiede la conferma prima di svuotare", e due
// copie della stessa regola divergono senza che nessuno se ne accorga.
//
// Convenzione IIFE dei moduli condivisi: si auto-registra su globalThis.
// Le stringhe le chiede a SN_I18N al momento dell'uso, non al caricamento,
// così l'ordine di caricamento non conta.

(function (global) {
  'use strict';

  function t(key) {
    const I18n = global.SN_I18N;
    return I18n && typeof I18n.t === 'function' ? I18n.t(key) : key;
  }

  // Chiave di una voce. È il criterio con cui il processo principale decide se
  // due copie sono "la stessa cosa" (per non duplicarle) e quale voce togliere:
  // testo con gli spazi compattati, immagini per il dato dell'immagine.
  function chiave(entry) {
    if (!entry) return '';
    if (entry.type === 'image') return 'i:' + (entry.dataUrl || '');
    if (entry.type === 'text') return 't:' + normalizza(entry.text);
    return '';
  }

  function normalizza(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }

  // Come si legge una voce in una lista. Una selezione di soli spazi (o di a
  // capo, o di tabulazioni) si copia per sbaglio più spesso di quanto sembri, e
  // disegnata così com'è diventa una riga vuota: diciamo cosa contiene e quanto
  // è lunga, invece di lasciare una riga muta.
  function etichetta(entry) {
    if (!entry) return '';
    if (entry.type === 'image') return entry.description || t('security_clipboard_image');
    const testo = normalizza(entry.text);
    if (testo) return testo;
    const n = (entry.text || '').length;
    return n
      ? t('clipboard_only_spaces').replace('%d', String(n))
      : t('clipboard_empty_entry');
  }

  // Testo della conferma prima di svuotare. Dice QUANTE voci spariscono, e se
  // una ricerca ne sta nascondendo una parte lo dichiara: con un filtro attivo
  // la lista sotto gli occhi ne mostra una e lo svuotamento le porta via tutte,
  // e le due cose si contraddicono in silenzio (#256).
  //
  // `visibili` va passato SOLO quando una ricerca è davvero in corso: null (o
  // qualsiasi cosa che non sia un numero) significa "nessun filtro", e allora
  // della ricerca non si parla. La distinzione serve perché senza di essa
  // bastava un numero mancante per far uscire la frase a campo di ricerca
  // vuoto — «La ricerca che hai scritto ne mostra 0: spariscono anche le
  // altre», detto a chi non aveva scritto niente, e con una voce sola in
  // contraddizione con sé stessa («sparisce l'unica voce… spariscono anche le
  // altre»). Attenzione: `Number(null)` è 0, non NaN, quindi il caso "nessun
  // filtro" va riconosciuto PRIMA della conversione.
  function testoConferma(totale, visibili) {
    const n = Number(totale) || 0;
    let testo = n === 1
      ? t('menu_paste_clear_confirm_one')
      : t('menu_paste_clear_confirm_n').replace('%d', String(n));
    const v = (visibili === null || visibili === undefined || visibili === '')
      ? NaN
      : Number(visibili);
    if (Number.isFinite(v) && v >= 0 && v < n) {
      testo += ' ' + t('menu_paste_clear_confirm_hidden').replace('%d', String(v));
    }
    return testo;
  }

  global.SN_CLIPBOARD = { chiave, normalizza, etichetta, testoConferma };
})(typeof globalThis !== 'undefined' ? globalThis : this);
