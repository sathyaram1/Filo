// Il testo di un documento per l'indice dei documenti: PDF, Word e LibreOffice, testo semplice. Solo Node, niente
// Electron: gira nel processo a parte (documentiLettoreFiglio.js) e negli unit test. Non scrive niente.
// Chi lo chiama e con quali file: documentiIndice.js.

'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

// Per ritrovare un documento basta l'inizio: una bolletta dice cos'è nella prima pagina, un contratto nelle prime
// dieci. Il tetto tiene fermo il costo di un libro di trecento pagine, non quello di una bolletta.
const MAX_CARATTERI = 20000;
const MAX_PAGINE = 40;
// Oltre questo peso un file non si apre per l'indice (un PDF da mezzo giga terrebbe occupato il lettore per minuti):
// resta cercabile per nome, e l'esito lo dice.
const MAX_BYTE = 64 * 1024 * 1024;
const TESTA_TESTO = 1024 * 1024;

const PDF = new Set(['.pdf']);
const OFFICE = new Set(['.docx', '.odt', '.xlsx', '.ods', '.pptx', '.odp']);
const TESTO = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv']);
// Documenti che Filo non sa ancora leggere dentro: si trovano per nome, e l'esito dice perché il testo manca.
const SOLO_NOME = new Set(['.doc', '.xls', '.ppt', '.rtf', '.pages', '.numbers', '.key']);

function tipoDi(percorso) {
  const ext = path.extname(String(percorso || '')).toLowerCase();
  if (PDF.has(ext)) return 'pdf';
  if (OFFICE.has(ext)) return 'office';
  if (TESTO.has(ext)) return 'testo';
  if (SOLO_NOME.has(ext)) return 'nome';
  return '';
}

function taglia(t) {
  const s = String(t || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  if (s.length <= MAX_CARATTERI) return s;
  let n = MAX_CARATTERI;
  const c = s.charCodeAt(n - 1);
  if (c >= 0xD800 && c <= 0xDBFF) n -= 1;
  return s.slice(0, n);
}

async function testoPdf(buf) {
  const { getDocumentProxy } = require('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  try {
    let t = '';
    const pagine = Number(pdf.numPages) || 0;
    for (let n = 1; n <= Math.min(pagine, MAX_PAGINE) && t.length < MAX_CARATTERI; n++) {
      const page = await pdf.getPage(n);
      const c = await page.getTextContent();
      t += `${c.items.map((it) => (it.str || '') + (it.hasEOL ? '\n' : '')).join('')}\n`;
      try { page.cleanup(); } catch (_) {}
    }
    return { testo: taglia(t), pagine };
  } finally {
    try { await pdf.loadingTask.destroy(); } catch (_) {}
  }
}

/**
 * → { testo, pagine, vuoto, errore } — `vuoto`: un PDF senza testo (una scansione); `errore`: perché il testo manca
 * ('grande' | 'illeggibile' | 'tipo' | 'non_trovato').
 */
async function estrai(percorso) {
  const tipo = tipoDi(percorso);
  if (!tipo) return { testo: '', pagine: 0, vuoto: false, errore: 'tipo' };
  if (tipo === 'nome') return { testo: '', pagine: 0, vuoto: false, errore: 'tipo' };
  let st;
  try { st = await fsp.stat(percorso); } catch (_) { return { testo: '', pagine: 0, vuoto: false, errore: 'non_trovato' }; }
  if (tipo !== 'testo' && st.size > MAX_BYTE) return { testo: '', pagine: 0, vuoto: false, errore: 'grande' };
  try {
    if (tipo === 'testo') {
      const DR = require('./documentRead');
      const fh = await fsp.open(percorso, 'r');
      let buf;
      try {
        buf = Buffer.alloc(Math.min(st.size, TESTA_TESTO));
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        buf = buf.subarray(0, bytesRead);
      } finally { await fh.close(); }
      const letto = DR.decodeTextDettaglio(buf);
      const pulito = DR.senzaRumore(letto.text);
      if (pulito.persi > DR.RUMORE_TOLLERATO && DR.quotaNonTesto(letto.text) >= DR.QUOTA_NON_TESTO) {
        return { testo: '', pagine: 0, vuoto: false, errore: 'illeggibile' };
      }
      return { testo: taglia(pulito.text), pagine: 0, vuoto: false, errore: '' };
    }
    if (tipo === 'office') {
      const t = await require('./nomiFile').testoDocumento(percorso);
      return { testo: taglia(t), pagine: 0, vuoto: !String(t || '').trim(), errore: '' };
    }
    const buf = await fsp.readFile(percorso);
    const r = await testoPdf(buf);
    return { testo: r.testo, pagine: r.pagine, vuoto: !r.testo.trim(), errore: '' };
  } catch (_) {
    return { testo: '', pagine: 0, vuoto: false, errore: 'illeggibile' };
  }
}

module.exports = { estrai, tipoDi, MAX_CARATTERI, MAX_PAGINE, MAX_BYTE };
