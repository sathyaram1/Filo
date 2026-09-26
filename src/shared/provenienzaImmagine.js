// Cosa DICHIARA un'immagine sulla propria origine, letta dai suoi soli byte.
// Non guarda mai i pixel e non stima niente: nessuna etichetta = nessuna riga.
// Perché il silenzio e i «non so» sono obbligatori: patterns/unetichetta-di-origine-e-una-dichiarazione-non-una-prova.md

(function (global) {
  'use strict';

  // Node c'è nel main e negli unit test, non nelle pagine: senza, la firma
  // resta «non verificabile» e non diventa mai «valida».
  function nodeMod(nome) {
    try { return (typeof require === 'function') ? require(nome) : null; } catch (_) { return null; }
  }

  // Chi Filo riconosce come dichiarante. `nomi` sono le forme con cui l'ente si
  // firma nel certificato o si nomina nei metadati; `radici` (impronta SHA-256
  // della chiave pubblica del certificato radice) è la prova forte, quando c'è.
  const ENTI = [
    { ente: 'OpenAI', nomi: ['openai'], radici: [] },
    { ente: 'Adobe', nomi: ['adobe'], radici: [] },
    { ente: 'Google', nomi: ['google', 'google llc', 'alphabet'], radici: [] },
    { ente: 'Microsoft', nomi: ['microsoft'], radici: [] },
    { ente: 'Meta', nomi: ['meta platforms', 'meta ai'], radici: [] },
    { ente: 'Amazon', nomi: ['amazon', 'aws'], radici: [] },
    { ente: 'Leica', nomi: ['leica'], radici: [] },
    { ente: 'Sony', nomi: ['sony'], radici: [] },
    { ente: 'Canon', nomi: ['canon'], radici: [] },
    { ente: 'Nikon', nomi: ['nikon'], radici: [] },
    { ente: 'Fujifilm', nomi: ['fujifilm', 'fuji photo'], radici: [] },
    { ente: 'Qualcomm', nomi: ['qualcomm'], radici: [] },
    { ente: 'Samsung', nomi: ['samsung'], radici: [] },
    { ente: 'Truepic', nomi: ['truepic'], radici: [] },
    { ente: 'Digimarc', nomi: ['digimarc'], radici: [] },
    { ente: 'Getty Images', nomi: ['getty images'], radici: [] },
    { ente: 'Shutterstock', nomi: ['shutterstock'], radici: [] },
    { ente: 'BBC', nomi: ['bbc', 'british broadcasting'], radici: [] },
    { ente: 'Nvidia', nomi: ['nvidia'], radici: [] },
    { ente: 'Stability AI', nomi: ['stability ai', 'stability.ai'], radici: [] },
    { ente: 'Black Forest Labs', nomi: ['black forest labs'], radici: [] },
    { ente: 'Midjourney', nomi: ['midjourney'], radici: [] },
  ];

  // I codici IPTC: sono URI, e la coda dopo l'ultima barra è il vocabolo.
  const SORGENTI = {
    trainedalgorithmicmedia: 'ai',
    compositewithtrainedalgorithmicmedia: 'ai-modificata',
    algorithmicallyenhanced: 'ai-modificata',
    digitalcapture: 'fotocamera',
    digitalcreation: null,
    algorithmicmedia: null,
    negativefilm: null,
    positivefilm: null,
    print: null,
    minorhumanedits: null,
    compositecapture: null,
    composite: null,
softwareImage: null,
  };

  // Chiavi di testo che i generatori scrivono nei PNG: la chiave da sola basta a
  // dire chi ha scritto, il valore serve solo a sapere che non è vuoto.
  const CHIAVI_PNG = [
    { chiave: 'parameters', ente: 'Stable Diffusion' },
    { chiave: 'workflow', ente: 'ComfyUI' },
    { chiave: 'prompt', ente: 'ComfyUI' },
    { chiave: 'sd-metadata', ente: 'InvokeAI' },
    { chiave: 'invokeai_metadata', ente: 'InvokeAI' },
    { chiave: 'invokeai_graph', ente: 'InvokeAI' },
    { chiave: 'dream', ente: 'InvokeAI' },
  ];

  // `Software`/`Comment` non dicono da soli che è AI: serve il nome del programma.
  const PROGRAMMI_AI = [
    { ago: 'novelai', ente: 'NovelAI' },
    { ago: 'stable diffusion', ente: 'Stable Diffusion' },
    { ago: 'stablediffusion', ente: 'Stable Diffusion' },
    { ago: 'automatic1111', ente: 'Stable Diffusion' },
    { ago: 'comfyui', ente: 'ComfyUI' },
    { ago: 'invokeai', ente: 'InvokeAI' },
    { ago: 'midjourney', ente: 'Midjourney' },
    { ago: 'dall-e', ente: 'OpenAI' },
    { ago: 'dalle', ente: 'OpenAI' },
    { ago: 'chatgpt', ente: 'OpenAI' },
    { ago: 'openai', ente: 'OpenAI' },
    { ago: 'imagen', ente: 'Google' },
    { ago: 'gemini', ente: 'Google' },
    { ago: 'firefly', ente: 'Adobe' },
    { ago: 'grok', ente: 'xAI' },
    { ago: 'flux', ente: 'Black Forest Labs' },
    { ago: 'leonardo.ai', ente: 'Leonardo.Ai' },
    { ago: 'ideogram', ente: 'Ideogram' },
    { ago: 'recraft', ente: 'Recraft' },
  ];

  // ───────────────────────────── byte e numeri ─────────────────────────────

  function u8(b) {
    if (!b) return new Uint8Array(0);
    if (b instanceof Uint8Array) return b;
    if (typeof ArrayBuffer !== 'undefined' && b instanceof ArrayBuffer) return new Uint8Array(b);
    if (b.buffer) return new Uint8Array(b.buffer, b.byteOffset || 0, b.byteLength);
    return new Uint8Array(b);
  }
  const be16 = (b, i) => (b[i] << 8) | b[i + 1];
  const be32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const le32 = (b, i) => ((b[i + 3] << 24) | (b[i + 2] << 16) | (b[i + 1] << 8) | b[i]) >>> 0;
  const fourcc = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

  function latin1(b, i, n) {
    let s = '';
    for (let k = i; k < i + n; k++) s += String.fromCharCode(b[k]);
    return s;
  }
  function utf8(b, i = 0, n = b.length - i) {
    const slice = b.subarray(i, i + n);
    if (typeof TextDecoder !== 'undefined') {
      try { return new TextDecoder('utf-8', { fatal: false }).decode(slice); } catch (_) {}
    }
    return latin1(slice, 0, slice.length);
  }

  // ───────────────────────────────── CBOR ──────────────────────────────────

  // Sottoinsieme che serve al C2PA: interi, byte, testo, liste, mappe, tag,
  // costanti e float. Rifiuta invece di indovinare: un CBOR storto non è un dato.
  function cborDecode(b, stato) {
    const s = stato || { i: 0 };
    const b0 = b[s.i++];
    if (b0 === undefined) throw new Error('cbor troncato');
    const mt = b0 >> 5;
    const ai = b0 & 0x1f;
    let len = 0;
    let indef = false;
    if (ai < 24) len = ai;
    else if (ai === 24) len = b[s.i++];
    else if (ai === 25) { len = be16(b, s.i); s.i += 2; }
    else if (ai === 26) { len = be32(b, s.i); s.i += 4; }
    else if (ai === 27) {
      const hi = be32(b, s.i); const lo = be32(b, s.i + 4); s.i += 8;
      len = hi * 4294967296 + lo;
    } else if (ai === 31) indef = true;
    else throw new Error('cbor: lunghezza non valida');

    if (mt === 0) return len;
    if (mt === 1) return -1 - len;
    if (mt === 2 || mt === 3) {
      if (indef) {
        const pezzi = [];
        for (;;) {
          if (b[s.i] === 0xff) { s.i++; break; }
          const p = cborDecode(b, s);
          pezzi.push(mt === 2 ? u8(p) : p);
        }
        if (mt === 3) return pezzi.join('');
        let tot = 0; for (const p of pezzi) tot += p.length;
        const out = new Uint8Array(tot);
        let o = 0; for (const p of pezzi) { out.set(p, o); o += p.length; }
        return out;
      }
      if (s.i + len > b.length) throw new Error('cbor troncato');
      const raw = b.subarray(s.i, s.i + len);
      s.i += len;
      return mt === 2 ? raw : utf8(raw, 0, raw.length);
    }
    if (mt === 4) {
      const out = [];
      if (indef) { for (;;) { if (b[s.i] === 0xff) { s.i++; break; } out.push(cborDecode(b, s)); } return out; }
      for (let k = 0; k < len; k++) out.push(cborDecode(b, s));
      return out;
    }
    if (mt === 5) {
      // Chiavi scelte da chi manda il file: la mappa non eredita da Object.
      const out = Object.create(null);
      const metti = () => {
        const k = cborDecode(b, s);
        const v = cborDecode(b, s);
        out[typeof k === 'string' ? k : String(k)] = v;
      };
      if (indef) { for (;;) { if (b[s.i] === 0xff) { s.i++; break; } metti(); } return out; }
      for (let k = 0; k < len; k++) metti();
      return out;
    }
    if (mt === 6) return { __tag: len, valore: cborDecode(b, s) };
    if (mt === 7) {
      if (ai === 20) return false;
      if (ai === 21) return true;
      if (ai === 22) return null;
      if (ai === 23) return undefined;
      if (ai === 25 || ai === 26 || ai === 27) return 0;
      return len;
    }
    throw new Error('cbor: tipo sconosciuto');
  }

  function cborTesta(b) {
    try { return cborDecode(u8(b), { i: 0 }); } catch (_) { return null; }
  }

  // Encoder minimo: serve solo a ricostruire la Sig_structure da firmare.
  function cborLen(mt, n) {
    if (n < 24) return new Uint8Array([(mt << 5) | n]);
    if (n < 256) return new Uint8Array([(mt << 5) | 24, n]);
    if (n < 65536) return new Uint8Array([(mt << 5) | 25, n >> 8, n & 255]);
    return new Uint8Array([(mt << 5) | 26, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  }
  function cborBstr(bytes) { return concat([cborLen(2, bytes.length), bytes]); }
  function cborTstr(s) {
    const bytes = (typeof TextEncoder !== 'undefined') ? new TextEncoder().encode(s) : u8(Array.from(s, (c) => c.charCodeAt(0)));
    return concat([cborLen(3, bytes.length), bytes]);
  }
  function concat(parti) {
    let tot = 0; for (const p of parti) tot += p.length;
    const out = new Uint8Array(tot);
    let o = 0; for (const p of parti) { out.set(p, o); o += p.length; }
    return out;
  }

  // ───────────────────────────────── JUMBF ─────────────────────────────────

  // Un box: { tipo, etichetta, dati, figli, raw }. `raw` è il box intero con la
  // sua intestazione, perché è su quello che il claim calcola le impronte.
  function jumbfBoxes(b, da, a) {
    const out = [];
    let i = da;
    while (i + 8 <= a) {
      let lbox = be32(b, i);
      const tipo = fourcc(b, i + 4);
      let testa = 8;
      if (lbox === 1) {
        if (i + 16 > a) break;
        const hi = be32(b, i + 8); const lo = be32(b, i + 12);
        lbox = hi * 4294967296 + lo;
        testa = 16;
      } else if (lbox === 0) {
        lbox = a - i;
      }
      if (lbox < testa || i + lbox > a) break;
      const box = { tipo, etichetta: '', dati: b.subarray(i + testa, i + lbox), raw: b.subarray(i, i + lbox), figli: [] };
      if (tipo === 'jumb') {
        box.figli = jumbfBoxes(b, i + testa, i + lbox);
        const jumd = box.figli.find((f) => f.tipo === 'jumd');
        if (jumd) box.etichetta = etichettaJumd(jumd.dati);
      }
      out.push(box);
      i += lbox;
    }
    return out;
  }

  function etichettaJumd(d) {
    if (d.length < 17) return '';
    const tog = d[16];
    if (!(tog & 0x02)) return '';
    let fine = 17;
    while (fine < d.length && d[fine] !== 0) fine++;
    return utf8(d, 17, fine - 17);
  }

  // Cerca in profondità il primo superbox con quell'etichetta.
  function perEtichetta(boxes, etichetta) {
    for (const b of boxes) {
      if (b.etichetta === etichetta) return b;
      if (b.figli.length) {
        const dentro = perEtichetta(b.figli, etichetta);
        if (dentro) return dentro;
      }
    }
    return null;
  }
  // Il contenuto vero di un superbox: il primo figlio che non è la descrizione.
  function contenuto(box) {
    if (!box) return null;
    const c = box.figli.find((f) => f.tipo !== 'jumd');
    return c ? c.dati : null;
  }

  // ─────────────────────────── contenitori immagine ────────────────────────

  function leggiContenitore(b) {
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return png(b);
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8) return jpeg(b);
    if (b.length >= 12 && fourcc(b, 0) === 'RIFF' && fourcc(b, 8) === 'WEBP') return webp(b);
    if (b.length >= 12 && fourcc(b, 4) === 'ftyp') return bmff(b);
    return { c2pa: null, xmp: [], testiPng: null, formato: '' };
  }

  function png(b) {
    const res = { c2pa: null, xmp: [], testiPng: Object.create(null), formato: 'png' };
    const zlib = nodeMod('node:zlib');
    let i = 8;
    while (i + 8 <= b.length) {
      const len = be32(b, i);
      const tipo = fourcc(b, i + 4);
      const da = i + 8;
      if (len > b.length || da + len > b.length) break;
      const dati = b.subarray(da, da + len);
      if (tipo === 'caBX' && !res.c2pa) res.c2pa = jumbfBoxes(dati, 0, dati.length);
      else if (tipo === 'tEXt' || tipo === 'zTXt' || tipo === 'iTXt') {
        const voce = testoPng(tipo, dati, zlib);
        if (voce) {
          if (/^XML:com\.adobe\.xmp$/i.test(voce.chiave)) res.xmp.push(voce.valore);
          else if (!(voce.chiave.toLowerCase() in res.testiPng)) res.testiPng[voce.chiave.toLowerCase()] = voce.valore;
        }
      }
      if (tipo === 'IEND') break;
      i = da + len + 4;
    }
    return res;
  }

  function testoPng(tipo, d, zlib) {
    let fine = 0;
    while (fine < d.length && d[fine] !== 0) fine++;
    if (fine >= d.length) return null;
    const chiave = latin1(d, 0, fine);
    let p = fine + 1;
    try {
      if (tipo === 'tEXt') return { chiave, valore: latin1(d, p, d.length - p) };
      if (tipo === 'zTXt') {
        p += 1;
        if (!zlib) return null;
        return { chiave, valore: utf8(u8(zlib.inflateSync(Buffer.from(d.subarray(p))))) };
      }
      const compresso = d[p]; p += 2;
      while (p < d.length && d[p] !== 0) p++; p++;
      while (p < d.length && d[p] !== 0) p++; p++;
      if (p > d.length) return null;
      const coda = d.subarray(p);
      if (!compresso) return { chiave, valore: utf8(coda) };
      if (!zlib) return null;
      return { chiave, valore: utf8(u8(zlib.inflateSync(Buffer.from(coda)))) };
    } catch (_) { return null; }
  }

  function jpeg(b) {
    const res = { c2pa: null, xmp: [], testiPng: null, formato: 'jpeg' };
    const pacchetti = new Map();
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (m === 0xd9 || m === 0xda) break;
      const len = be16(b, i + 2);
      if (len < 2 || i + 2 + len > b.length) break;
      const dati = b.subarray(i + 4, i + 2 + len);
      if (m === 0xe1 && dati.length > 29 && latin1(dati, 0, 28) === 'http://ns.adobe.com/xap/1.0/') {
        res.xmp.push(utf8(dati, 29, dati.length - 29));
      } else if (m === 0xeb && dati.length > 8 && dati[0] === 0x4a && dati[1] === 0x50) {
        const istanza = be16(dati, 2);
        const seq = be32(dati, 4);
        if (!pacchetti.has(istanza)) pacchetti.set(istanza, []);
        pacchetti.get(istanza).push({ seq, dati: dati.subarray(8) });
      }
      i += 2 + len;
    }
    for (const lista of pacchetti.values()) {
      lista.sort((x, y) => x.seq - y.seq);
      // LBox e TBox si ripetono in ogni pacchetto: si tengono solo dal primo.
      const pezzi = lista.map((p, k) => (k === 0 ? p.dati : p.dati.subarray(8)));
      const unito = concat(pezzi);
      const boxes = jumbfBoxes(unito, 0, unito.length);
      if (boxes.length) { res.c2pa = boxes; break; }
    }
    return res;
  }

  function webp(b) {
    const res = { c2pa: null, xmp: [], testiPng: null, formato: 'webp' };
    let i = 12;
    while (i + 8 <= b.length) {
      const tag = fourcc(b, i);
      const len = le32(b, i + 4);
      const da = i + 8;
      if (da + len > b.length) break;
      const dati = b.subarray(da, da + len);
      if (tag === 'C2PA' && !res.c2pa) res.c2pa = jumbfBoxes(dati, 0, dati.length);
      else if (tag === 'XMP ') res.xmp.push(utf8(dati));
      i = da + len + (len & 1);
    }
    return res;
  }

  const UUID_C2PA = 'd8fec3d61b0e483c92975828877ec481';

  function bmff(b) {
    const res = { c2pa: null, xmp: [], testiPng: null, formato: 'bmff' };
    let i = 0;
    while (i + 8 <= b.length) {
      let size = be32(b, i);
      const tipo = fourcc(b, i + 4);
      let testa = 8;
      if (size === 1) {
        if (i + 16 > b.length) break;
        size = be32(b, i + 8) * 4294967296 + be32(b, i + 12);
        testa = 16;
      } else if (size === 0) size = b.length - i;
      if (size < testa || i + size > b.length) break;
      if (tipo === 'uuid' && i + testa + 16 <= b.length) {
        let hex = '';
        for (let k = i + testa; k < i + testa + 16; k++) hex += b[k].toString(16).padStart(2, '0');
        if (hex === UUID_C2PA && !res.c2pa) {
          const dati = b.subarray(i + testa + 16, i + size);
          res.c2pa = jumbfBoxes(dati, 0, dati.length);
        }
      }
      i += size;
    }
    return res;
  }

  // ─────────────────────────────── XMP e IPTC ──────────────────────────────

  function codiceSorgente(uri) {
    const coda = String(uri || '').trim().replace(/\/+$/, '').split('/').pop().toLowerCase();
    return Object.prototype.hasOwnProperty.call(SORGENTI, coda) ? SORGENTI[coda] : null;
  }

  function leggiXmp(testo) {
    const t = String(testo || '');
    const fonti = [];
    const re = /DigitalSourceType\s*(?:=\s*"([^"]*)"|>\s*([^<]*)<)/gi;
    let m;
    while ((m = re.exec(t))) fonti.push((m[1] || m[2] || '').trim());
    const res2 = /DigitalSourceType[^>]*rdf:resource\s*=\s*"([^"]*)"/i.exec(t);
    if (res2) fonti.push(res2[1]);
    let origine = null;
    for (const f of fonti) {
      const c = codiceSorgente(f);
      if (c === 'ai') { origine = 'ai'; break; }
      if (c && !origine) origine = c;
    }
    const chi = /(?:xmp:CreatorTool|photoshop:Credit|dc:creator|tiff:Make)\s*(?:=\s*"([^"]*)"|>\s*([^<]*)<)/i.exec(t);
    return { origine, dichiarante: chi ? String(chi[1] || chi[2] || '').trim() : '' };
  }

  // ─────────────────────────────── C2PA ────────────────────────────────────

  function sha(alg, bytes) {
    const crypto = nodeMod('node:crypto');
    if (!crypto) return null;
    const nome = { 'sha256': 'sha256', 'sha384': 'sha384', 'sha512': 'sha512' }[String(alg || 'sha256').toLowerCase()] || 'sha256';
    return u8(crypto.createHash(nome).update(Buffer.from(bytes)).digest());
  }
  function ugualiByte(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  const ALG_COSE = {
    '-7': { hash: 'sha256', tipo: 'ec' },
    '-35': { hash: 'sha384', tipo: 'ec' },
    '-36': { hash: 'sha512', tipo: 'ec' },
    '-37': { hash: 'sha256', tipo: 'pss' },
    '-38': { hash: 'sha384', tipo: 'pss' },
    '-39': { hash: 'sha512', tipo: 'pss' },
    '-257': { hash: 'sha256', tipo: 'pkcs1' },
    '-8': { hash: null, tipo: 'eddsa' },
  };

  // Verifica la COSE_Sign1 staccata del C2PA sul claim. Torna
  // { valida, motivo, certificati } — mai `valida` senza aver verificato davvero.
  function verificaCose(coseBytes, claimBytes) {
    const crypto = nodeMod('node:crypto');
    if (!crypto || !crypto.X509Certificate) return { valida: false, motivo: 'non_verificabile', soggetto: '' };
    let cose = cborTesta(coseBytes);
    if (cose && cose.__tag !== undefined) cose = cose.valore;
    if (!Array.isArray(cose) || cose.length < 4) return { valida: false, motivo: 'firma_illeggibile', soggetto: '' };
    const protetto = u8(cose[0]);
    const nonProtetto = cose[1];
    const firma = u8(cose[3]);
    const testa = cborTesta(protetto);
    if (!testa || typeof testa !== 'object') return { valida: false, motivo: 'firma_illeggibile', soggetto: '' };
    const alg = ALG_COSE[String(testa['1'])];
    if (!alg) return { valida: false, motivo: 'firma_algoritmo_ignoto', soggetto: '' };

    let catena = testa['33'];
    if (catena === undefined && nonProtetto && typeof nonProtetto === 'object') catena = nonProtetto['33'];
    if (catena && !Array.isArray(catena)) catena = [catena];
    if (!Array.isArray(catena) || !catena.length) return { valida: false, motivo: 'firma_senza_certificato', soggetto: '' };

    let certs;
    try { certs = catena.map((c) => new crypto.X509Certificate(Buffer.from(u8(c)))); } catch (_) {
      return { valida: false, motivo: 'firma_illeggibile', soggetto: '' };
    }

    const sig = concat([cborTstr('Signature1'), cborBstr(protetto), cborBstr(new Uint8Array(0)), cborBstr(u8(claimBytes))]);
    const dati = Buffer.from(concat([cborLen(4, 4), sig]));

    let ok = false;
    try {
      const chiave = certs[0].publicKey;
      if (alg.tipo === 'eddsa') ok = crypto.verify(null, dati, chiave, Buffer.from(firma));
      else if (alg.tipo === 'ec') ok = crypto.verify(alg.hash, dati, { key: chiave, dsaEncoding: 'ieee-p1363' }, Buffer.from(firma));
      else if (alg.tipo === 'pss') {
        ok = crypto.verify(alg.hash, dati, {
          key: chiave,
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
          saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
        }, Buffer.from(firma));
      } else ok = crypto.verify(alg.hash, dati, chiave, Buffer.from(firma));
    } catch (_) { ok = false; }
    if (!ok) return { valida: false, motivo: 'firma_non_valida', soggetto: '' };

    // La catena serve a sapere CHI ha firmato: un anello che non torna rende il
    // nome sul certificato una parola come un'altra, non un'attribuzione.
    let catenaIntegra = true;
    for (let i = 0; i + 1 < certs.length; i++) {
      try { if (!certs[i].verify(certs[i + 1].publicKey)) catenaIntegra = false; } catch (_) { catenaIntegra = false; }
    }
    return {
      valida: true,
      motivo: '',
      soggetto: campoCert(certs[0].subject, 'O') || campoCert(certs[0].subject, 'CN') || '',
      emittente: campoCert(certs[0].issuer, 'O') || campoCert(certs[0].issuer, 'CN') || '',
      catenaIntegra,
      radice: impronteChiavi(crypto, certs),
      scaduto: scaduto(certs[0]),
    };
  }

  function campoCert(testo, nome) {
    const m = new RegExp('(?:^|\\n)' + nome + '=([^\\n]*)').exec(String(testo || ''));
    return m ? m[1].trim() : '';
  }
  function scaduto(cert) {
    const a = Date.parse(cert.validTo);
    return Number.isFinite(a) ? Date.now() > a : false;
  }
  function impronteChiavi(crypto, certs) {
    const out = [];
    for (const c of certs) {
      try {
        const der = c.publicKey.export({ type: 'spki', format: 'der' });
        out.push(crypto.createHash('sha256').update(der).digest('hex'));
      } catch (_) {}
    }
    return out;
  }

  function enteRiconosciuto(nome, impronte) {
    const n = String(nome || '').toLowerCase();
    for (const e of ENTI) {
      if ((impronte || []).some((i) => e.radici.includes(i))) return { ente: e.ente, forte: true };
    }
    if (!n) return null;
    for (const e of ENTI) {
      if (e.nomi.some((x) => n.includes(x))) return { ente: e.ente, forte: false };
    }
    return null;
  }

  // Ciò che il claim afferma, ma solo per le asserzioni la cui impronta combacia
  // con quella firmata: un'asserzione non coperta dalla firma non è firmata.
  function leggiManifesto(manifesto, claim) {
    const attese = new Map();
    const liste = [claim && claim.assertions, claim && claim.created_assertions, claim && claim.gathered_assertions];
    for (const lista of liste) {
      if (!Array.isArray(lista)) continue;
      for (const a of lista) {
        if (!a || typeof a !== 'object' || typeof a.url !== 'string') continue;
        const nome = a.url.split('/').pop();
        attese.set(nome, { hash: u8(a.hash), alg: a.alg || claim.alg || 'sha256' });
      }
    }
    const store = perEtichetta(manifesto.figli, 'c2pa.assertions');
    const out = { origine: null, generatore: '', coperte: 0, scoperte: 0, hashDati: null };
    if (!store) return out;
    for (const box of store.figli) {
      if (box.tipo !== 'jumb' || !box.etichetta) continue;
      const atteso = attese.get(box.etichetta);
      if (atteso && atteso.hash && atteso.hash.length) {
        const vero = sha(atteso.alg, box.raw);
        if (!vero || !ugualiByte(vero, atteso.hash)) { out.scoperte++; continue; }
      } else if (attese.size) { out.scoperte++; continue; }
      out.coperte++;
      const dati = contenuto(box);
      if (!dati) continue;
      const etichetta = box.etichetta.replace(/__\d+$/, '');
      if (etichetta === 'c2pa.hash.data') out.hashDati = cborTesta(dati);
      else if (etichetta === 'c2pa.actions' || etichetta === 'c2pa.actions.v2') {
        const az = cborTesta(dati);
        const elenco = az && Array.isArray(az.actions) ? az.actions : [];
        for (const a of elenco) {
          if (!a || typeof a !== 'object') continue;
          const c = codiceSorgente(a.digitalSourceType);
          if (c === 'ai') out.origine = 'ai';
          else if (c && out.origine !== 'ai') out.origine = c;
          if (!out.origine && /^c2pa\.(edited|filtered|color_adjustments|placed)$/.test(String(a.action || '')) && /ai|generative|firefly|diffusion/i.test(String(a.softwareAgent && a.softwareAgent.name || a.softwareAgent || ''))) {
            out.origine = 'ai-modificata';
          }
        }
      } else if (/^stds\.(iptc|schema-org)/.test(etichetta)) {
        let testo = '';
        try { testo = utf8(dati); } catch (_) {}
        const c = codiceSorgente((/digitalSourceType"?\s*[:=]\s*"([^"]*)"/i.exec(testo) || [])[1]);
        if (c === 'ai') out.origine = 'ai';
        else if (c && !out.origine) out.origine = c;
      }
    }
    const gen = claim && (claim.claim_generator_info || claim.claim_generator);
    if (Array.isArray(gen) && gen[0] && gen[0].name) out.generatore = String(gen[0].name);
    else if (typeof gen === 'string') out.generatore = gen.split('(')[0].trim();
    return out;
  }

  // Il legame duro: l'impronta dei byte del file, tolte le zone che contengono
  // il manifesto. Se non torna, le credenziali non parlano più di QUESTA immagine.
  function fileIntatto(hashDati, byteFile) {
    if (!hashDati || typeof hashDati !== 'object') return null;
    const atteso = u8(hashDati.hash);
    if (!atteso.length) return null;
    const esclusioni = Array.isArray(hashDati.exclusions) ? hashDati.exclusions.slice() : [];
    esclusioni.sort((a, b) => (a.start || 0) - (b.start || 0));
    const pezzi = [];
    let i = 0;
    for (const e of esclusioni) {
      const da = Math.max(0, Math.min(byteFile.length, Number(e.start) || 0));
      const a = Math.max(da, Math.min(byteFile.length, da + (Number(e.length) || 0)));
      if (da > i) pezzi.push(byteFile.subarray(i, da));
      i = Math.max(i, a);
    }
    if (i < byteFile.length) pezzi.push(byteFile.subarray(i));
    const vero = sha(hashDati.alg || 'sha256', concat(pezzi));
    if (!vero) return null;
    return ugualiByte(vero, atteso);
  }

  // ──────────────────────────────── analisi ────────────────────────────────

  function analizza(byte) {
    const b = u8(byte);
    const vuoto = { trovato: false, origine: null, prova: '', dichiarante: '', riconosciuto: false, avvisi: [], fonte: '' };
    if (b.length < 12) return vuoto;

    let cont;
    try { cont = leggiContenitore(b); } catch (_) { return vuoto; }

    // 1. Credenziali firmate: l'unica cosa che può valere come attribuzione.
    if (cont.c2pa && cont.c2pa.length) {
      const esito = daC2pa(cont.c2pa, b);
      if (esito) return esito;
    }

    // 2. Etichetta IPTC/XMP: è una dichiarazione del file, non una prova.
    for (const testo of cont.xmp) {
      const x = leggiXmp(testo);
      if (x.origine) {
        const ric = enteRiconosciuto(x.dichiarante, []);
        return {
          trovato: true, origine: x.origine, prova: 'dichiarata',
          dichiarante: ric ? ric.ente : x.dichiarante, riconosciuto: !!ric,
          avvisi: [], fonte: 'xmp',
        };
      }
    }

    // 3. Parametri di generazione scritti nei PNG.
    if (cont.testiPng) {
      const p = daPng(cont.testiPng);
      if (p) return p;
    }
    return vuoto;
  }

  function daC2pa(boxes, byteFile) {
    const store = boxes.find((x) => x.tipo === 'jumb') || boxes[0];
    if (!store || !store.figli) return null;
    // L'ultimo manifesto è quello attivo: i precedenti sono la storia del file.
    const manifesti = store.figli.filter((f) => f.tipo === 'jumb'
      && (perEtichetta([f], 'c2pa.claim') || perEtichetta([f], 'c2pa.claim.v2')));
    const manifesto = manifesti.length ? manifesti[manifesti.length - 1] : null;
    if (!manifesto) return null;

    const claimBox = perEtichetta([manifesto], 'c2pa.claim') || perEtichetta([manifesto], 'c2pa.claim.v2');
    const firmaBox = perEtichetta([manifesto], 'c2pa.signature');
    const claimBytes = contenuto(claimBox);
    const coseBytes = contenuto(firmaBox);
    if (!claimBytes || !coseBytes) return null;
    const claim = cborTesta(claimBytes);
    if (!claim || typeof claim !== 'object') return null;

    const firma = verificaCose(coseBytes, claimBytes);
    const avvisi = [];
    if (!firma.valida) {
      // Credenziali che non reggono la verifica: si dice che ci sono e che non
      // valgono, mai cosa affermano — sarebbe ripetere il testo di chi le ha messe.
      return {
        trovato: true, origine: null, prova: 'firma-rotta', dichiarante: '',
        riconosciuto: false, avvisi: [firma.motivo || 'firma_non_valida'], fonte: 'c2pa',
      };
    }

    const letto = leggiManifesto(manifesto, claim);
    const intatto = fileIntatto(letto.hashDati, byteFile);
    if (intatto === false) avvisi.push('file_cambiato');
    if (intatto === null) avvisi.push('legame_assente');
    if (letto.scoperte) avvisi.push('asserzioni_scoperte');
    if (firma.scaduto) avvisi.push('certificato_scaduto');
    if (firma.catenaIntegra === false) avvisi.push('catena_rotta');

    const ric = enteRiconosciuto(firma.soggetto, firma.radice) || enteRiconosciuto(letto.generatore, []);
    const dichiarante = ric ? ric.ente : (firma.soggetto || letto.generatore || '');
    // Un manifesto valido che non dice niente sull'origine non è una notizia:
    // si tace e si lascia parlare le altre etichette del file.
    const dicibile = letto.origine || avvisi.includes('file_cambiato');
    if (!dicibile) return null;
    return {
      trovato: true,
      origine: letto.origine,
      prova: 'firmata',
      dichiarante,
      riconosciuto: !!ric,
      avvisi,
      fonte: 'c2pa',
    };
  }

  function daPng(testi) {
    for (const v of CHIAVI_PNG) {
      const valore = testi[v.chiave];
      if (typeof valore === 'string' && valore.trim()) {
        return {
          trovato: true, origine: 'ai', prova: 'dichiarata',
          dichiarante: v.ente, riconosciuto: false, avvisi: [], fonte: 'png',
        };
      }
    }
    // Solo i campi che contengono un NOME DI PROGRAMMA: in una descrizione
    // libera «imagen» è una parola spagnola e «flux» un termine di fisica.
    for (const chiave of ['software', 'creator', 'creatortool', 'xmp:creatortool']) {
      const valore = testi[chiave];
      const ente = typeof valore === 'string' ? enteDaTesto(valore) : '';
      if (ente) {
        return { trovato: true, origine: 'ai', prova: 'dichiarata', dichiarante: ente, riconosciuto: false, avvisi: [], fonte: 'png' };
      }
    }
    return null;
  }

  function enteDaTesto(testo) {
    const t = String(testo || '').toLowerCase();
    for (const p of PROGRAMMI_AI) {
      const re = new RegExp('(^|[^a-z0-9])' + p.ago.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])');
      if (re.test(t)) return p.ente;
    }
    return '';
  }

  // ──────────────────────────────── la frase ───────────────────────────────

  const COSA = {
    'ai': 'Generata con l’AI',
    'ai-modificata': 'Modificata con l’AI',
    'fotocamera': 'Scattata con una fotocamera',
  };

  // Una riga sola, o niente. Mai «autentica», mai «nessun segno di AI»:
  // le etichette si perdono a ogni ricompressione e quasi nessuno le mette.
  // Il nome lo scrive chi ha fatto il file: una riga sola, corta, senza segni di
  // controllo né marcature — così non può fingersi altro né sfondare il riquadro.
  function pulisci(nome) {
    let s = String(nome || '');
    // Node consegna il soggetto del certificato con gli a capo già sfuggiti
    // (`\0A`): si tolgono prima, o restano a schermo come testo.
    s = s.replace(/\\[0-9A-Fa-f]{2}/g, ' ');
    s = s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029<>"'`\\]+/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > 60 ? s.slice(0, 60).trim() + '…' : s;
  }

  function frase(res) {
    if (!res || !res.trovato) return '';
    const chi = pulisci(res.dichiarante);

    if (res.prova === 'firma-rotta') {
      return 'Ha credenziali di origine, ma la firma non è valida. Non dicono niente su questa immagine.';
    }
    if (res.avvisi && res.avvisi.includes('file_cambiato')) {
      return chi
        ? `Il file è stato cambiato dopo la firma di ${chi}, quindi le sue credenziali non valgono più.`
        : 'Il file è stato cambiato dopo la firma, quindi le credenziali non valgono più.';
    }
    const cosa = COSA[res.origine];
    if (!cosa) return '';

    if (res.prova === 'firmata') {
      const debole = (res.avvisi || []).some((a) => a === 'legame_assente' || a === 'asserzioni_scoperte' || a === 'catena_rotta' || a === 'certificato_scaduto');
      if (!res.riconosciuto) {
        return chi
          ? `${cosa} secondo credenziali firmate da ${chi}, un ente che Filo non riconosce.`
          : `${cosa} secondo credenziali firmate, ma Filo non riconosce chi le ha firmate.`;
      }
      if (debole) return `${cosa} secondo ${chi}, ma le sue credenziali sono incomplete.`;
      if (res.origine === 'fotocamera') return `Scattata con una fotocamera, firmata da ${chi}.`;
      if (res.origine === 'ai-modificata') return `Modificata con l’AI, credenziali di ${chi}.`;
      return `Generata con l’AI, lo dichiara ${chi} nelle credenziali firmate.`;
    }
    return chi
      ? `${cosa} secondo il file stesso (${chi}), senza firma che lo confermi.`
      : `${cosa} secondo il file stesso, senza firma che lo confermi.`;
  }

  // Quello che l'agente deve sapere quando gli si chiede «è fatta con l'AI?»:
  // un file muto non è una risposta, ed è il caso più frequente.
  // `sistema` è voce di Filo, `etichetta` è quello che dice il file: chi compone
  // il prompt tiene le due cose separate, o il file parla con l'autorità di Filo.
  function notaPerModello(res) {
    const etichetta = frase(res);
    if (etichetta) {
      return {
        sistema: 'ho letto in locale le etichette di origine dell’immagine e l’esito è nel blocco qui sotto; '
          + 'Filo legge solo ciò che il file dichiara e non giudica mai i pixel, quindi riporta quell’esito senza aggiungerci un verdetto tuo',
        etichetta,
      };
    }
    return {
      sistema: 'ho letto in locale le etichette di origine dell’immagine: il file non ne porta nessuna — '
        + 'né credenziali firmate, né etichetta IPTC/XMP, né parametri di generazione. Questo NON prova che l’immagine sia '
        + 'autentica: uno screenshot, una ricompressione o il caricamento su un social le cancellano, e molti generatori non '
        + 'le scrivono affatto. Dillo così, senza sbilanciarti sull’origine',
      etichetta: '',
    };
  }

  global.SN_PROVENIENZA = {
    analizza, frase, notaPerModello, ENTI,
    _interni: { pulisci, cborDecode: cborTesta, jumbfBoxes, leggiContenitore, leggiXmp, codiceSorgente, verificaCose, fileIntatto, enteRiconosciuto },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
