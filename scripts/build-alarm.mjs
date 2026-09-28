// build-alarm.mjs — apre un feedback quando la pubblicazione si ferma.
//
// PERCHÉ ESISTE
//   Quando i controlli automatici sono rossi la versione non esce, e gli utenti
//   restano sull'ultima buona. Se nessuno lo dice, quella è una pubblicazione
//   che si ferma IN SILENZIO: l'owner se ne accorge giorni dopo, chiedendosi
//   perché non arrivano più aggiornamenti. Questo allarme diventa un feedback in
//   coda, e al giro successivo qualcuno lo prende in carico come qualsiasi altro
//   lavoro.
//
//   Prima lo faceva uno script della coda su git. Smontata quella, senza questo
//   l'allarme sarebbe semplicemente sparito — ed è successo: per un tratto il
//   cancello rosso bloccava la pubblicazione senza lasciare niente.
//
// LA CREDENZIALE
//   La stessa della costruzione (`FILO_BUILD_PASSPHRASE`), che non apre altro:
//   non legge feedback, non ne tocca di esistenti, non chiede lavoro alle
//   routine. Apre un feedback di forma fissa e basta.
//
// IL TETTO DEL TESTO
//   Il server tiene i primi 10.000 caratteri e taglia il resto senza dirlo.
//   Il testo della suite rossa (premessa, fino a ottanta righe di rossi, la
//   coda del verdetto) ci arriva vicino, e con molti rossi lo supera: il
//   taglio si fa QUI, prima di spedire, e si dice nel testo stesso, con il
//   numero (giro del 14/09, terza verifica). Un taglio muto mangia proprio
//   la parte che serviva a chi prende il feedback.
//
// USO
//   node scripts/build-alarm.mjs "<titolo>" "<testo>" [--chiave <k>]… [--chiavi-da <file>]
//                                [--chiavi-unit <registro TAP>]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.FILO_ROUTINE_API
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

/** Quanti caratteri di testo il server tiene (functions/index.js, buildAlarm). */
export const TETTO_TESTO = 10000;

/**
 * Il testo entro il tetto del server: intero se ci sta; altrimenti tagliato
 * con, in coda, la riga che dice che è stato tagliato e quanto era lungo.
 * Il risultato non supera mai `max`. PURA.
 */
export function testoEntroIlTetto(text, max = TETTO_TESTO) {
  const s = String(text || '');
  if (s.length <= max) return s;
  const nota = `\n\n… testo tagliato a ${max} caratteri (era di ${s.length}): il resto sta nel registro e nell'artifact di questa esecuzione (Actions).`;
  return s.slice(0, Math.max(0, max - nota.length)) + nota;
}

/** I tetti delle chiavi del contratto di buildAlarm: quante, e quanto lunghe. */
export const TETTO_CHIAVI = 100;
export const TETTO_CHIAVE = 200;

/**
 * Le chiavi dicono al server COSA è rotto: un allarme le cui chiavi stanno già
 * in un feedback aperto non ne apre un altro, uno con una chiave nuova sì.
 * Stringhe senza bordi, non vuote, senza doppioni, entro i tetti. PURA.
 */
