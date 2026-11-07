// Per test:shoot (#1434): una pagina con un campo che si scrive, un paragrafo, un'immagine e un collegamento, servita su
// http://127.0.0.1:47812/; `seleziona('ricco')` o `seleziona('testo')` seleziona una parola. Uso:
// main-file:tests/agent/scenari/fila-contestuale.js; tab:http://127.0.0.1:47812/; eval-view:seleziona('ricco'); rclick-view:#ricco b; shot:fila-scrivibile
const http = process.mainModule.require('node:http');
// Un'immagine vera, coi suoi byte: un quadrato caldo con una banda chiara.
const zlib = process.mainModule.require('node:zlib');
const png = (() => {
  const w = 160, h = 110;
  const righe = [];
  for (let y = 0; y < h; y++) {
    const r = [0];
    for (let x = 0; x < w; x++) r.push(...(y > 40 && y < 70 ? [250, 214, 160] : [196, 90, 59]));
    righe.push(Buffer.from(r));
  }
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
  const pezzo = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pezzo('IHDR', ihdr), pezzo('IDAT', zlib.deflateSync(Buffer.concat(righe))), pezzo('IEND', Buffer.alloc(0))]);
})();
const pagina = `<!doctype html><meta charset="utf-8"><title>Fila del tasto destro</title>
<body style="margin:0;padding:32px;font:17px sans-serif;background:#faf7f2;color:#2b2622">
<div id="ricco" contenteditable="true" style="width:560px;min-height:90px;padding:12px;border:1px solid #d8cfc4;border-radius:8px">Un appunto da <b>scrivere</b> con calma, e da rileggere domani.</div>
<p id="testo" style="width:560px">Un paragrafo di una pagina qualunque, con una parola da tradurre.</p>
<img id="foto" src="/foto.png" width="160" height="110" alt="foto">
<p><a id="vai" href="https://esempio.it/pagina">un collegamento</a></p>
<script>
window.seleziona = (id) => {
  const el = document.getElementById(id);
  const t = el.querySelector('b') ? el.querySelector('b').firstChild : el.firstChild;
  const r = document.createRange();
  r.selectNodeContents(t);
  getSelection().removeAllRanges();
  getSelection().addRange(r);
  if (el.isContentEditable) el.focus();
  return String(getSelection());
};
</script>
</body>`;
if (!globalThis.__paginaFila) {
  globalThis.__paginaFila = http.createServer((q, r) => {
    if (q.url.startsWith('/foto.png')) { r.writeHead(200, { 'content-type': 'image/png' }); r.end(png); return; }
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    r.end(pagina);
  });
  await new Promise((ok) => globalThis.__paginaFila.listen(47812, '127.0.0.1', ok));
}
return 'pronto';
