import { test, expect } from './fixtures/electron.mjs';
import zlib from 'node:zlib';

// Feedback: su tutti i siti il colore della selezione del testo deve essere
// quello base di Filo (arancione/terracotta), non il blu di sistema/sito.
//
// Causa: alcuni siti (es. repubblica) impongono una propria regola ::selection
// blu, con specificità alta o !important, che batte quella iniettata dal tema
// Filo. La selezione esce quindi blu invece che arancione.
//
// Fix: il colore Filo viene iniettato via webContents.insertCSS con
// cssOrigin 'user' + !important. Nel cascade CSS le dichiarazioni !important di
// origine "user" battono qualsiasi regola d'autore della pagina, quindi
// l'arancione Filo vince ovunque.
//
// Verifica robusta: getComputedStyle NON espone le regole ::selection d'autore,
// quindi non è affidabile. Qui selezioniamo del testo nero su sfondo bianco in
// una pagina che impone un ::selection blu !important, catturiamo uno
// screenshot reale e ispezioniamo i pixel della banda di selezione: devono
// essere "caldi" (terracotta: R nettamente > B), non blu.

// Decoder PNG minimale (8-bit, colorType 2/6) — niente dipendenze esterne.
function decodePng(buf) {
  let pos = 8; // salta la firma PNG
  let width = 0, height = 0, colorType = 2;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : colorType === 0 ? 1 : colorType === 4 ? 2 : 3;
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    for (let i = 0; i < stride; i++) {
      const x = raw[rp++];
      const a = i >= channels ? out[y * stride + i - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = i >= channels && y > 0 ? out[(y - 1) * stride + i - channels] : 0;
      let v;
      switch (filter) {
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: v = x;
      }
      out[y * stride + i] = v & 0xff;
    }
  }
  return {
    width, height,
    at(px, py) { const o = py * stride + px * channels; return [out[o], out[o + 1], out[o + 2]]; },
  };
}

test('text selection uses Filo terracotta on sites whose CSP blocks filo styles', async ({ openTab }) => {
  // Server con un header CSP che vieta gli stylesheet filo:// (come i siti veri).
  const html = `<!doctype html><html><head><title>csp page</title></head>
    <body style="background:#fff;margin:0">
    <p id="t" style="font-size:40px;padding:40px 40px 40px 50px;color:#000;margin:0">SELEZIONAMI ORA</p>
    </body></html>`;
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'self' 'unsafe-inline'",
    });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    const page = await openTab(`http://127.0.0.1:${port}/`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(600);

    // Pre-condizione: la CSP ha davvero bloccato lo stylesheet filo://, quindi
    // il colore NON può arrivare da theme.css. Se questo è false il test non
    // sta esercitando lo scenario giusto.
    const themeBlocked = await page.evaluate(() => {
      const l = [...document.querySelectorAll('link[rel=stylesheet]')]
        .find((x) => /filo:\/\/style\/theme\.css/.test(x.href));
      return !!l && l.sheet == null;
    });
    expect(themeBlocked, 'la CSP deve bloccare theme.css per esercitare il fix').toBe(true);

    await page.evaluate(() => {
      const el = document.getElementById('t');
      const r = document.createRange();
      r.selectNodeContents(el);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    });
    await page.waitForTimeout(300);

    const img = decodePng(await page.screenshot());

    let warm = 0, blue = 0;
    for (let y = 85; y < 120; y++) {
      for (let x = 55; x < 380; x++) {
        const [r, g, b] = img.at(x, y);
        if (r > 245 && g > 245 && b > 245) continue; // sfondo bianco
        if (r < 70 && g < 70 && b < 70) continue;     // testo nero
        if (r - b >= 15) warm++;
        else if (b - r >= 15) blue++;
      }
    }

    expect(warm, 'pixel di selezione caldi (terracotta) attesi').toBeGreaterThan(50);
    expect(warm).toBeGreaterThan(blue * 5);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
});
