// Utility pure per gli allegati immagine dei feedback.
// Le immagini sono cifrate come byte opachi e il MIME originale NON è conservato,
// quindi per mostrarle in un <img> va indovinato dai magic byte.

(function (global) {
  'use strict';

  // Ripiego 'image/png' quando la firma non si riconosce: i browser fanno sniffing comunque,
  // ma dove sappiamo diamo il tipo giusto.
  function sniffImageMime(bytes) {
    const b = bytes || [];
    const n = b.length || 0;
    if (n >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      return 'image/png';
    }
    if (n >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
      return 'image/jpeg';
    }
    if (n >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
      return 'image/gif';
    }
    if (
      n >= 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
    ) {
      return 'image/webp';
    }
    if (n >= 2 && b[0] === 0x42 && b[1] === 0x4d) {
      return 'image/bmp';
    }
    // SVG (testo): raro per gli screenshot, ma gestito per completezza.
    if (n >= 5) {
      let i = 0;
      if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
      while (i < n && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
      if (b[i] === 0x3c) return 'image/svg+xml';
    }
    return 'image/png';
  }

  // Buffer in Node, btoa nel browser: portabile come il resto dei moduli shared.
  function bytesToDataUrl(bytes, mimeOverride) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const mime = mimeOverride || sniffImageMime(arr);
    let b64;
    if (typeof Buffer !== 'undefined') {
      b64 = Buffer.from(arr).toString('base64');
    } else {
      let bin = '';
      for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
      b64 = btoa(bin);
    }
    return `data:${mime};base64,${b64}`;
  }

  global.SN_FEEDBACK_IMAGE = { sniffImageMime, bytesToDataUrl };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.SN_FEEDBACK_IMAGE;
}
