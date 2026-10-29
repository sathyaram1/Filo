// Il contesto del manutentore (SPEC-RIDISEGNO-LAVORO.md § 2): il suo ruolo, tutte le schede in una riga ciascuna e i rami
// in corso coi loro file, da git e senza modello; scrive solo l'ordine da accendere, che il pacemaker legge. Regole:
// tests/unit/manutentore.test.mjs. Uso: npm run manutentore -- contesto | rami | incroci <N> | ordine | accendi <N,M,…>|--niente

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { espandiInclusioni } from './lib/role-text.mjs';
import { incroci, ramiInCorso } from './lib/su-main.mjs';
import { CARTELLA_PREDEFINITA, INDICE, leggiSchede } from './schede.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Lo stesso tetto del server (functions/src/routine/accensioni.js, ORDINE_MAX): oltre si rifiuta col numero.
export const ORDINE_MAX = 2000;

/** «812, #815,815.2» → { ok, numeri } senza doppioni nell'ordine dato, o { ok:false, motivo }. PURA. */
export function leggiOrdine(testo) {
  const pezzi = String(testo || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  if (!pezzi.length) return { ok: false, motivo: 'accendi vuole i numeri in ordine (accendi 812,815) o --niente per svuotare l\'ordine' };
  const storti = pezzi.filter((x) => !/^#?[1-9]\d{0,6}(?:\.[1-9]\d{0,3})?$/.test(x));
  if (storti.length) return { ok: false, motivo: `non sono numeri di feedback: ${storti.slice(0, 5).join(', ')}` };
  const numeri = [...new Set(pezzi.map((x) => x.replace(/^#/, '')))];
  if (numeri.length > ORDINE_MAX) return { ok: false, motivo: `${numeri.length} numeri, il massimo è ${ORDINE_MAX}` };
  return { ok: true, numeri };
}

/** Il corpo REST del documento `config/manutentore`. PURA. */
export function corpoOrdine(numeri, adesso = new Date()) {
  return { fields: {
    ordine: { arrayValue: { values: numeri.map((n) => ({ stringValue: n })) } },
    at: { timestampValue: adesso.toISOString() },
  } };
}

async function documentoOrdine(metodo, corpo) {
  const { acquireBearer, FIRESTORE_BASE } = await import('./lib/firestore-auth.mjs');
  const bearer = await acquireBearer();
  const res = await fetch(`${FIRESTORE_BASE}/config/manutentore`, {
    method: metodo, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  if (metodo === 'GET' && res.status === 404) return { ok: true, numeri: [] };
  if (!res.ok) return { ok: false, motivo: `Firestore ha risposto ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const j = await res.json();
  return { ok: true, numeri: ((j.fields?.ordine?.arrayValue?.values) || []).map((v) => v.stringValue).filter(Boolean) };
}

/** Una scheda in una riga, con stato e priorità dall'indice. PURA. */
export function rigaScheda(s, f = {}) {
  const num = String(s.numero || '').replace(/^#/, '');
  const pezzi = [
    `#${num}`,
    `[${s.area || '?'}/${s.tipo || '?'}]`,
    f.stato || s.stato || '?',
    Number.isInteger(f.priorita) ? `p${f.priorita}` : 'p?',
    s.urgente ? 'URGENTE' : '',
    `valido ${s.valido || '?'}`,
    s.risolto_su_main ? `risolto? ${String(s.risolto_su_main).slice(0, 60)}` : '',
    Array.isArray(s.doppione_di) && s.doppione_di.length ? `doppione di ${s.doppione_di.map((n) => `#${String(n).replace(/^#/, '')}`).join(', ')}` : '',
  ].filter(Boolean).join(' · ');
  const file = Array.isArray(s.file_probabili) && s.file_probabili.length ? ` | file: ${s.file_probabili.join(', ')}` : '';
  return `${pezzi} — ${s.titolo_breve || ''}: ${String(s.riassunto || '').replace(/\s+/g, ' ').trim()}${file}`;
}

/** I rami dei worker (`worker/<id del feedback>-<ora>`) prendono il numero dall'indice, davanti ai citati. PURA. */
export function conNumeri(rami, indice) {
  const perId = new Map((indice || []).map((f) => [f.id, f.num]));
  return (rami || []).map((r) => {
    const n = perId.get((/^worker\/([A-Za-z0-9]+)-\d{8}T\d{6}Z$/.exec(r.ramo) || [])[1]);
    return n ? { ...r, feedback: [n, ...(r.feedback || []).filter((x) => x !== n)] } : r;
  });
}

/** Un ramo in corso in una riga. PURA. */
export function rigaRamo(r) {
  const fb = r.feedback && r.feedback.length ? ` (${r.feedback.slice(0, 3).map((n) => `#${n}`).join(', ')})` : '';
  return `${r.ramo}${fb}, ${r.avanti} commit, ${String(r.data).slice(0, 10)}: ${r.file.join(', ') || '(nessun file)'}`;
}

/** Il contesto intero, in testo. PURA rispetto ai suoi ingressi. */
export function testoContesto({ ruolo, schede, indice, rami }) {
  const numero = (s) => String(s.numero).replace(/^#/, '');
  const perNum = new Map((indice || []).map((f) => [f.num, f]));
  // Con l'indice valgono solo le schede dei feedback ancora aperti: le altre sono di feedback chiusi da allora.
  const aperte = indice && indice.length ? schede.filter((s) => perNum.has(numero(s))) : schede;
  const ordinate = [...aperte].sort((a, b) => Number(numero(a)) - Number(numero(b)));
  const senza = (indice || []).filter((f) => !schede.some((s) => numero(s) === f.num));
  const chiuse = schede.length - aperte.length;
  return [
    ruolo.trim(), '',
    `## Schede (${aperte.length})`, '',
    ...ordinate.map((s) => rigaScheda(s, perNum.get(numero(s)))),
    ...(senza.length ? ['', `Senza scheda (${senza.length}): ${senza.map((f) => `#${f.num}`).join(', ')}. Si scrivono con npm run feedback:schede -- scrivi.`] : []),
    ...(chiuse ? ['', `Fuori: ${chiuse} schede di feedback che l'indice non ha più fra gli aperti.`] : []),
    '', `## Rami in corso (${rami.length})`, '',
    ...rami.map(rigaRamo),
    '', '## Spesa', '',
    'Questo strumento non la sa: chiedi all\'owner il consumo della settimana dell\'account (Gestione → Automazioni), non la somma dei biglietti.',
  ].join('\n');
}

function opzione(argv, nome) {
  const i = argv.findIndex((a) => a === nome || a.startsWith(`${nome}=`));
  if (i < 0) return undefined;
  return argv[i].includes('=') ? argv[i].slice(nome.length + 1) : argv[i + 1];
}

export async function main(argv, { root = ROOT } = {}) {
  const [cmd, arg] = argv;
  if (!['contesto', 'rami', 'incroci', 'ordine', 'accendi'].includes(cmd) || (cmd === 'incroci' && !arg)) {
    console.error('Uso: npm run manutentore -- contesto | rami | incroci <N> | ordine | accendi <N,M,…>|--niente  [--cartella <dir delle schede>] [--giorni 30] [--senza-fetch]');
    return 1;
  }
  // L'ordine da accendere: il pacemaker accende una sessione per ciascun feedback che ha lavoro, in quest'ordine.
  if (cmd === 'ordine' || cmd === 'accendi') {
    let numeri = [];
    if (cmd === 'accendi' && arg !== '--niente') {
      const o = leggiOrdine(argv.slice(1).filter((a) => !a.startsWith('--')).join(','));
      if (!o.ok) { console.error(`RIFIUTATO: ${o.motivo}. Non ho scritto niente.`); return 1; }
      numeri = o.numeri;
    }
    const r = cmd === 'ordine' ? await documentoOrdine('GET') : await documentoOrdine('PATCH', corpoOrdine(numeri));
    if (!r.ok) { console.error(`RIFIUTATO: ${r.motivo}`); return 2; }
    console.log(r.numeri.length
      ? `Ordine da accendere (${r.numeri.length}): ${r.numeri.map((n) => `#${n}`).join(', ')}. Il pacemaker accende una sessione per ciascuno che ha lavoro, una priorità 3 fuori ordine davanti.`
      : 'Nessun ordine: il pacemaker accende per priorità, come ripiego.');
    return 0;
  }
  const cartella = resolve(opzione(argv, '--cartella') || CARTELLA_PREDEFINITA);
  const giorni = Number(opzione(argv, '--giorni')) || 30;
  if (!argv.includes('--senza-fetch')) {
    try { execFileSync('git', ['-C', root, 'fetch', 'origin', '--prune', '--quiet'], { stdio: 'ignore', timeout: 120_000 }); } catch (e) {
      console.error(`AVVISO: git fetch non è riuscito (${String(e.message).split('\n')[0]}): i rami sono quelli dell'ultima volta.`);
    }
  }
  let indice = [];
  try { indice = JSON.parse(readFileSync(join(cartella, INDICE), 'utf8')); } catch (_) { /* senza indice niente stato, priorità né numeri dei worker */ }
  const rami = conNumeri(ramiInCorso(root, { giorni }), indice);
  if (cmd === 'rami') { console.log(rami.map(rigaRamo).join('\n') || 'Nessun ramo in corso.'); return 0; }
  const schede = leggiSchede(cartella);
  if (cmd === 'incroci') {
    const num = String(arg).replace(/^#/, '');
    const s = schede.find((x) => String(x.numero).replace(/^#/, '') === num);
    if (!s) { console.error(`Nessuna scheda per #${num} in ${cartella}: npm run feedback:schede -- scrivi --solo ${num}.`); return 1; }
    const comuni = incroci(rami, s.file_probabili);
    console.log(comuni.length
      ? comuni.map((c) => `${c.ramo}${c.feedback.length ? ` (#${c.feedback[0]})` : ''}: ${c.comuni.join(', ')}`).join('\n')
      : `Nessun ramo in corso tocca i file probabili di #${num} (${(s.file_probabili || []).join(', ') || 'nessuno indicato'}).`);
    return 0;
  }
  if (!schede.length) console.error(`AVVISO: nessuna scheda in ${cartella}: npm run feedback:schede -- elenca, poi scrivi.`);
  const dirRuoli = join(ROOT, 'routines', 'roles');
  const ruolo = espandiInclusioni(readFileSync(join(dirRuoli, 'manutentore.md'), 'utf8'), dirRuoli);
  console.log(testoContesto({ ruolo, schede, indice, rami }));
  return 0;
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) process.exit(await main(process.argv.slice(2)));
