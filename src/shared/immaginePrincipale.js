// L'immagine di una pagina quando nessuno ne indica una: la stessa per l'Aiuto e per la chat della home (#2371).
// `scegli` resta autosufficiente: il main la manda alla pagina come testo (src/main/services/immagineDaCercare.js).

(function (global) {
  'use strict';

  // La più grande per area, anche fuori vista, fra quelle oltre i 32 pixel per lato: la foto della pagina, non un'icona.
  function scegli(immagini) {
    let best = null;
    let bestArea = 0;
    for (const im of immagini || []) {
      const r = im.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea && r.width > 32 && r.height > 32) { best = im; bestArea = area; }
    }
    return best;
  }

  global.SN_IMMAGINE_PRINCIPALE = { scegli };
})(typeof globalThis !== 'undefined' ? globalThis : self);
