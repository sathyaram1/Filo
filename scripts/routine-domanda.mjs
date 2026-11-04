// routine-domanda.mjs — la domanda di fine sessione delle routine, dalla parte dell'owner.
// Imposta le domande per slot e legge le risposte, stampate coi caratteri di controllo resi
// visibili; le sessioni la chiedono con routine-channel.mjs domanda/risposta, solo alla fine.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { primaDiStampare, sedeRifiuta } from './lib/biglietto-locale.mjs';
import { elencoIds, rigaRifiuto } from './lib/sede.mjs';

const INDIRIZZO = 'https://europe-west1-filo-8b9cb.cloudfunctions.net/routineClosingAdmin';
// Gli slot li decide il server (gli altri li rifiuta con `bad_slot`): qui servono solo all'aiuto.
const SLOT = 'tutti, orchestrator, worker, new-work, fixer, verifier, secaudit, compito, compito:<ricorrente> (per esempio compito:riordino)';
const USO = 'Uso: node scripts/routine-domanda.mjs [mostra | imposta <slot> "<testo>" (o il testo da stdin) | togli <slot> | risposte [--n N]]'
  + `\nslot: ${SLOT}`;

/**
 * Il testo intero, coi caratteri di controllo resi visibili (tranne a capo e tab): le risposte
 * vengono da sessioni che leggono testo non fidato, e una sequenza ESC/OSC sul terminale
 * dell'owner scrive negli appunti, cambia il titolo o nasconde righe. PURA.
 */
export function visibile(testo) {
  const CONTROLLO = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
  return String(testo ?? '').replace(CONTROLLO, (c) => {
    const n = c.charCodeAt(0);
    return n <= 0xff ? `\\x${n.toString(16).padStart(2, '0')}` : `\\u${n.toString(16).padStart(4, '0')}`;
  });
}

/** Il motivo di un errore della callable, con l'elenco quando il server lo manda (`bad_slot`). PURA. */
export function messaggioErrore(status, body) {
  const b = body || {};
  const err = b.error || {};
  const res = b.result && b.result.ok === false ? b.result : null;
  let msg = err.message || (res && (res.detail || res.message || res.reason))
    || (status === 404 ? 'la funzione routineClosingAdmin non esiste sul server (non ancora pubblicata?)' : `errore ${status}`);
  if (res && res.reason && !String(msg).includes(res.reason)) msg = `${res.reason}: ${msg}`;
  const det = (err.details && typeof err.details === 'object') ? err.details : (res || {});
  const elenco = det.allowed || det.slots || det.valid;
  if (Array.isArray(elenco) && elenco.length && !elenco.every((x) => String(msg).includes(String(x)))) {
    msg += ` (ammessi: ${elenco.join(', ')})`;
  }
  return visibile(msg);
}

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

/** Un istante in ms, o NaN se manca: il server scrive `null` per «non ancora», e `Number(null)` è 0. PURA. */
function istante(v) {
  return v === null || v === undefined || v === '' ? NaN : Number(v);
}

/**
 * Le risposte di orchestratori e worker in un elenco solo, dal più recente, al
 * massimo `n` voci. Domanda e risposta sempre intere. PURA (`quando` formatta l'ora).
 */
