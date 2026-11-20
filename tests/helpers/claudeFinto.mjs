// Un `claude -p` finto per le prove della prova da utente (tests/agent/prova.mjs): parla stream-json come quello vero
// e risponde col copione in FILO_CLAUDE_FINTO (mosse JSON; `"etichetta": "<regex>"` diventa il badge con quel nome),
// servito da FILO_CLAUDE_FINTO_FORNITORE (di serie Anthropic stessa). Finito il copione ripete l'ultima mossa.

import { createInterface } from 'node:readline';

const copione = JSON.parse(process.env.FILO_CLAUDE_FINTO || '[]');
const fornitore = process.env.FILO_CLAUDE_FINTO_FORNITORE || 'firstParty';
let i = 0;
let badge = [];

const scrivi = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
scrivi({ type: 'system', subtype: 'init' });

createInterface({ input: process.stdin }).on('line', (riga) => {
  let j;
  try { j = JSON.parse(riga); } catch (_) { return; }
  const testo = (j.message?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const visti = [...testo.matchAll(/^#(\d+) \[(\w+)\] \S+(?: "(.*)")?$/gm)].map((m) => ({ i: Number(m[1]), page: m[2], label: m[3] || '' }));
  if (visti.length) badge = visti;
  const passo = { ...copione[Math.min(i, copione.length - 1)] };
  i++;
  // `muto`: un modello che non risponde più, per vedere scattare il tetto dei minuti.
  if (passo.muto) return;
  if (passo.etichetta) {
    const re = new RegExp(passo.etichetta, 'i');
    const b = badge.find((x) => re.test(x.label) && (!passo.superficie || x.page === passo.superficie));
    passo.segno = b ? b.i : 999;
    delete passo.etichetta;
    delete passo.superficie;
  }
  // `seBadge`: l'esito dipende da quello che il modello vede, un badge «superficie:etichetta» che risponde alla regex.
  // `senzaBadge`: in più, nessun badge risponde a quest'altra (una scheda chiusa non ha più il suo).
  if (passo.seBadge) {
    const c = (re) => badge.some((x) => new RegExp(re, 'i').test(`${x.page}:${x.label}`));
    passo.esito = c(passo.seBadge) && !(passo.senzaBadge && c(passo.senzaBadge)) ? 'riuscito' : 'non_riuscito';
    passo.perche = `badge: ${badge.map((x) => `${x.page}:${x.label}`).join(' | ').slice(0, 500)}`;
    delete passo.seBadge;
    delete passo.senzaBadge;
  }
  const result = JSON.stringify({ vedo: `passo finto ${i}`, ...passo });
  scrivi({ type: 'assistant', message: { content: [{ type: 'text', text: result }] } });
  scrivi({
    type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: 0,
    modelUsage: { 'claude-haiku-5-5': { canonicalModel: 'claude-haiku-5-5', provider: fornitore, costUSD: 0 } },
  });
});
