// Il fumetto dei pulsanti della barra: il main manda {text, dark, giro} (tooltip-preload.js), la misura torna col suo giro.
// Disegna soltanto: dove e quando lo decide src/main/popup-tooltip.js.

(() => {
  const tip = document.getElementById('tip');
  window.fumetto.onTesto(({ text, dark, giro }) => {
    document.documentElement.classList.toggle('dark', !!dark);
    tip.textContent = text || '';
    // Misura sincrona: a finestra nascosta Electron sospende il rAF, e dopo il primo hide il fumetto restava bloccato.
    const r = tip.getBoundingClientRect();
    window.fumetto.misura({ w: Math.ceil(r.width), h: Math.ceil(r.height), giro });
  });
})();
