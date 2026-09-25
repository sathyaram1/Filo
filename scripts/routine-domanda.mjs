// routine-domanda.mjs — la domanda di fine sessione delle routine, dalla parte dell'owner.
// Imposta le domande (slot orchestrator, worker o un ruolo) e legge le risposte; le
// sessioni la chiedono con routine-channel.mjs domanda/risposta, solo alla fine. Uso: USO qui sotto.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const INDIRIZZO = 'https://europe-west1-filo-8b9cb.cloudfunctions.net/routineClosingAdmin';
const USO = 'Uso: node scripts/routine-domanda.mjs [mostra | imposta <slot> "<testo>" (o il testo da stdin) | togli <slot> | risposte [--n N]]';

/** Le parole della riga di comando. PURA. @returns {{ cmd, slot?, testo?, n? } | { errore }} */
export function leggiArgomenti(argv) {
  const a = (Array.isArray(argv) ? argv : []).map(String);
  const cmd = a[0] || 'mostra';
  if (cmd === 'mostra') return a.length <= 1 ? { cmd } : { errore: `"${a[1]}" non vale qui. ${USO}` };
  if (cmd === 'imposta') {
    if (!a[1] || a[1].startsWith('-')) return { errore: `imposta vuole lo slot. ${USO}` };
    // Il testo intero come l'ha scritto: più parole senza virgolette restano una frase.
    return { cmd, slot: a[1], testo: a.slice(2).join(' ') };
  }
  if (cmd === 'togli') return a.length === 2 && !a[1].startsWith('-') ? { cmd, slot: a[1] } : { errore: `togli vuole lo slot e basta. ${USO}` };
  if (cmd === 'risposte') {
    let n;
    for (let i = 1; i < a.length; i++) {
      const m = /^--n(?:=(.*))?$/.exec(a[i]);
      if (!m) return { errore: `"${a[i]}" non vale qui. ${USO}` };
      const v = m[1] !== undefined ? m[1] : a[++i];
      n = Number(v);
      if (!Number.isInteger(n) || n < 1) return { errore: `--n vuole un numero intero da 1 in su, non "${v ?? ''}".` };
    }
    return n === undefined ? { cmd } : { cmd, n };
  }
  return { errore: USO };
}

function dataOra(ms) {
  if (!Number.isFinite(ms)) return '?';
  return new Date(ms).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Le risposte di orchestratori e worker in un elenco solo, dal più recente, al
 * massimo `n` voci. Domanda e risposta sempre intere. PURA (`quando` formatta l'ora).
 */
export function formattaRisposte(result, { n = 50, quando = dataOra } = {}) {
  const r = result || {};
  const voci = [];
  for (const o of Array.isArray(r.orchestrator) ? r.orchestrator : []) {
    voci.push({ t: Number(o.askedAtMs), testa: `orchestratore · ${visibile(o.slug || '?')}`, domanda: o.question, answered: !!o.answered, risposta: o.answer });
  }
  for (const w of Array.isArray(r.workers) ? r.workers : []) {
    const c = w.closing;
    if (!c || !Number.isFinite(Number(c.askedAtMs))) continue;
    const inizio = Number(w.createdAtMs); const fine = Number(w.releasedAtMs);
    const durata = Number.isFinite(inizio) && Number.isFinite(fine) ? `${Math.round((fine - inizio) / 60000)} min` : 'non rilasciato';
    const num = w.num ? ` #${visibile(w.num)}` : '';
    const testa = `${visibile(w.role || 'worker')}${num} · ${durata} · ${visibile(w.slug || '?')}`;
    voci.push({ t: Number(c.askedAtMs), testa, domanda: c.question, answered: typeof c.answer === 'string', risposta: c.answer });
  }
  voci.sort((x, y) => y.t - x.t);
  const scelte = voci.slice(0, n);
  if (!scelte.length) return 'Nessuna risposta.';
  const righe = scelte.map((v) => [
    `${quando(v.t)}  ${v.testa}`,
    `  D: ${visibile(v.domanda || '').replace(/\n/g, '\n     ')}`,
    `  R: ${v.answered ? visibile(v.risposta || '').replace(/\n/g, '\n     ') : '(nessuna risposta)'}`,
  ].join('\n'));
  // Più voci di quelle mostrate: si dice, non si tace.
  const altre = voci.length - scelte.length;
  return righe.join('\n\n') + (altre > 0 ? `\n\n(altre ${altre} più vecchie fra quelle arrivate: alza --n per vederle)` : '');
}

/** Le domande impostate e il ripiego, come le risolve il server. PURA. */
export function formattaDomande(result) {
  const r = result || {};
  const slots = r.slots && typeof r.slots === 'object' ? r.slots : {};
  const nomi = Object.keys(slots).sort();
  const righe = nomi.map((s) => `${visibile(s)}\n  ${visibile((slots[s] && slots[s].text) || '').replace(/\n/g, '\n  ')}`);
  if (!nomi.length) righe.push('Nessuna domanda impostata: vale per tutti il ripiego.');
  righe.push(`ripiego (orchestratore senza slot suo; worker senza slot del ruolo né «worker»)\n  ${visibile(r.default || '?').replace(/\n/g, '\n  ')}`);
  return righe.join('\n\n');
}

async function chiama(data) {
  const { findAdminRefreshToken, mintIdToken } = await import('./lib/firestore-auth.mjs');
  const refresh = findAdminRefreshToken();
  if (!refresh) {
    console.error('Non trovo le tue credenziali di proprietario (FILO_ADMIN_REFRESH_TOKEN).');
    process.exit(1);
  }
  const idToken = await mintIdToken(refresh);
  const res = await fetch(INDIRIZZO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || (res.status === 404 ? 'la funzione routineClosingAdmin non esiste sul server (non ancora pubblicata?)' : `errore ${res.status}`);
    console.error(`Non riuscito: ${msg}`);
    process.exit(1);
  }
  return body.result || {};
}

async function leggiStdin() {
  if (process.stdin.isTTY) return '';
  const pezzi = [];
  for await (const p of process.stdin) pezzi.push(p);
  return Buffer.concat(pezzi).toString('utf8');
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.some((x) => x === '--help' || x === '-h')) { console.log(USO); return; }
  const a = leggiArgomenti(argv);
  if (a.errore) { console.error(`RIFIUTATO: ${a.errore}`); process.exit(1); }

  if (a.cmd === 'mostra') { console.log(formattaDomande(await chiama({ op: 'get' }))); return; }
  if (a.cmd === 'imposta') {
    const testo = (a.testo || await leggiStdin()).trim();
    if (!testo) { console.error('Manca il testo della domanda: dopo lo slot, o da stdin.'); process.exit(1); }
    await chiama({ op: 'set', slot: a.slot, text: testo });
    console.log(`Domanda per "${a.slot}" impostata.`);
    return;
  }
  if (a.cmd === 'togli') {
    await chiama({ op: 'clear', slot: a.slot });
    console.log(`Domanda per "${a.slot}" tolta: vale il ripiego.`);
    return;
  }
  const n = a.n || 50;
  console.log(formattaRisposte(await chiama({ op: 'answers', limit: n }), { n }));
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) main().catch((e) => { console.error(e?.message || e); process.exit(1); });
