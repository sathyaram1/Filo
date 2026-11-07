// Velocità e tempo che resta di uno scaricamento (#1287): il main misura, le superfici (pannello, pagina Download,
// carte della home) scrivono le stesse parole. Logica pura, niente DOM. Regole: tests/unit/scaricamentiAvanzamento.test.mjs.

(function (global) {
  'use strict';

  // Abbastanza per non ballare a ogni pacchetto, poco per seguire una rete che cambia.
  const FINESTRA_MS = 4000;
  // Sotto questo intervallo il conto è rumore: meglio niente che «900 MB/s» al primo pacchetto.
  const MINIMO_MS = 700;

  // `campioni` [{ t, b }] cresce in coda; tiene almeno due punti e niente più vecchio della finestra.
  function campiona(campioni, t, b) {
    const c = Array.isArray(campioni) ? campioni : [];
    const ora = Number(t) || 0;
    const byte = Math.max(0, Number(b) || 0);
    const ultimo = c[c.length - 1];
    // Una ripresa da capo (byte che tornano indietro) non è una velocità negativa: si ricomincia.
    if (ultimo && byte < ultimo.b) c.length = 0;
    c.push({ t: ora, b: byte });
    while (c.length > 2 && ora - c[1].t >= FINESTRA_MS) c.shift();
    return c;
  }

  // Byte al secondo; 0 se non si sa ancora.
  function velocita(campioni, ora) {
    const c = Array.isArray(campioni) ? campioni : [];
    if (c.length < 2) return 0;
    const a = c[0];
    const z = c[c.length - 1];
    const fine = Math.max(Number(ora) || 0, z.t);
    const dt = fine - a.t;
    if (dt < MINIMO_MS) return 0;
    return Math.max(0, (z.b - a.b) / (dt / 1000));
  }

  // Secondi che restano, o null se il totale o la velocità non si sanno.
  function restano(ricevuti, totale, bps) {
    const tot = Number(totale) || 0;
    const v = Number(bps) || 0;
    if (tot <= 0 || v <= 0) return null;
    return Math.max(0, Math.ceil((tot - (Number(ricevuti) || 0)) / v));
  }

  // Lo stesso formato delle altre cifre delle righe (il punto dei decimali compreso), così la riga si legge di fila.
  function peso(n) {
    const x = Math.max(0, Number(n) || 0);
    if (x < 1024) return `${Math.round(x)} B`;
    if (x < 1024 * 1024) return `${(x / 1024).toFixed(0)} KB`;
    if (x < 1024 * 1024 * 1024) return `${(x / (1024 * 1024)).toFixed(1)} MB`;
    return `${(x / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function testoVelocita(bps) {
    const v = Number(bps) || 0;
    return v > 0 ? `${peso(v)}/s` : '';
  }

  function testoResto(sec) {
    if (sec == null || !Number.isFinite(Number(sec))) return '';
    const s = Math.max(0, Math.round(Number(sec)));
    if (s < 60) return `ancora ${Math.max(1, s)} s`;
    if (s < 3600) return `ancora ${Math.ceil(s / 60)} min`;
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    if (h >= 48) return `ancora ${Math.round(s / 86400)} giorni`;
    return m ? `ancora ${h} h ${m} min` : `ancora ${h} h`;
  }

  // «1.2 MB/s · ancora 12 s» per una voce pubblica; '' se non sta scendendo o non si sa ancora.
  function velocitaEResto(r) {
    if (!r || r.state !== 'progressing') return '';
    const v = testoVelocita(r.velocita);
    if (!v) return '';
    const t = testoResto(r.restano);
    return t ? `${v} · ${t}` : v;
  }

  global.SN_SCARICAMENTI_AVANZAMENTO = {
    FINESTRA_MS, campiona, velocita, restano, peso, testoVelocita, testoResto, velocitaEResto,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
