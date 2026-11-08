// Il fumetto dei pulsanti della barra: il main manda {text, colori, giro} (tooltip-preload.js), la misura torna col suo giro.
// Disegna soltanto: dove, quando e di che colore lo decide src/main/popup-tooltip.js.

(() => {
  const tip = document.getElementById('tip');
  const VARIABILI = new Set(['--bg', '--fg', '--border', '--sn-shadow-opacity']);
  window.fumetto.onTesto(({ text, colori, giro }) => {
    for (const [k, v] of Object.entries(colori || {})) {
      if (VARIABILI.has(k) && typeof v === 'string') document.documentElement.style.setProperty(k, v);
    }
    tip.textContent = text || '';
    // Misura sincrona: a finestra nascosta Electron sospende il rAF, e dopo il primo hide il fumetto restava bloccato.
    const r = tip.getBoundingClientRect();
    window.fumetto.misura({ w: Math.ceil(r.width), h: Math.ceil(r.height), giro });
  });
})();
