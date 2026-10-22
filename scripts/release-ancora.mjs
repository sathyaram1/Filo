// release-ancora.mjs — dopo la pubblicazione chiede al server di ancorare le impronte dei file di una versione (#1501).
// Manda nomi e sha512 dei file costruiti che il latest*.yml elenca; il server li riscarica e ancora solo se coincidono.
// Garanzie: tests/unit/releaseAncora.test.mjs. Senza import locali: la ricetta lo copia dal commit della corsa.
//
// Uso: node release-ancora.mjs --piattaforma Windows|Mac|Linux --cartella dist --versione vX.Y.Z
// Uscita: 0 ancorati (o già ancorati uguali) · 2 rifiutato, insistere dà lo stesso no · 3 server assente, si riprova

import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.FILO_ROUTINE_API || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';
export const RELEASE_ANCHOR_URL = `${BASE}/releaseAnchor`;

export const YML = { Windows: 'latest.yml', Mac: 'latest-mac.yml', Linux: 'latest-linux.yml' };
const VERSIONE = /^v\d+\.\d+\.\d+$/;
const NOME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,199}$/;

function senzaVirgolette(v) {
  const s = String(v).trim();
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, '\'');
  if (/^".*"$/.test(s)) { try { return JSON.parse(s); } catch { return s; } }
  return s;
}

/** I file che un latest*.yml di electron-builder elenca: `files`, o `path` quando manca. PURA. */
export function fileDelYml(testo) {
  const voci = [];
  const cima = {};
  let inFiles = false;
  let voce = null;
  for (const riga of String(testo ?? '').split(/\r?\n/)) {
    if (!riga.trim() || /^\s*#/.test(riga)) continue;
    const alto = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(riga);
    if (alto) {
      inFiles = alto[1] === 'files' && alto[2] === '';
      voce = null;
      if (!inFiles) cima[alto[1]] = senzaVirgolette(alto[2]);
      continue;
    }
    if (!inFiles) continue;
    const inizio = /^\s+-\s+([A-Za-z0-9_]+):\s*(.*)$/.exec(riga);
    const dentro = /^\s+([A-Za-z0-9_]+):\s*(.*)$/.exec(riga);
    if (inizio) { voce = { [inizio[1]]: senzaVirgolette(inizio[2]) }; voci.push(voce); } else if (dentro && voce) voce[dentro[1]] = senzaVirgolette(dentro[2]);
  }
  const lista = voci.length ? voci.map((v) => ({ nome: v.url, sha512: v.sha512 })) : cima.path ? [{ nome: cima.path, sha512: cima.sha512 }] : [];
  return lista.map((f) => ({ nome: typeof f.nome === 'string' ? f.nome : '', sha512: typeof f.sha512 === 'string' ? f.sha512 : '' }));
}

export function sha512DelFile(file) {
  return new Promise((ok, no) => {
    const h = createHash('sha512');
    createReadStream(file).on('error', no).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('base64')));
  });
}

/**
 * I file da ancorare per una piattaforma, controllati qui prima di chiedere: ognuno c'è e ha l'impronta che il yml dice.
 * Ritorna { file } o { errore }.
 */
export async function fileDaAncorare({ cartella, piattaforma }) {
  const nomeYml = YML[piattaforma];
  if (!nomeYml) return { errore: `piattaforma sconosciuta: ${piattaforma}` };
  const percorsoYml = join(cartella, nomeYml);
  if (!existsSync(percorsoYml)) return { errore: `manca ${nomeYml} in ${cartella}` };
  const file = fileDelYml(readFileSync(percorsoYml, 'utf8'));
  if (!file.length) return { errore: `${nomeYml} non elenca nessun file` };
  for (const f of file) {
    if (!NOME.test(f.nome) || f.nome.includes('..')) return { errore: `nome fuori forma in ${nomeYml}: ${JSON.stringify(f.nome).slice(0, 120)}` };
    if (!f.sha512) return { errore: `${f.nome} non ha sha512 in ${nomeYml}` };
    const percorso = join(cartella, f.nome);
    if (!existsSync(percorso)) return { errore: `${nomeYml} elenca ${f.nome}, che in ${cartella} non c'è` };
    const vero = await sha512DelFile(percorso);
    if (vero !== f.sha512) return { errore: `${f.nome} costruito non ha l'impronta che ${nomeYml} dichiara` };
  }
  return { file };
}

