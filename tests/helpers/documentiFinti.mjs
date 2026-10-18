// Documenti veri ma fatti al volo (PDF con testo, PDF senza testo, Word), per non tenere file binari nel repo.
// Li usano le prove della ricerca nei documenti: unit e spec.

import * as zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// I caratteri della tabella di Windows sopra il 127 che servono a una bolletta italiana.
const CP1252 = { '€': 0x80, '’': 0x92, '–': 0x96, '—': 0x97 };
function byteDel(c) {
  if (CP1252[c] != null) return CP1252[c];
  const n = c.charCodeAt(0);
  return n < 256 ? n : 0x3f;
}
function stringaPdf(testo) {
  let out = '(';
  for (const c of Array.from(String(testo))) {
    const b = byteDel(c);
    if (c === '(' || c === ')' || c === '\\') out += `\\${c}`;
    else if (b < 32 || b > 126) out += `\\${b.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(b);
  }
  return `${out})`;
}

/** Un PDF con una pagina per elemento di `pagine` (ognuna un elenco di righe). Senza righe: nessun testo. */
export function pdf(pagine) {
  const oggetti = [];
  const n = pagine.length;
  const idPagina = (i) => 4 + i * 2;
  oggetti[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  oggetti[2] = `<< /Type /Pages /Kids [${pagine.map((_, i) => `${idPagina(i)} 0 R`).join(' ')}] /Count ${n} >>`;
  oggetti[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pagine.forEach((righe, i) => {
    const corpo = righe.length
      ? `BT /F1 11 Tf 50 800 Td 14 TL ${righe.map((r) => `${stringaPdf(r)} Tj T*`).join(' ')} ET`
      : '0 0 1 rg 50 50 200 200 re f';
    oggetti[idPagina(i)] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${idPagina(i) + 1} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    oggetti[idPagina(i) + 1] = `<< /Length ${Buffer.byteLength(corpo, 'latin1')} >>\nstream\n${corpo}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const posizioni = [];
  for (let k = 1; k < oggetti.length; k++) {
    posizioni[k] = Buffer.byteLength(out, 'latin1');
    out += `${k} 0 obj\n${oggetti[k]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${oggetti.length}\n0000000000 65535 f \n`;
  for (let k = 1; k < oggetti.length; k++) out += `${String(posizioni[k]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${oggetti.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function zip(voci) {
  const locali = [];
  const centrali = [];
  let pos = 0;
  for (const [nome, testo] of Object.entries(voci)) {
    const dati = Buffer.from(testo, 'utf8');
    const compressi = zlib.deflateRawSync(dati);
    const nb = Buffer.from(nome, 'utf8');
    const crc = typeof zlib.crc32 === 'function' ? zlib.crc32(dati) : 0;
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(8, 8);
    l.writeUInt32LE(crc, 14); l.writeUInt32LE(compressi.length, 18); l.writeUInt32LE(dati.length, 22);
    l.writeUInt16LE(nb.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(compressi.length, 20); c.writeUInt32LE(dati.length, 24);
    c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(pos, 42);
    locali.push(l, nb, compressi);
    centrali.push(c, nb);
    pos += 30 + nb.length + compressi.length;
  }
  const centro = Buffer.concat(centrali);
  const fine = Buffer.alloc(22);
  fine.writeUInt32LE(0x06054b50, 0);
  fine.writeUInt16LE(Object.keys(voci).length, 8); fine.writeUInt16LE(Object.keys(voci).length, 10);
  fine.writeUInt32LE(centro.length, 12); fine.writeUInt32LE(pos, 16);
  return Buffer.concat([...locali, centro, fine]);
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Un documento Word (.docx) con un paragrafo per riga. */
export function docx(righe) {
  const corpo = righe.map((r) => `<w:p><w:r><w:t xml:space="preserve">${xml(r)}</w:t></w:r></w:p>`).join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${corpo}</w:body></w:document>`,
  });
}

