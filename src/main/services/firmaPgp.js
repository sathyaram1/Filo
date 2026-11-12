// Verifica di una firma OpenPGP staccata (v4, RSA) contro una chiave fissata in Filo: serve a credere che il
// programma per i video l'abbiano pubblicato i suoi autori (#1488). Accetta solo la chiave primaria data, niente
// sottochiavi né altri algoritmi: quello che non riconosce lo rifiuta. Prove: tests/unit/firmaPgp.test.mjs.

'use strict';

const crypto = require('node:crypto');

// La chiave con cui yt-dlp firma i rilasci, copiata da public.key del suo repository.
const CHIAVE_YTDLP = `-----BEGIN PGP PUBLIC KEY BLOCK-----

mQINBGP78C4BEAD0rF9zjGPAt0thlt5C1ebzccAVX7Nb1v+eqQjk+WEZdTETVCg3
WAM5ngArlHdm/fZqzUgO+pAYrB60GKeg7ffUDf+S0XFKEZdeRLYeAaqqKhSibVal
DjvOBOztu3W607HLETQAqA7wTPuIt2WqmpL60NIcyr27LxqmgdN3mNvZ2iLO+bP0
nKR/C+PgE9H4ytywDa12zMx6PmZCnVOOOu6XZEFmdUxxdQ9fFDqd9LcBKY2LDOcS
Yo1saY0YWiZWHtzVoZu1kOzjnS5Fjq/yBHJLImDH7pNxHm7s/PnaurpmQFtDFruk
t+2lhDnpKUmGr/I/3IHqH/X+9nPoS4uiqQ5HpblB8BK+4WfpaiEg75LnvuOPfZIP
KYyXa/0A7QojMwgOrD88ozT+VCkKkkJ+ijXZ7gHNjmcBaUdKK7fDIEOYI63Lyc6Q
WkGQTigFffSUXWHDCO9aXNhP3ejqFWgGMtCUsrbkcJkWuWY7q5ARy/05HbSM3K4D
U9eqtnxmiV1WQ8nXuI9JgJQRvh5PTkny5LtxqzcmqvWO9TjHBbrs14BPEO9fcXxK
L/CFBbzXDSvvAgArdqqlMoncQ/yicTlfL6qzJ8EKFiqW14QMTdAn6SuuZTodXCTi
InwoT7WjjuFPKKdvfH1GP4bnqdzTnzLxCSDIEtfyfPsIX+9GI7Jkk/zZjQARAQAB
tDdTaW1vbiBTYXdpY2tpICh5dC1kbHAgc2lnbmluZyBrZXkpIDxjb250YWN0QGdy
dWI0ay54eXo+iQJOBBMBCgA4FiEErAy75oSNaoc0ZK9OV89lkztadYEFAmP78C4C
GwMFCwkIBwIGFQoJCAsCBBYCAwECHgECF4AACgkQV89lkztadYEVqQ//cW7TxhXg
7Xbh2EZQzXml0egn6j8QaV9KzGragMiShrlvTO2zXfLXqyizrFP4AspgjSn/4NrI
8mluom+Yi+qr7DXT4BjQqIM9y3AjwZPdywe912Lxcw52NNoPZCm24I9T7ySc8lmR
FQvZC0w4H/VTNj/2lgJ1dwMflpwvNRiWa5YzcFGlCUeDIPskLx9++AJE+xwU3LYm
jQQsPBqpHHiTBEJzMLl+rfd9Fg4N+QNzpFkTDW3EPerLuvJniSBBwZthqxeAtw4M
UiAXh6JvCc2hJkKCoygRfM281MeolvmsGNyQm+axlB0vyldiPP6BnaRgZlx+l6MU
cPqgHblb7RW5j9lfr6OYL7SceBIHNv0CFrt1OnkGo/tVMwcs8LH3Ae4a7UJlIceL
V54aRxSsZU7w4iX+PB79BWkEsQzwKrUuJVOeL4UDwWajp75OFaUqbS/slDDVXvK5
OIeuth3mA/adjdvgjPxhRQjA3l69rRWIJDrqBSHldmRsnX6cvXTDy8wSXZgy51lP
m4IVLHnCy9m4SaGGoAsfTZS0cC9FgjUIyTyrq9M67wOMpUxnuB0aRZgJE1DsI23E
qdvcSNVlO+39xM/KPWUEh6b83wMn88QeW+DCVGWACQq5N3YdPnAJa50617fGbY6I
gXIoRHXkDqe23PZ/jURYCv0sjVtjPoVC+bg=
=bJkn
-----END PGP PUBLIC KEY BLOCK-----`;

const HASH = Object.freeze({ 8: 'sha256', 9: 'sha384', 10: 'sha512', 11: 'sha224' });

function dearmora(testo) {
  const righe = String(testo || '').split(/\r?\n/);
  const inizio = righe.findIndex((r) => /^-----BEGIN PGP /.test(r));
  const fine = righe.findIndex((r) => /^-----END PGP /.test(r));
  if (inizio < 0 || fine < inizio) throw new Error('blocco PGP non riconosciuto');
  let i = inizio + 1;
  while (i < fine && righe[i].trim() !== '') i++;
  const corpo = righe.slice(i + 1, fine).filter((r) => !r.startsWith('=')).join('');
  return Buffer.from(corpo, 'base64');
}

