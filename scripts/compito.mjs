// compito.mjs — i compiti delle routine da una sessione locale (#1196, SPEC-DOMANDE.md §6.1): crea un compito senza
// feedback, li elenca, annulla uno scritto a mano. Va a ownerCompiti col segreto del biglietto locale (#1148): la
// sessione si dichiara, e il compito prende la fiducia del suo biglietto. Regole: src/shared/compiti.js.

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visibile } from './routine-domanda.mjs';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
require(join(HERE, '..', 'src', 'shared', 'compiti.js'));
const K = globalThis.SN_COMPITI;

const INDIRIZZO = 'https://europe-west1-filo-8b9cb.cloudfunctions.net/ownerCompiti';
const USO = [
  'Uso: node scripts/compito.mjs <comando>',
  `  crea --titolo "…" [--urgenza N] [--modello m] [--sforzo s] [--ambito a] [--istruzioni "…" | --istruzioni -]`,
  `                         urgenza da ${K.URGENZA.min} a ${K.URGENZA.max} (senza: ${K.URGENZA.nuovo}); modello fra ${K.MODELLI.join(', ')}; sforzo fra ${K.SFORZI.join(', ')}; ambito fra ${K.AMBITI.join(', ')} (server solo da un biglietto fidato)`,
  '  elenco                 gli aperti e in corso, nell\'ordine in cui il server li darebbe, e gli ultimi chiusi',
  '  annulla C-n            un compito scritto a mano ancora in attesa',
].join('\n');

/** Le parole della riga di comando. PURA. @returns {{ cmd, … } | { errore }} */
export function leggiArgomenti(argv) {
  const a = (Array.isArray(argv) ? argv : []).map(String);
  const cmd = a[0] || '';
  if (cmd === 'elenco') return a.length === 1 ? { cmd } : { errore: `"${a[1].slice(0, 40)}" non vale qui.\n${USO}` };
  if (cmd === 'annulla') {
    return a.length === 2 && /^C-\d{1,9}$/.test(a[1].trim()) ? { cmd, id: a[1].trim() } : { errore: `annulla vuole un compito nella forma C-12.\n${USO}` };
  }
  if (cmd === 'crea') {
    const out = { cmd, compito: { urgenza: K.URGENZA.nuovo } };
    for (let i = 1; i < a.length; i++) {
      const m = /^--(titolo|urgenza|modello|sforzo|ambito|istruzioni)(?:=(.*))?$/s.exec(a[i]);
      if (!m) return { errore: `"${a[i].slice(0, 40)}" non vale qui.\n${USO}` };
      const v = m[2] !== undefined ? m[2] : a[++i];
      if (v === undefined) return { errore: `--${m[1]} vuole un valore.` };
      out.compito[m[1]] = v;
    }
    if (out.compito.titolo === undefined) return { errore: `crea vuole --titolo "…".\n${USO}` };
    return out;
  }
  return { errore: USO };
}

/** I compiti scritti a mano non fidati: il loro titolo è testo esterno per chi lo stampa. PURA. */
export function nonFidati(compiti) {
  return (Array.isArray(compiti) ? compiti : []).filter((c) => c && c.tipo === 'manuale' && c.fiducia !== 'fidato').map((c) => String(c.id || '?'));
}

/** L'elenco per il terminale, coi caratteri di controllo resi visibili. PURA. */
export function formattaElenco(r) {
  const d = K.dividi(r);
  const riga = (c) => {
    const costo = K.costoTesto(K.costoTotale(c), K.costoParziale(c));
    const pezzi = [`u ${c.urgenza}`, K.modelloTesto(c.modello, c.sforzo), K.nomeStato(c)];
    if (c.esito) pezzi.push(c.esito);
    if (costo) pezzi.push(costo);
    return `  ${visibile(K.etichetta(c))}  [${pezzi.map((p) => visibile(String(p))).join(' · ')}]`;
  };
  const out = [];
  for (const [nome, lista] of [['In corso', d.inCorso], ['Aperti', d.inAttesa], ['Chiusi di recente', d.storico]]) {
    out.push(`${out.length ? '\n' : ''}${nome}${lista.length ? '' : ': nessuno'}`);
    for (const c of lista) out.push(riga(c));
  }
  if (r && r.altri) out.push(`\nI chiusi sono di più: qui gli ultimi ${d.storico.length}, gli altri nella scheda Routine → Compiti di Gestione.`);
  return out.join('\n');
}

