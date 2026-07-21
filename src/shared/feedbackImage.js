// Utility PURE per gli allegati immagine dei feedback (S1.2).
//
// PERCHÉ ESISTE
//   Gli allegati immagine dei feedback vengono cifrati come byte opachi
//   (application/octet-stream) su Storage: il MIME originale NON è conservato
//   (a differenza dei file non-immagine, che salvano `type`). Per mostrare
//   un'immagine decifrata in un <img> serve ricostruire il MIME. Lo si indovina
//   dai "magic byte" dell'header del file. Logica PURA → testabile senza rete.
//
// Usato dal main process (handler feedback_decrypt_image) dopo aver decifrato i
// byte con SN_FEEDBACK_CRYPTO.decryptBytes.

(function (global) {
  'use strict';

  // Indovina il MIME di un'immagine dai primi byte (firma del formato).
  // Ritorna un MIME image/* riconosciuto oppure 'image/png' come ripiego
  // (i data URL con MIME leggermente sbagliato vengono comunque quasi sempre
  // renderizzati dai browser via sniffing, ma diamo il tipo giusto quando lo
  // riconosciamo). `bytes` = Uint8Array (o array-like di byte).
  function sniffImageMime(bytes) {
    const b = bytes || [];
    const n = b.length || 0;
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (n >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      return 'image/png';
    }
    // JPEG: FF D8 FF
    if (n >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
      return 'image/jpeg';
    }
    // GIF: 47 49 46 38 ("GIF8")
    if (n >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
      return 'image/gif';
    }
    // WebP: "RIFF"...."WEBP"
    if (
      n >= 12 &&
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
    ) {
      return 'image/webp';
    }
    // BMP: 42 4D ("BM")
    if (n >= 2 && b[0] === 0x42 && b[1] === 0x4d) {
      return 'image/bmp';
    }
    // SVG (testo, comincia con '<' o BOM/whitespace poi '<'): raro per gli
    // screenshot, ma gestito per completezza. Cerca "<svg" o "<?xml" nei primi byte.
    if (n >= 5) {
      let i = 0;
      // salta eventuale BOM UTF-8 EF BB BF e whitespace iniziale
      if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
      while (i < n && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
      if (b[i] === 0x3c) return 'image/svg+xml'; // '<'
    }
    return 'image/png';
  }

  // Converte byte grezzi in un data URL mostrabile in un <img>. `bytes` =
  // Uint8Array. Usa Buffer in Node, btoa nel browser (portabile come il resto
  // dei moduli shared). Il MIME è indovinato con sniffImageMime salvo override.
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