/** Dalla risposta grezza del server a un esito con un nome. PURA. */
export function classificaAncora(status, body) {
  const b = body || {};
  const reason = String(b.reason || '') || `http_${status}`;
  if (status === 200 && b.ok === true) {
    const nomi = (v) => (Array.isArray(v) ? v.map(String) : []);
    return { outcome: 'done', ancorati: nomi(b.ancorati), gia: nomi(b.gia) };
  }
  if (status === 409) return { outcome: 'conflict', reason };
  if (status === 400) return { outcome: 'rejected', reason };
  if (status === 401 || status === 403) return { outcome: 'denied', reason };
  if (status === 404) return { outcome: 'not_deployed', reason };
  if (status === 0 || status === 429 || status >= 500) return { outcome: 'unreachable', reason };
  return { outcome: 'fault', reason };
}

export function exitCodeAncora(reply) {
  switch ((reply || {}).outcome) {
    case 'done': return 0;
    case 'conflict':
    case 'rejected':
    case 'denied':
    case 'no_passphrase':
    case 'local': return 2;
    default: return 3;
  }
}

/** Cosa legge chi guarda il registro della corsa. PURA. */
export function messaggioAncora(reply, versione = '?') {
  const r = reply || {};
  switch (r.outcome) {
    case 'done':
      return `[release-ancora] ${versione}: ancorati ${r.ancorati.length ? r.ancorati.join(', ') : 'nessuno nuovo'}`
        + `${r.gia.length ? `; già ancorati uguali: ${r.gia.join(', ')}` : ''}.`;
    case 'conflict':
      return `[release-ancora] RIFIUTATO (${r.reason}): un file di ${versione} è già ancorato con un'altra impronta. `
        + 'Il server ha aperto un allarme; quel file non si ripubblica con lo stesso nome, serve una versione nuova.';
    case 'rejected':
      return `[release-ancora] RIFIUTATO (${r.reason}): allegato, yml e impronta di questa corsa non coincidono. `
        + `Niente ancorato: chi ha già Filo con l'àncora non installa ${versione}.`;
    case 'denied':
      return '[release-ancora] RIFIUTATO: il server non riconosce la parola d\'ordine della costruzione (FILO_BUILD_PASSPHRASE, ambiente «rilascio»).';
    case 'no_passphrase':
      return '[release-ancora] RIFIUTATO: manca FILO_BUILD_PASSPHRASE, non posso nemmeno chiedere.';
    case 'local':
      return `[release-ancora] non chiedo niente: ${r.reason}.`;
    case 'not_deployed':
      return '[release-ancora] il server non espone (ancora) l\'àncora delle release: vanno pubblicate le funzioni di sicurezza.';
    case 'unreachable':
      return `[release-ancora] server non raggiungibile (${r.reason}): niente ancorato.`;
    default:
      return `[release-ancora] guasto: ${r.reason || 'senza motivo'}. Niente ancorato.`;
  }
}

/** Una richiesta al server, ritentata se non risponde: la versione è già pubblica, e senza àncora non si installa. */
export async function chiediAncora({ passphrase, versione, piattaforma, file, fetchImpl = fetch, url = RELEASE_ANCHOR_URL,
  attese = [15000, 45000], dormi = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!passphrase) return { outcome: 'no_passphrase' };
  let reply = null;
  for (let i = 0; i <= attese.length; i++) {
    if (i > 0) await dormi(attese[i - 1]);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase, versione, piattaforma, file }),
      });
      const text = await res.text();
      let body = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
      reply = classificaAncora(res.status, body);
    } catch (e) {
      reply = { outcome: 'unreachable', reason: String((e && e.message) || e).slice(0, 200) };
    }
    if (reply.outcome !== 'unreachable') return reply;
  }
  return reply;
}

function argomenti(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(piattaforma|cartella|versione)$/.exec(argv[i]);
    if (m) out[m[1]] = argv[++i];
  }
  return out;
}

export async function main(argv = process.argv.slice(2), env = process.env, opzioni = {}) {
  const { piattaforma, cartella = 'dist', versione } = argomenti(argv);
  let reply;
  if (!VERSIONE.test(String(versione || ''))) reply = { outcome: 'local', reason: `versione fuori forma: ${JSON.stringify(versione)}` };
  else {
    const locale = await fileDaAncorare({ cartella, piattaforma });
    if (locale.errore) reply = { outcome: 'local', reason: locale.errore };
    else {
      // Spazi e a capo ai bordi il server non li perdona (#1210, vedi parolaDellaCostruzione in build-alarm.mjs).
      const passphrase = String(env.FILO_BUILD_PASSPHRASE || '').trim();
      reply = await chiediAncora({ passphrase, versione, piattaforma, file: locale.file, ...opzioni });
    }
  }
  console.error(messaggioAncora(reply, versione));
  return exitCodeAncora(reply);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
}