/** Il motivo di un errore della callable. PURA. */
export function messaggioErrore(status, body) {
  const b = body || {};
  const err = b.error || {};
  const msg = err.message || (status === 404 ? 'la funzione ownerCompiti non esiste sul server (non ancora pubblicata?)' : `errore ${status}`);
  return visibile(msg);
}

async function chiamaOwner(data) {
  const { findAdminRefreshToken, mintIdToken } = await import('./lib/firestore-auth.mjs');
  const refresh = findAdminRefreshToken();
  if (!refresh) throw new Error('Non trovo le credenziali del proprietario (FILO_ADMIN_REFRESH_TOKEN): i compiti le vogliono.');
  const idToken = await mintIdToken(refresh);
  const res = await fetch(INDIRIZZO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body.result && body.result.ok === false)) throw new Error(`Non riuscito: ${messaggioErrore(res.status, body)}`);
  return body.result || {};
}

/** Il segreto del biglietto della sessione (il più sporco se più d'uno), '' senza: il server allora lo fa non fidato. */
async function segretoLocale() {
  const { trovaBiglietto } = await import('./lib/biglietto-locale.mjs');
  const b = await trovaBiglietto().catch(() => null);
  return b && typeof b.ticket === 'string' ? b.ticket : '';
}

async function sporcaSessione(cosa, motivi) {
  const { rigaSporco } = await import('./lib/biglietto-locale.mjs');
  return rigaSporco(cosa, motivi);
}

async function leggiStdin() {
  if (process.stdin.isTTY) return '';
  const pezzi = [];
  for await (const p of process.stdin) pezzi.push(p);
  return Buffer.concat(pezzi).toString('utf8');
}

/** Il comando intero, con l'I/O iniettabile per le prove. @returns {Promise<number>} 0 fatto, 1 rifiutato. */
export async function esegui(argv, io = {}) {
  const {
    chiama = chiamaOwner, bigliettoLocale = segretoLocale, sporca = sporcaSessione, stdin = leggiStdin,
    scrivi = (s) => console.log(s), errore = (s) => console.error(s),
  } = io;
  if (argv.some((x) => x === '--help' || x === '-h')) { scrivi(USO); return 0; }
  const a = leggiArgomenti(argv);
  if (a.errore) { errore(`RIFIUTATO: ${a.errore}`); return 1; }
  // Col token del proprietario il server non distingue una sessione dall'owner: la sessione lo dice, col suo biglietto.
  const daSessione = async () => {
    const s = await bigliettoLocale();
    return s ? { sessione: true, biglietto: s } : { sessione: true };
  };
  try {
    if (a.cmd === 'crea') {
      if (a.compito.istruzioni === '-') a.compito.istruzioni = await stdin();
      const v = K.validaNuovo(a.compito);
      if (!v.ok) { errore(`RIFIUTATO: ${v.testo} Non ho mandato niente.`); return 1; }
      const r = await chiama(Object.assign({ op: 'crea', compito: v.compito }, await daSessione()));
      scrivi(`OK: compito ${visibile(r.id || '')} creato (${r.fiducia === 'fidato' ? 'fidato' : 'non fidato'}).`);
      return 0;
    }
    if (a.cmd === 'elenco') {
      const r = await chiama({ op: 'elenco' });
      const nf = nonFidati([].concat(r.aperti || [], r.storico || []));
      if (nf.length) errore(await sporca('elenco dei compiti', [`titoli di compiti non fidati (${nf.slice(0, 10).join(', ')}${nf.length > 10 ? ', …' : ''})`]));
      scrivi(formattaElenco(r));
      return 0;
    }
    if (a.cmd === 'annulla') {
      await chiama(Object.assign({ op: 'annulla', id: a.id }, await daSessione()));
      scrivi(`OK: ${a.id} annullato.`);
      return 0;
    }
  } catch (e) {
    errore(visibile(e?.message || e));
    return 1;
  }
  errore(USO);
  return 1;
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) esegui(process.argv.slice(2)).then((code) => process.exit(code));
