// Le regole pure della prova da utente (tests/agent/prova.mjs): argomenti, testi per Haiku, lettura delle sue mosse,
// chi l'ha servito, esito e resoconto. Niente Electron né processi qui. Prove: tests/unit/provaDaUtente.test.mjs.

import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractJson } from './llm.mjs';

const require = createRequire(import.meta.url);
require(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shared', 'politicaModelli.js'));
const POLITICA = globalThis.SN_POLITICA_MODELLI;

export const TETTO_PASSI = 20;
export const TETTO_MINUTI = 4;
export const MODI = ['utente', 'chat'];
export const AZIONI = ['clic', 'destro', 'doppio', 'scrivi', 'tasto', 'scorri', 'aspetta', 'fine'];
export const ATTESA_MAX_S = 15;

export const USO = [
  'Uso: npm run test:prova -- --compito "<cosa deve riuscire a fare un utente, in una frase>"',
  '       [--modo utente|chat] [--start <indirizzo>] [--out <cartella>] [--passi N] [--minuti N] [--modello <alias>]',
  '  utente: Haiku usa Filo con clic e tasti. chat: lo chiede a parole nella chat di Filo e guarda se Filo lo fa.',
  `  Si lancia in sottofondo: si ferma da solo dopo ${TETTO_PASSI} passi o ${TETTO_MINUTI} minuti e scrive esito.md nella cartella.`,
].join('\n');

/** Gli argomenti → { ok, opzioni } o { ok: false, errore }. PURA. */
export function leggiArgomenti(argv) {
  const o = { compito: '', modo: 'utente', start: '', out: '', passi: TETTO_PASSI, minuti: TETTO_MINUTI, modello: 'haiku' };
  const valore = (i, nome) => {
    const v = argv[i + 1];
    if (v === undefined || String(v).startsWith('--')) throw new Error(`${nome} vuole un valore`);
    return String(v);
  };
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--compito') o.compito = valore(i++, a).trim();
      else if (a === '--modo') o.modo = valore(i++, a).trim();
      else if (a === '--start') o.start = valore(i++, a).trim();
      else if (a === '--out') o.out = valore(i++, a);
      else if (a === '--modello') o.modello = valore(i++, a).trim();
      else if (a === '--passi' || a === '--minuti') {
        const n = Number(valore(i++, a));
        if (!Number.isFinite(n) || n <= 0) throw new Error(`${a} vuole un numero maggiore di zero`);
        o[a.slice(2)] = n;
      } else throw new Error(`argomento sconosciuto: ${a}`);
    }
  } catch (e) {
    return { ok: false, errore: e.message };
  }
  if (!o.compito) return { ok: false, errore: 'manca --compito: cosa deve riuscire a fare un utente, in una frase' };
  if (!MODI.includes(o.modo)) return { ok: false, errore: `--modo è «utente» o «chat», non «${o.modo}»` };
  o.passi = Math.floor(o.passi);
  if (o.passi < 1) return { ok: false, errore: '--passi vuole almeno 1 passo' };
  if (!o.modello) return { ok: false, errore: '--modello vuoto' };
  return { ok: true, opzioni: o };
}

const FORMA = `Rispondi SEMPRE e SOLO con un oggetto JSON, una mossa per volta:
{"vedo": "una frase su cosa mostra lo schermo ORA",
 "azione": "clic | destro | doppio | scrivi | tasto | scorri | aspetta | fine",
 "segno": <numero del badge, per clic, destro, doppio; per scrivi se prima va cliccato un campo>,
 "testo": "<il testo da scrivere, per scrivi>",
 "tasto": "<per tasto: Enter, Escape, Tab, Control+t…>",
 "dy": <pixel, per scorri: positivo giù, negativo su>,
 "secondi": <per aspetta, da 1 a ${ATTESA_MAX_S}>,
 "esito": "riuscito | non_riuscito  (solo con fine)",
 "perche": "<con fine: cosa hai visto che lo dimostra, in una frase>"}`;

/** Il prompt di sistema per Haiku nel modo dato. PURA. */
export function sistema(modo) {
  const comune = `Sei una persona normale che usa Filo, un browser desktop. Ricevi a ogni passo la SCHERMATA della finestra,
con BADGE NUMERATI rossi sugli elementi che si possono cliccare, e l'elenco di quei badge. In alto c'è la barra delle
schede, sotto la pagina della scheda attiva. Filo non somiglia del tutto agli altri browser: guarda la schermata.
Hai un compito da portare a termine in modo normale, come farebbe chiunque: niente casi limite, niente tentativi strani.
Una mossa per volta; dopo ogni mossa ricevi la schermata nuova. Se qualcosa sta caricando, aspetta.
Quando il compito è riuscito e lo VEDI sullo schermo, chiudi con fine ed esito riuscito. Se dopo tentativi ragionevoli
non ci riesci, o la funzione non risponde, chiudi con fine ed esito non_riuscito e di' a quale passo si è fermato.
Non dichiarare riuscito quello che non vedi.`;
  const chat = `
In questa prova il compito NON lo fai tu a mano: lo CHIEDI a Filo a parole. Trova la chat di Filo (nella home, il campo
dove si scrive a Filo), scrivi la richiesta come la scriverebbe una persona, inviala (Enter) e guarda se Filo la porta a
termine. Filo risponde in qualche secondo: aspetta. Puoi guardare il risultato (anche cliccando), ma se Filo non lo fa
l'esito è non_riuscito anche se a mano ci riusciresti.`;
  return `${comune}${modo === 'chat' ? chat : ''}\n\n${FORMA}`;
}