// La cartella della prova della segnalazione: una ventina di file dai nomi senza senso, fra cui UNA bolletta della
// luce di marzo. Le altre bollette (luce di febbraio, gas di marzo) sono lì apposta: la ricerca deve distinguerle.
export const BOLLETTA_MARZO = 'scan_00231.pdf';
export function cartellaDellaProva(dir) {
  mkdirSync(dir, { recursive: true });
  const file = {
    'scan_00231.pdf': pdf([[
      'ENERGIA SERVIZIO ELETTRICO S.p.A.', 'Fattura n. 2026/031544 del 04/04/2026',
      'Bolletta per la fornitura di energia elettrica', 'Periodo di fatturazione: 01/03/2026 - 31/03/2026',
      'Codice POD: IT001E12345678', 'Consumo del periodo: 212 kWh', 'Totale da pagare: 61,30 €  entro il 24/04/2026',
    ], ['Dettaglio letture', 'Lettura rilevata il 31/03/2026']]),
    'scan_00198.pdf': pdf([[
      'ENERGIA SERVIZIO ELETTRICO S.p.A.', 'Fattura n. 2026/021007 del 05/03/2026',
      'Bolletta per la fornitura di energia elettrica', 'Periodo di fatturazione: 01/02/2026 - 28/02/2026',
      'Codice POD: IT001E12345678', 'Consumo del periodo: 240 kWh', 'Totale da pagare: 68,10 €',
    ]]),
    'doc_8812.pdf': pdf([[
      'GAS DI CITTA S.r.l.', 'Bolletta gas naturale', 'Periodo: 01/03/2026 - 31/03/2026',
      'Codice PDR: 00881234567890', 'Consumo: 96 Smc', 'Totale: 104,20 €',
    ]]),
    'IMG_20260312_0001.pdf': pdf([[]]),
    'documento (3).docx': docx(['Contratto di locazione ad uso abitativo', 'Il locatore Mario Rossi concede in locazione al conduttore',
      'l’immobile sito in Via Roma 12, Milano.', 'Canone mensile: 750 euro, dal 1 marzo 2025.']),
    'Nuovo documento.docx': docx(['Lista della spesa', 'latte, pane, uova, mele', 'ricordarsi la luce del bagno da cambiare']),
    'aaa.docx': docx(['Verbale della riunione di condominio del 14 marzo 2026', 'Punti all’ordine del giorno: rate condominiali, pulizia scale.']),
    'xyz123.pdf': pdf([[
      'Compagnia Assicurativa Italiana', 'Polizza RC Auto n. 77812', 'Quietanza di pagamento del premio',
      'Veicolo targa AB123CD', 'Premio annuo: 412,00 € pagato il 02/03/2026',
    ]]),
    'scansione0004.pdf': pdf([[
      'Ministero delle Finanze', 'Modello F24 – delega di pagamento', 'Imposta municipale propria', 'Scadenza 16/06/2026',
    ]]),
    'file.pdf': pdf([[
      'Banca Popolare', 'Estratto conto corrente al 31/03/2026', 'Saldo contabile: 3.214,55 euro', 'Giacenza media: 2.987,10 euro',
    ]]),
    'senza titolo.txt': 'Appunti sparsi\nchiamare il tecnico per la caldaia\nprenotare il dentista a marzo\n',
    'note_2.md': '# Ricette\n\nPasta e ceci, risotto alla milanese.\n',
    'p0001.pdf': pdf([[
      'Telefonia Mobile S.p.A.', 'Fattura telefono e internet fibra', 'Periodo marzo 2026', 'Totale: 29,90 €',
    ]]),
    'p0002.pdf': pdf([[
      'Ospedale Civile', 'Referto esami del sangue', 'Data prelievo: 10/03/2026', 'Emocromo nella norma',
    ]]),
    'stampa.pdf': pdf([[
      'Busta paga', 'Cedolino del mese di marzo 2026', 'Retribuzione netta: 1.650,00 euro',
    ]]),
    'xx.docx': docx(['Curriculum vitae', 'Esperienze lavorative', 'Competenze: Excel, Word']),
    'ricevuta.pdf': pdf([[
      'Ricevuta di pagamento', 'Ricevuto da Mario Rossi la somma di 120 euro per lezioni di chitarra', 'Data: 20/01/2026',
    ]]),
    'scan_00232.pdf': pdf([[
      'ACQUEDOTTO COMUNALE', 'Bolletta servizio idrico integrato', 'Periodo: 01/01/2026 - 31/03/2026', 'Consumo: 32 mc', 'Totale: 48,00 €',
    ]]),
    'Documento1.docx': docx(['Lettera di dimissioni', 'Con la presente comunico le mie dimissioni dal 31 marzo 2026.']),
    'DSC0001.pdf': pdf([['Manuale di istruzioni lavatrice', 'Programma cotone 40 gradi', 'Non usare candeggina']]),
  };
  for (const [nome, dati] of Object.entries(file)) writeFileSync(join(dir, nome), dati);
  return Object.keys(file);
}