export function normalizzaChiavi(chiavi) {
  const out = [];
  for (const c of Array.isArray(chiavi) ? chiavi : []) {
    if (typeof c !== 'string') continue;
    const k = c.trim().slice(0, TETTO_CHIAVE);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Quanti caratteri di titolo il server tiene (il resto lo taglia senza dirlo). */
export const TETTO_TITOLO = 200;

/**
 * Il guasto di una chiave in parole brevi, per il titolo: il file di prova o di test rosso.
 * Stringa vuota per le chiavi il cui titolo dice già il guasto (bake, piattaforma, rilascio). PURA.
 */
export function nomeDelGuasto(chiave) {
  const k = String(chiave || '').trim();
  if (k === 'suite:fuori-dai-casi') return 'errori fuori dai casi';
  if (k === 'suite:non-partita') return 'suite non partita';
  if (k === 'suite:rossi-noti') return 'elenco dei rossi noti illeggibile';
  const m = k.match(/^suite:(?:tests\/)?(.+?)(?:\.spec\.m?js)?$/) || k.match(/^unit:(?:tests\/unit\/)?(.+?)(?:\.test\.m?js)?$/);
  return m ? m[1] : '';
}

/**
 * Il titolo con i guasti fra parentesi, così due feedback aperti per guasti diversi non si chiamano uguali.
 * Entro il tetto del server: se i nomi non ci stanno tutti, il taglio si dice («e altri N»). PURA.
 */
export function titoloCoiGuasti(titolo, chiavi, max = TETTO_TITOLO) {
  const base = String(titolo || '');
  const nomi = [...new Set(normalizzaChiavi(chiavi).map(nomeDelGuasto).filter(Boolean))];
  if (!nomi.length) return base;
  for (let n = nomi.length; n >= 1; n -= 1) {
    const altri = nomi.length - n;
    const t = `${base} (${nomi.slice(0, n).join(', ')}${altri ? ` e altri ${altri}` : ''})`;
    if (t.length <= max) return t;
  }
  const t = `${base} (${nomi.length} guasti)`;
  return t.length <= max ? t : base;
}

/**
 * Le chiavi del cancello unit dal suo registro TAP: `unit:<file>` per ogni file
 * delle righe `location:`, relativo a `radice` e con le barre normali (il
 * runner è Windows: barre rovesciate, a volte raddoppiate, e la lettera del
 * disco). Nessun file riconoscibile → `unit`, perché l'allarme ne vuole una. PURA.
 */
export function chiaviDelRegistroUnit(registro, radice = '') {
  const base = String(radice || '').replace(/\\+/g, '/').replace(/\/+$/, '').toLowerCase();
  const chiavi = [];
  for (const riga of String(registro || '').split(/\r?\n/)) {
    const m = riga.match(/^\s*location:\s*['"]?(.+?)['"]?\s*$/);
    if (!m) continue;
    let file = m[1].replace(/\\+/g, '/').replace(/(:\d+){1,2}$/, '');
    if (base && file.toLowerCase().startsWith(`${base}/`)) file = file.slice(base.length + 1);
    else if (file.includes('/tests/')) file = file.slice(file.lastIndexOf('/tests/') + 1);
    if (!file || /^([a-z]:)?\//i.test(file)) continue;
    chiavi.push(`unit:${file}`);
  }
  const uniche = normalizzaChiavi(chiavi);
  return uniche.length ? uniche : ['unit'];
}

/**
 * Titolo, testo e opzioni delle chiavi. `--chiave` si ripete; `--chiavi-da`
 * legge un file con una chiave per riga; `--chiavi-unit` le ricava dal
 * registro del cancello unit. PURA.
 */
export function leggiArgomenti(argv) {
  const out = { posizionali: [], chiavi: [], chiaviDa: [], chiaviUnit: [] };
  const campi = { '--chiave': 'chiavi', '--chiavi-da': 'chiaviDa', '--chiavi-unit': 'chiaviUnit' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (campi[a]) {
      if (argv[i + 1] === undefined) throw new Error(`${a} vuole un valore`);
      out[campi[a]].push(argv[i + 1]);
      i += 1;
    } else if (/^--chiav/.test(a)) {
      throw new Error(`Opzione non capita: ${a}. Opzioni: --chiave <k>, --chiavi-da <file>, --chiavi-unit <registro>`);
    } else {
      out.posizionali.push(a);
    }
  }
  return out;
}

/**
 * Spedisce l'allarme e ferma il processo se non arriva. La usa anche
 * `release-platform-alarm.mjs`: una sola strada verso il server, una sola
 * credenziale, un solo taglio del testo.
 */
export async function inviaAllarme(name, text, chiavi = []) {
  if (!(await spedisciAllarme(name, text, chiavi))) process.exit(1);
}

/** Come inviaAllarme, ma dice se è arrivato invece di fermare il processo: per chi deve proseguire comunque. */
export async function spedisciAllarme(name, text, chiavi = []) {
  const passphrase = process.env.FILO_BUILD_PASSPHRASE;

  if (!passphrase) {
    console.error('[allarme] FILO_BUILD_PASSPHRASE assente: non posso avvisare nessuno.');
    return false;
  }
  if (!name) {
    console.error('[allarme] titolo assente: non spedisco un feedback senza nome.');
    return false;
  }

  const testo = testoEntroIlTetto(text || '');
  if (testo.length < String(text || '').length) {
    console.error(`[allarme] testo di ${String(text).length} caratteri, il server ne tiene ${TETTO_TESTO}: tagliato, e il taglio è scritto in coda al testo.`);
  }

  let keys = normalizzaChiavi(chiavi);
  if (keys.length > TETTO_CHIAVI) {
    console.error(`[allarme] ${keys.length} chiavi, il server ne tiene ${TETTO_CHIAVI}: spedisco le prime, le altre non fermano i doppioni.`);
    keys = keys.slice(0, TETTO_CHIAVI);
  }
  if (keys.length) console.log(`[allarme] chiavi: ${keys.join(', ')}`);
  const titolo = titoloCoiGuasti(name, keys);

  try {
    const res = await fetch(`${BASE}/buildAlarm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Senza chiavi il campo non parte: il server resta al comportamento di prima.
      body: JSON.stringify({ passphrase, name: titolo, text: testo, ...(keys.length ? { keys } : {}) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      console.error(`[allarme] non consegnato (${res.status}${body.reason ? ' ' + body.reason : ''}).`);
      return false;
    }
    if (body.duplicate) {
      console.log(`[allarme] già coperto da un feedback aperto${body.num ? ` (${body.num})` : ''}: nessun feedback nuovo.`);
    } else {
      console.log(`[allarme] feedback aperto${body.num ? ` (${body.num})` : ''}: ${titolo}`);
    }
    return true;
  } catch (e) {
    console.error(`[allarme] server non raggiungibile: ${e.message}`);
    return false;
  }
}

async function main() {
  let arg;
  try {
    arg = leggiArgomenti(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.message || e));
    process.exit(1);
  }
  const [name, text] = arg.posizionali;
  if (!name) {
    console.error('Uso: node scripts/build-alarm.mjs "<titolo>" "<testo>" [--chiave <k>]… [--chiavi-da <file>] [--chiavi-unit <registro>]');
    process.exit(1);
  }
  // Un file che manca non ferma l'allarme: meglio un feedback senza chiavi che nessuno.
  const leggi = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
  const chiavi = [...arg.chiavi];
  for (const f of arg.chiaviDa) chiavi.push(...leggi(f).split(/\r?\n/));
  for (const f of arg.chiaviUnit) chiavi.push(...chiaviDelRegistroUnit(leggi(f), process.cwd()));
  await inviaAllarme(name, text, chiavi);
}

const eseguitoDirettamente = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (eseguitoDirettamente) await main();
