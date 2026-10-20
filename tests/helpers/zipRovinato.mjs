// Rovina una voce di uno zip scritto da buildExportZip, come un gestore di archivi o un disco che perde byte (#1088):
// `conMetodo` le dà un metodo che Filo non legge (bzip2 = 12, LZMA = 14), `conByteCambiato` le cambia un byte,
// `conIndiceRotto` rompe la sua riga nell'indice in fondo; `tutteCon` fa lo stesso su ogni voce dell'archivio.

function voce(zip, nome) {
  const eocd = zip.length - 22;
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    if (zip.slice(p + 46, p + 46 + nameLen).toString('utf8') === nome) {
      const locale = zip.readUInt32LE(p + 42);
      const dati = locale + 30 + zip.readUInt16LE(locale + 26) + zip.readUInt16LE(locale + 28);
      return { centrale: p, locale, dati };
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`voce assente: ${nome}`);
}

export function conMetodo(zip, nome, metodo) {
  const out = Buffer.from(zip);
  const v = voce(out, nome);
  out.writeUInt16LE(metodo, v.centrale + 10);
  out.writeUInt16LE(metodo, v.locale + 8);
  return out;
}

export function conByteCambiato(zip, nome) {
  const out = Buffer.from(zip);
  const v = voce(out, nome);
  out[v.dati] ^= 0xff;
  return out;
}

export function conIndiceRotto(zip, nome) {
  const out = Buffer.from(zip);
  out[voce(out, nome).centrale + 1] ^= 0xff;
  return out;
}

// Cambia un solo campo della riga nell'indice, lasciando intatta la copia che la voce porta all'inizio.
// `campo`: 'nome' | 'metodo' | 'cifrata'.
export function conCampoDellIndice(zip, nome, campo) {
  const out = Buffer.from(zip);
  const v = voce(out, nome);
  if (campo === 'nome') out[v.centrale + 46 + 1] ^= 1;
  else if (campo === 'metodo') out[v.centrale + 10] ^= 1;
  else if (campo === 'cifrata') out[v.centrale + 8] ^= 1;
  else throw new Error(`campo sconosciuto: ${campo}`);
  return out;
}

function nomi(zip) {
  const eocd = zip.length - 22;
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out = [];
  for (let n = 0; n < count; n++) {
    const nameLen = zip.readUInt16LE(p + 28);
    out.push(zip.slice(p + 46, p + 46 + nameLen).toString('utf8'));
    p += 46 + nameLen + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  return out;
}

// `come`: { metodo } oppure { cifrata: true }.
export function tutteCon(zip, come) {
  let out = Buffer.from(zip);
  for (const nome of nomi(out)) {
    if (come.metodo != null) out = conMetodo(out, nome, come.metodo);
    if (come.cifrata) {
      const v = voce(out, nome);
      out.writeUInt16LE(out.readUInt16LE(v.centrale + 8) | 1, v.centrale + 8);
      out.writeUInt16LE(out.readUInt16LE(v.locale + 6) | 1, v.locale + 6);
    }
  }
  return out;
}

// Il record finale rovinato (#1088.5): `conContoVoci` gli cambia il numero di voci, `conFirmaFinaleRotta` la firma.
export function conContoVoci(zip, n) {
  const out = Buffer.from(zip);
  out.writeUInt16LE(n, out.length - 22 + 8);
  out.writeUInt16LE(n, out.length - 22 + 10);
  return out;
}

export function conFirmaFinaleRotta(zip) {
  const out = Buffer.from(zip);
  out[out.length - 22] ^= 0xff;
  return out;
}