function pacchetti(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const ctb = buf[i++];
    if (!(ctb & 0x80)) throw new Error('pacchetto PGP non valido');
    let tag; let len;
    if (ctb & 0x40) {
      tag = ctb & 0x3f;
      const o1 = buf[i++];
      if (o1 < 192) len = o1;
      else if (o1 < 224) len = ((o1 - 192) << 8) + buf[i++] + 192;
      else if (o1 === 255) { len = buf.readUInt32BE(i); i += 4; } else throw new Error('lunghezza PGP parziale non gestita');
    } else {
      tag = (ctb >> 2) & 0x0f;
      const tipo = ctb & 3;
      if (tipo === 0) len = buf[i++];
      else if (tipo === 1) { len = buf.readUInt16BE(i); i += 2; } else if (tipo === 2) { len = buf.readUInt32BE(i); i += 4; } else throw new Error('lunghezza PGP indeterminata non gestita');
    }
    if (i + len > buf.length) throw new Error('pacchetto PGP troncato');
    out.push({ tag, corpo: buf.subarray(i, i + len) });
    i += len;
  }
  return out;
}

function mpi(buf, i) {
  const bit = buf.readUInt16BE(i);
  const n = Math.ceil(bit / 8);
  return { valore: buf.subarray(i + 2, i + 2 + n), fine: i + 2 + n };
}

function chiavePubblica(armatura) {
  const p = pacchetti(dearmora(armatura)).find((x) => x.tag === 6);
  if (!p || p.corpo[0] !== 4 || p.corpo[5] !== 1) throw new Error('serve una chiave RSA v4');
  const n = mpi(p.corpo, 6);
  const e = mpi(p.corpo, n.fine);
  const testa = Buffer.from([0x99, (p.corpo.length >> 8) & 0xff, p.corpo.length & 0xff]);
  const impronta = crypto.createHash('sha1').update(testa).update(p.corpo).digest('hex').toUpperCase();
  const b64u = (b) => b.toString('base64url');
  const key = crypto.createPublicKey({ key: { kty: 'RSA', n: b64u(n.valore), e: b64u(e.valore) }, format: 'jwk' });
  return { key, impronta, idChiave: impronta.slice(-16), byte: n.valore.length };
}

function sottopacchetti(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    let len = buf[i++];
    if (len >= 192 && len < 255) len = ((len - 192) << 8) + buf[i++] + 192;
    else if (len === 255) { len = buf.readUInt32BE(i); i += 4; }
    out.push({ tipo: buf[i] & 0x7f, dati: buf.subarray(i + 1, i + len) });
    i += len;
  }
  return out;
}

// `firma`: il file .sig, binario o armato. Ritorna true solo se la firma è della chiave data e copre `dati`.
function verifica(dati, firma, armaturaChiave = CHIAVE_YTDLP) {
  try {
    const chiave = chiavePubblica(armaturaChiave);
    const grezza = Buffer.isBuffer(firma) && firma[0] & 0x80 ? firma : dearmora(String(firma));
    const sig = pacchetti(grezza).find((x) => x.tag === 2);
    if (!sig) return false;
    const c = sig.corpo;
    if (c[0] !== 4 || c[1] !== 0x00 || c[2] !== 1) return false;
    const hash = HASH[c[3]];
    if (!hash) return false;
    const lenH = c.readUInt16BE(4);
    const hashed = c.subarray(6, 6 + lenH);
    const lenU = c.readUInt16BE(6 + lenH);
    const unhashed = c.subarray(8 + lenH, 8 + lenH + lenU);
    // Chi ha firmato: l'impronta intera se c'è, altrimenti l'id. Una firma d'altri non si prova nemmeno.
    let firmatario = '';
    for (const s of [...sottopacchetti(hashed), ...sottopacchetti(unhashed)]) {
      if (s.tipo === 33 && s.dati[0] === 4) { firmatario = s.dati.subarray(1).toString('hex').toUpperCase(); break; }
      if (s.tipo === 16 && !firmatario) firmatario = s.dati.toString('hex').toUpperCase();
    }
    if (firmatario !== chiave.impronta && firmatario !== chiave.idChiave) return false;
    const valore = mpi(c, 10 + lenH + lenU).valore;
    const piena = Buffer.alloc(Math.max(chiave.byte, valore.length));
    valore.copy(piena, piena.length - valore.length);
    const coda = Buffer.alloc(6);
    coda[0] = 4; coda[1] = 0xff; coda.writeUInt32BE(6 + lenH, 2);
    const firmato = Buffer.concat([Buffer.from(dati), c.subarray(0, 6 + lenH), coda]);
    return crypto.verify(hash, firmato, { key: chiave.key, padding: crypto.constants.RSA_PKCS1_PADDING }, piena);
  } catch (_) {
    return false;
  }
}

module.exports = { verifica, chiavePubblica, CHIAVE_YTDLP };
