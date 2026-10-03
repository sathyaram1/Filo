// Quanto resta a schermo un avviso a scomparsa e quando aspetta: una regola sola per ogni pila
// nell'angolo (barra, pagine, editor, mazzi, Gestione). Non disegna niente.
// Sentinella: tests/unit/avvisiTempo.test.mjs.

(function (global) {
  'use strict';
  // Sulle pagine filo:// il preload e la pagina condividono il mondo: ricaricato, azzererebbe la preferenza.
  if (global.SN_AVVISI) return;

  // La durata delle Preferenze è quella dell'avviso standard: chi chiede di più o di meno per il suo
  // testo (una conferma breve, un avviso con un pulsante) resta in proporzione, così una preferenza sola
  // allunga o accorcia tutto senza cambiare niente a chi non la tocca. Uguale al default di
  // DEFAULT_SETTINGS.notifications.durationSec.
  const STANDARD_SEC = 5;
  // Uscito il puntatore, a chi era agli sgoccioli restano almeno questi ms per finire di leggere.
  const RIPRESA_MS = 2000;

  let preferenzaSec = STANDARD_SEC;

  function secondi(v) {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : STANDARD_SEC;
  }

  function imposta(notifications) {
    if (notifications && typeof notifications === 'object') preferenzaSec = secondi(notifications.durationSec);
  }

  // `ms` è il tempo che chi mostra l'avviso sceglie con la durata standard. 0 = resta finché qualcuno
  // non lo chiude: lo chiede chi lo mostra (un lavoro in corso) o l'utente con la durata a 0.
  function durata(ms, sec) {
    if (ms === 0) return 0;
    const base = Number(ms) > 0 ? Number(ms) : STANDARD_SEC * 1000;
    const p = sec === undefined ? preferenzaSec : secondi(sec);
    if (p === 0) return 0;
    return Math.max(1, Math.round(base * p / STANDARD_SEC));
  }

  // I tempi di una pila aspettano tutti insieme finché il puntatore sta su uno dei suoi avvisi: uno
  // che sparisse farebbe scivolare gli altri sotto il cursore.
  function orologio() {
    let fermo = false;
    const conti = new Set();
    const sotto = new Set();

    function parti(c) {
      c.scade = Date.now() + c.restano;
      c.timer = setTimeout(() => {
        c.timer = null;
        conti.delete(c);
        try { c.fn(); } catch (_) {}
      }, c.restano);
    }

    function ferma(on) {
      on = !!on;
      if (on === fermo) return;
      fermo = on;
      for (const c of conti) {
        if (on) {
          if (!c.timer) continue;
          clearTimeout(c.timer);
          c.timer = null;
          c.restano = Math.max(0, c.scade - Date.now());
        } else if (!c.timer) {
          c.restano = Math.max(c.restano, RIPRESA_MS);
          parti(c);
        }
      }
    }

    function avvia(ms, fn) {
      if (!(Number(ms) > 0) || typeof fn !== 'function') return { annulla() {} };
      const c = { restano: Number(ms), scade: 0, timer: null, fn };
      conti.add(c);
      if (!fermo) parti(c);
      return {
        annulla() {
          if (c.timer) clearTimeout(c.timer);
          c.timer = null;
          conti.delete(c);
        },
      };
    }

    // Per le pile disegnate nella stessa pagina: l'avviso dice da sé quando il puntatore entra ed esce.
    // Solo gesti veri: in una pagina web lo script del sito non deve poter tenere fermo un avviso.
    function segui(el) {
      if (!el || el.__snOrologio) return el;
      el.__snOrologio = true;
      el.addEventListener('mouseenter', (e) => {
        if (!e.isTrusted) return;
        sotto.add(el);
        ferma(true);
      });
      el.addEventListener('mouseleave', (e) => { if (e.isTrusted) lascia(el); });
      return el;
    }

    // Va chiamata anche quando l'avviso esce dal documento: sparendo sotto il cursore non manda mouseleave.
    function lascia(el) {
      sotto.delete(el);
      ripulisci();
    }

    // Un avviso portato via insieme al suo contenitore (una pagina che rifà il DOM) non è più sotto niente.
    function ripulisci() {
      for (const x of sotto) if (x.isConnected === false) sotto.delete(x);
      if (!sotto.size) ferma(false);
    }

    return { avvia, ferma, segui, lascia, ripulisci, fermo: () => fermo };
  }

  global.SN_AVVISI = { STANDARD_SEC, RIPRESA_MS, imposta, durata, orologio };
})(typeof globalThis !== 'undefined' ? globalThis : self);
