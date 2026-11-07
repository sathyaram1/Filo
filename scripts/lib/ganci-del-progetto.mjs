// I ganci di Filo (.claude/settings*.json) riscritti per le impostazioni utente: una sessione partita fuori dal checkout,
// come la routine con più repository (#1761), non legge quelle del progetto e resterebbe senza salvataggio (#1967).
// Mai due volte lo stesso gancio: ognuno tace se il progetto della sessione ha già lo script. Regole: tests/unit/ganciDelProgetto.test.mjs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ETICHETTA_GANCI = 'filo-ganci-del-progetto';
export const FILE_IMPOSTAZIONI = Object.freeze(['settings.json', 'settings.local.json']);
// Lo script del gancio, scritto `$CLAUDE_PROJECT_DIR/<file>`: è da lì che il comando sa se il progetto lo ha già.
const SCRIPT = /\$(?:\{CLAUDE_PROJECT_DIR\}|CLAUDE_PROJECT_DIR)(\/[^"'`$\\\s;|&<>()]+)/;

const traApici = (s) => `'${String(s).split("'").join("'\\''")}'`;

/** Il comando per le impostazioni utente, con la cartella del progetto fissata a `radice`; '' se non nomina uno script. PURA. */
export function comandoFissato(comando, radice) {
  const c = String(comando || '').trim();
  const m = SCRIPT.exec(c);
  const dove = String(radice || '').split('\\').join('/').replace(/\/+$/, '');
  if (!m || !dove) return '';
  return `: ${ETICHETTA_GANCI}; [ -f "$CLAUDE_PROJECT_DIR${m[1]}" ] || { CLAUDE_PROJECT_DIR=${traApici(dove)}; export CLAUDE_PROJECT_DIR; ${c}; }`;
}

/**
 * I gruppi di ganci del checkout `radice`, evento per evento, con matcher e timeout di prima e i comandi fissati.
 * `scartati`: i comandi che non nominano uno script del progetto e quindi non si possono riportare.
 */
export function ganciDelProgetto(radice, { leggi = (f) => readFileSync(f, 'utf8') } = {}) {
  const hooks = {};
  const scartati = [];
  for (const nome of FILE_IMPOSTAZIONI) {
    let s = null;
    try { s = JSON.parse(leggi(join(radice, '.claude', nome))); } catch (_) { continue; }
    for (const [ev, gruppi] of Object.entries((s && s.hooks) || {})) {
      for (const g of Array.isArray(gruppi) ? gruppi : []) {
        const fissati = [];
        for (const h of (g && g.hooks) || []) {
          const c = h && h.type === 'command' ? comandoFissato(h.command, radice) : '';
          if (c) fissati.push({ ...h, command: c });
          else scartati.push(`${nome} ${ev}: ${String((h && (h.command || h.type)) || '')}`);
        }
        if (fissati.length) (hooks[ev] ||= []).push({ ...g, hooks: fissati });
      }
    }
  }
  return { hooks, scartati };
}

/** `hooks` delle impostazioni utente senza i gruppi riportati da un'installazione di prima, e con quelli di adesso. PURA. */
export function unisciGanci(hooks, delProgetto) {
  const suoi = (g) => ((g && g.hooks) || []).some((h) => String((h && h.command) || '').includes(ETICHETTA_GANCI));
  const fuori = {};
  for (const [ev, gruppi] of Object.entries(hooks || {})) {
    const tenuti = (Array.isArray(gruppi) ? gruppi : []).filter((g) => !suoi(g));
    if (tenuti.length) fuori[ev] = tenuti;
  }
  for (const [ev, gruppi] of Object.entries(delProgetto || {})) fuori[ev] = [...(fuori[ev] || []), ...gruppi];
  return fuori;
}