/** L'elenco dei badge per il modello. PURA. */
export function segniInTesto(map) {
  if (!map.length) return '(nessun elemento cliccabile riconosciuto)';
  return map.map((m) => `#${m.i} [${m.page}] ${m.tag}${m.label ? ` "${String(m.label).replace(/\s+/g, ' ')}"` : ''}`).join('\n');
}

/** Il testo di un passo. PURA. */
export function messaggioPasso({ compito, passo, passi, secondiRestanti, map, notaUltima = '' }) {
  return [
    `COMPITO: ${compito}`,
    `Passo ${passo} di ${passi}, restano circa ${Math.max(0, Math.round(secondiRestanti))} secondi.`,
    notaUltima ? `Nota sulla mossa di prima: ${notaUltima}` : '',
    `Badge sullo schermo ORA:\n${segniInTesto(map)}`,
    'Rispondi col JSON.',
  ].filter(Boolean).join('\n\n');
}

/**
 * La risposta del modello → { ok, mossa } o { ok: false, errore } con l'errore da rimandargli. `segni` sono i numeri dei
 * badge validi. PURA.
 */
export function leggiMossa(testo, segni) {
  const j = extractJson(String(testo || ''));
  if (!j || typeof j !== 'object') return { ok: false, errore: 'la risposta non era un oggetto JSON' };
  const azione = String(j.azione || '').trim().toLowerCase();
  if (!AZIONI.includes(azione)) return { ok: false, errore: `azione «${azione}» sconosciuta: usa una di ${AZIONI.join(', ')}` };
  const vedo = String(j.vedo || '').trim().slice(0, 400);
  const mossa = { azione, vedo };
  const validi = new Set(segni);
  // Le mosse senza badge arrivano spesso con "segno": 0; i badge partono da 1, quindi 0 vale «nessuno».
  const usaSegno = ['clic', 'destro', 'doppio', 'scrivi'].includes(azione);
  const grezzo = usaSegno ? j.segno : null;
  const segno = grezzo === undefined || grezzo === null || grezzo === '' || Number(grezzo) === 0 ? null : Number(grezzo);
  if (segno !== null && !validi.has(segno)) return { ok: false, errore: `il badge #${grezzo} non c'è sullo schermo` };
  if (['clic', 'destro', 'doppio'].includes(azione)) {
    if (segno === null) return { ok: false, errore: `${azione} vuole il numero di un badge in "segno"` };
    mossa.segno = segno;
  } else if (azione === 'scrivi') {
    if (typeof j.testo !== 'string' || !j.testo) return { ok: false, errore: 'scrivi vuole il testo in "testo"' };
    mossa.testo = j.testo;
    if (segno !== null) mossa.segno = segno;
  } else if (azione === 'tasto') {
    const t = String(j.tasto || '').trim();
    if (!t) return { ok: false, errore: 'tasto vuole il nome in "tasto"' };
    mossa.tasto = t;
  } else if (azione === 'scorri') {
    const dy = Number(j.dy);
    mossa.dy = Number.isFinite(dy) && dy !== 0 ? Math.max(-3000, Math.min(3000, Math.round(dy))) : 400;
  } else if (azione === 'aspetta') {
    const s = Number(j.secondi);
    mossa.secondi = Number.isFinite(s) ? Math.max(1, Math.min(ATTESA_MAX_S, s)) : 3;
  } else {
    const e = String(j.esito || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (e !== 'riuscito' && e !== 'non_riuscito') return { ok: false, errore: 'fine vuole "esito": "riuscito" o "non_riuscito"' };
    mossa.esito = e;
    mossa.perche = String(j.perche || '').trim().slice(0, 600);
  }
  return { ok: true, mossa };
}

/** Una mossa in una riga, per il resoconto. PURA. */
export function rigaMossa(m) {
  switch (m.azione) {
    case 'clic': case 'destro': case 'doppio': return `${m.azione} sul badge #${m.segno}${m.etichetta ? ` («${m.etichetta}»)` : ''}`;
    case 'scrivi': return `scrive «${m.testo.length > 80 ? `${m.testo.slice(0, 80)}…` : m.testo}»${m.segno ? ` nel badge #${m.segno}` : ''}`;
    case 'tasto': return `preme ${m.tasto}`;
    case 'scorri': return `scorre di ${m.dy} px`;
    case 'aspetta': return `aspetta ${m.secondi} s`;
    case 'fine': return `chiude: ${m.esito === 'riuscito' ? 'riuscito' : 'non riuscito'}`;
    default: return m.azione;
  }
}

/**
 * Chi ha servito le risposte, dal `modelUsage` dell'uscita di Claude Code → { modelli, fornitore, violazione }. Il
 * fornitore 'firstParty' è Anthropic stessa; ogni altro (Bedrock, Vertex…) per un modello Anthropic la politica non lo
 * ammette (`servedPolicyViolation`, la stessa regola dell'app). PURA.
 */
export function servitoDa(modelUsage) {
  const voci = Object.entries(modelUsage || {});
  const modelli = voci.map(([id, u]) => String((u && u.canonicalModel) || id));
  const fornitori = [...new Set(voci.map(([, u]) => String((u && u.provider) || '')))];
  const nome = (p) => (p === 'firstParty' ? 'Anthropic' : p);
  const fornitore = fornitori.map(nome).filter(Boolean).join(', ');
  let violazione = '';
  for (const [id, u] of voci) {
    const v = POLITICA.servedPolicyViolation(nome(String((u && u.provider) || '')), `anthropic/${(u && u.canonicalModel) || id}`, POLITICA.DEFAULT_EXCLUDED_PROVIDERS);
    if (v) { violazione = `${(u && u.canonicalModel) || id} servito da «${nome(u.provider)}» (${v})`; break; }
  }
  return { modelli, fornitore, violazione };
}

/**
 * L'esito della prova → { esito: 'riuscito'|'non riuscito'|'fermo'|'interrotto', riga, codice }. `fine` è la mossa di
 * chiusura del modello, `tetto` 'passi' o 'tempo' se si è fermato lì, `errore` un guasto dello strumento o del modello.
 * PURA.
 */
export function esitoFinale({ fine = null, passi = [], tetto = '', errore = '', opzioni = {} }) {
  const n = passi.length;
  const ultimo = passi[n - 1];
  const dove = ultimo ? ` Ultima schermata vista: ${ultimo.vedo || '(non descritta)'}` : '';
  if (errore) return { esito: 'interrotto', codice: 3, riga: `Interrotto al passo ${n || 1}: ${errore}` };
  if (fine && fine.esito === 'riuscito') return { esito: 'riuscito', codice: 0, riga: `Riuscito in ${n} passi: ${fine.perche || '(senza motivo)'}` };
  if (fine) return { esito: 'non riuscito', codice: 1, riga: `Non riuscito, fermo al passo ${n}: ${fine.perche || '(senza motivo)'}` };
  const quale = tetto === 'tempo' ? `il tetto dei ${opzioni.minuti || TETTO_MINUTI} minuti` : `il tetto dei ${opzioni.passi || TETTO_PASSI} passi`;
  return { esito: 'fermo', codice: 1, riga: `Fermo: raggiunto ${quale} al passo ${n} senza una conclusione.${dove}` };
}

/** Il resoconto in Markdown della cartella. PURA. */
export function resoconto({ opzioni, esito, passi, servito, costo, secondi, finale }) {
  const righe = [
    `# Prova da utente: ${esito.esito}`,
    '',
    `- Compito: ${opzioni.compito}`,
    `- Modo: ${opzioni.modo === 'chat' ? 'chiedendo a Filo nella chat' : 'da utente, con clic e tasti'}`,
    `- Esito: ${esito.riga}`,
    `- Modello: ${servito.modelli.join(', ') || opzioni.modello}, servito da ${servito.fornitore || 'non riportato'}${servito.violazione ? ` (FUORI POLITICA: ${servito.violazione})` : ''}`,
    `- Durata: ${Math.round(secondi)} s, costo dichiarato ${Number(costo || 0).toFixed(4)} $ (nella quota della sessione)`,
    '',
    'Il giudizio del modello è un indizio, non una prova: guarda le schermate e decidi tu.',
    '',
    '## Passi',
    '',
    ...passi.map((p) => `${p.n}. ${p.vedo || '(nessuna descrizione)'} → ${rigaMossa(p.mossa || { azione: '?' })}${p.nota ? ` (${p.nota})` : ''}  \n   ![passo ${p.n}](${p.schermata})`),
    ...(finale ? ['', `Schermata finale: ![finale](${finale})`] : []),
    '',
  ];
  return righe.join('\n');
}

/** Gli argomenti di `claude -p` per il modello che prova: niente strumenti, niente impostazioni, niente sessione. PURA. */
export function argomentiModello(modello, prompt) {
  return [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--model', modello, '--tools=', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '',
    '--system-prompt', prompt,
  ];
}
