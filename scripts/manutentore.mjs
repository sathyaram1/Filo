// Il contesto del manutentore (SPEC-RIDISEGNO-LAVORO.md § 2): il suo ruolo, tutte le schede in una riga ciascuna e i rami
// in corso coi loro file, da git e senza modello. Non decide e non scrive niente: stampa. Regole: tests/unit/manutentore.test.mjs.
// Uso: npm run manutentore -- contesto | rami | incroci <N>   [--cartella <dir delle schede>] [--giorni 30] [--senza-fetch]

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { espandiInclusioni } from './lib/role-text.mjs';
import { incroci, ramiInCorso } from './lib/su-main.mjs';
import { CARTELLA_PREDEFINITA, INDICE, leggiSchede } from './schede.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

/** Un ramo in corso in una riga. PURA. */
export function rigaRamo(r) {
  const fb = r.feedback && r.feedback.length ? ` (${r.feedback.slice(0, 3).map((n) => `#${n}`).join(', ')})` : '';
  return `${r.ramo}${fb}, ${r.avanti} commit, ${String(r.data).slice(0, 10)}: ${r.file.join(', ') || '(nessun file)'}`;
}

/** Il contesto intero, in testo. PURA rispetto ai suoi ingressi. */
export function testoContesto({ ruolo, schede, indice, rami }) {
  const perNum = new Map((indice || []).map((f) => [f.num, f]));
  const ordinate = [...schede].sort((a, b) => Number(String(a.numero).replace(/^#/, '')) - Number(String(b.numero).replace(/^#/, '')));
  const senza = (indice || []).filter((f) => !schede.some((s) => String(s.numero).replace(/^#/, '') === f.num));
  return [
    ruolo.trim(), '',
    `## Schede (${schede.length})`, '',
    ...ordinate.map((s) => rigaScheda(s, perNum.get(String(s.numero).replace(/^#/, '')))),
    ...(senza.length ? ['', `Senza scheda (${senza.length}): ${senza.map((f) => `#${f.num}`).join(', ')}. Si scrivono con npm run feedback:schede -- scrivi.`] : []),
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

export async function main(argv) {
  const [cmd, arg] = argv;
  if (!['contesto', 'rami', 'incroci'].includes(cmd) || (cmd === 'incroci' && !arg)) {
    console.error('Uso: npm run manutentore -- contesto | rami | incroci <N>  [--cartella <dir delle schede>] [--giorni 30] [--senza-fetch]');
    return 1;
  }
  const cartella = resolve(opzione(argv, '--cartella') || CARTELLA_PREDEFINITA);
  const giorni = Number(opzione(argv, '--giorni')) || 30;
  if (!argv.includes('--senza-fetch')) {
    try { execFileSync('git', ['-C', ROOT, 'fetch', 'origin', '--prune', '--quiet'], { stdio: 'ignore', timeout: 120_000 }); } catch (e) {
      console.error(`AVVISO: git fetch non è riuscito (${String(e.message).split('\n')[0]}): i rami sono quelli dell'ultima volta.`);
    }
  }
  const rami = ramiInCorso(ROOT, { giorni });
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
  let indice = [];
  try { indice = JSON.parse(readFileSync(join(cartella, INDICE), 'utf8')); } catch (_) { /* senza indice niente stato né priorità */ }
  if (!schede.length) console.error(`AVVISO: nessuna scheda in ${cartella}: npm run feedback:schede -- elenca, poi scrivi.`);
  const dirRuoli = join(ROOT, 'routines', 'roles');
  const ruolo = espandiInclusioni(readFileSync(join(dirRuoli, 'manutentore.md'), 'utf8'), dirRuoli);
  console.log(testoContesto({ ruolo, schede, indice, rami }));
  return 0;
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) process.exit(await main(process.argv.slice(2)));