export function formattaRisposte(result, { n = 50, quando = dataOra } = {}) {
  const r = result || {};
  const voci = [];
  for (const o of Array.isArray(r.orchestrator) ? r.orchestrator : []) {
    voci.push({ t: istante(o.askedAtMs), testa: `orchestratore · ${visibile(o.slug || '?')}`, domanda: o.question, answered: !!o.answered, risposta: o.answer });
  }
  for (const w of Array.isArray(r.workers) ? r.workers : []) {
    const c = w.closing;
    if (!c || !Number.isFinite(istante(c.askedAtMs))) continue;
    const inizio = istante(w.createdAtMs); const fine = istante(w.releasedAtMs);
    const durata = Number.isFinite(inizio) && Number.isFinite(fine) ? `${Math.round((fine - inizio) / 60000)} min` : 'non rilasciato';
    // Il server manda il numero già col cancelletto («#477»); uno solo in ogni caso.
    const num = w.num ? ` #${visibile(String(w.num).replace(/^#+/, ''))}` : '';
    const testa = `${visibile(w.role || 'worker')}${num} · ${durata} · ${visibile(w.slug || '?')}`;
    voci.push({ t: istante(c.askedAtMs), testa, domanda: c.question, answered: typeof c.answer === 'string', risposta: c.answer });
  }
  voci.sort((x, y) => (y.t || 0) - (x.t || 0));
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
  righe.push(`ripiego (orchestratore senza slot suo; worker senza slot del ricorrente, del ruolo, «worker»; poi «tutti»)\n  ${visibile(r.default || '?').replace(/\n/g, '\n  ')}`);
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
  if (!res.ok || (body.result && body.result.ok === false)) {
    console.error(`Non riuscito: ${messaggioErrore(res.status, body)}`);
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
  const risposte = await chiama({ op: 'answers', limit: n });
  process.exitCode = await stampaRisposte(risposte, { n });
}

/**
 * Le risposte dietro il cancello della sede (#1148, SPEC-DOMANDE.md §1.2): le scrivono le routine, che leggono testo
 * d'utente. Chi le stampa si sporca prima; nella sede owner passano solo quelle che il server dà per fidate, e le altre
 * si dicono una per una, separando le non fidate da quelle di cui il server non manda la fiducia. → il codice d'uscita
 */
export async function stampaRisposte(risposte, { n = 50, scrivi = (x) => console.log(x), errore = (x) => console.error(x), ...opts } = {}) {
  const r = risposte || {};
  const orch = Array.isArray(r.orchestrator) ? r.orchestrator : [];
  const workers = (Array.isArray(r.workers) ? r.workers : []).filter((w) => w && w.closing);
  const fidata = (v) => !!v && v.fiducia === 'fidato';
  if (sedeRifiuta(opts)) {
    const nome = (v) => (orch.includes(v) ? `orchestratore ${visibile(v.slug || '?')}` : `${visibile(v.role || 'worker')}${v.num ? ` #${visibile(String(v.num).replace(/^#+/, ''))}` : ''}`);
    const fuori = [...orch, ...workers].filter((v) => !fidata(v));
    const ignote = fuori.filter((v) => typeof v.fiducia !== 'string' || !v.fiducia).map(nome);
    const nonFidate = fuori.filter((v) => typeof v.fiducia === 'string' && v.fiducia).map(nome);
    const lette = { ...r, orchestrator: orch.filter(fidata), workers: workers.filter(fidata) };
    // «Nessuna risposta.» direbbe che non ce ne sono: qui ci sono, e restano fuori.
    scrivi(fuori.length && !lette.orchestrator.length && !lette.workers.length
      ? `Nessuna risposta leggibile nella sede owner: ${fuori.length === 1 ? 'quella arrivata resta fuori' : `le ${fuori.length} arrivate restano fuori`}, il perché è sotto.`
      : formattaRisposte(lette, { n }));
    const cosa = (l) => `risposte delle routine alla domanda di fine sessione (${elencoIds(l)})`;
    if (nonFidate.length) errore(rigaRifiuto(cosa(nonFidate), ['testo scritto da routine non fidate']));
    if (ignote.length) errore(rigaRifiuto(cosa(ignote), ['il server non manda la fiducia di chi ha risposto, quindi da qui non si sa se era fidato']));
    return 0;
  }
  const quante = orch.length + workers.length;
  const g = await primaDiStampare(`risposte delle routine alla domanda di fine sessione (${quante})`, quante ? ['testo scritto dalle routine'] : [], opts);
  if (g.riga) errore(g.riga);
  if (!g.stampa) return 1;
  scrivi(formattaRisposte(risposte, { n }));
  return 0;
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) main().catch((e) => { console.error(e?.message || e); process.exit(1); });
