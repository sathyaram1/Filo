// Il ragionamento rimandato a Claude vale solo col prefisso con cui è nato (system, strumenti, messaggi prima): se no
// Anthropic rifiuta la richiesta, e via OpenRouter la chiave dell'owner passa in silenzio ai crediti del router (#1552).
// Non tocca i testi. Regola: patterns/il-contesto-e-la-coda-del-filo-e-il-prefisso-non-si-muove.md; sentinella tests/unit/ragionamentoRimandato.test.mjs.

'use strict';

const crypto = require('crypto');

// L'impronta viaggia nell'elenco del ragionamento come un blocco suo: la conserva ogni strada che conserva il
// ragionamento (filo, scheda, giro di strumenti), e qui esce prima di ogni invio, per ogni modello.
const TIPO_IMPRONTA = 'filo.impronta';
const eImpronta = (d) => !!d && typeof d === 'object' && d.type === TIPO_IMPRONTA;
const firma = (h) => h.digest('base64url');

// Il messaggio come lo confronta Anthropic: i punti di cache non contano, un testo semplice vale la sua parte di testo.
function parti(c) {
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  if (!Array.isArray(c)) return c == null ? [] : [c];
  return c.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const { cache_control: _punto, ...resto } = p;
    return resto;
  });
}
function forma(m) {
  if (!m || typeof m !== 'object') return m;
  return [m.role || '', parti(m.content), m.tool_calls || null, m.tool_call_id || null, m.name || null, m.reasoning_details || null];
}

// `messaggi`: quelli che partono, punti di cache compresi. Con `controlla` (i modelli Anthropic) il ragionamento di un
// messaggio parte solo se la sua impronta è quella di quanto lo precede adesso; i blocchi già tolti entrano nel
// confronto, così un buco o un blocco rimesso non passano mai. `impronta()` è quella dell'intera richiesta, il prefisso
// della risposta che sta per nascere: si calcola solo se la risposta ragiona, una pagina da tradurre non paga niente.
function daRimandare(messaggi, { strumenti = null, controlla = false } = {}) {
  const h = crypto.createHash('sha256');
  h.update(`${JSON.stringify(Array.isArray(strumenti) && strumenti.length ? strumenti : null)}\n`);
  const out = [];
  let contati = 0;
  const conta = () => {
    for (; contati < out.length; contati++) h.update(`${JSON.stringify(forma(out[contati]))}\n`);
  };
  for (const m of Array.isArray(messaggi) ? messaggi : []) {
    let msg = m;
    if (m && typeof m === 'object' && Array.isArray(m.reasoning_details)) {
      const segno = m.reasoning_details.find(eImpronta);
      const blocchi = m.reasoning_details.filter((d) => !eImpronta(d));
      let vale = blocchi.length > 0;
      if (vale && controlla) {
        conta();
        vale = !!segno && segno.impronta === firma(h.copy());
      }
      if (vale) msg = segno ? { ...m, reasoning_details: blocchi } : m;
      else {
        const { reasoning_details: _tolto, ...resto } = m;
        msg = resto;
      }
    }
    out.push(msg);
  }
  let finale = null;
  const impronta = () => {
    if (finale == null) {
      conta();
      finale = firma(h);
    }
    return finale;
  };
  return { messaggi: out, impronta };
}

// `impronta`: il valore o la funzione che lo calcola.
function conImpronta(dettagli, impronta) {
  const blocchi = (Array.isArray(dettagli) ? dettagli : []).filter((d) => !eImpronta(d));
  if (!blocchi.length || !impronta) return blocchi;
  return [...blocchi, { type: TIPO_IMPRONTA, impronta: typeof impronta === 'function' ? impronta() : impronta }];
}

module.exports = { TIPO_IMPRONTA, daRimandare, conImpronta };
