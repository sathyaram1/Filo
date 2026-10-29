// Git verso filo-security da un comando fisso del canale, su due strade (ROUTINE-AUTH-SPEC.md § 14): in locale col token
// del biglietto nell'URL riscritto, mai in argv, nel clone o a video (#1233); in cloud col proxy della sessione, che
// autentica da sé i repository agganciati (#1761). Sentinella: tests/unit/gitServer.test.mjs.

import { isAbsolute, relative, resolve } from 'node:path';

export const URL_SERVER = 'https://github.com/sathyaram1/filo-security.git';
const URL_NUDO = URL_SERVER.replace(/\.git$/, '');
export const AZIONI_GIT_SERVER = ['clone', 'ls-remote', 'fetch', 'push'];

/** 'proxy' nelle sessioni cloud, dove una credenziale nostra non è detto che passi il proxy (#1519); 'token' altrove. PURA. */
export function stradaGitServer(env = {}) {
  return env.CLAUDE_CODE_REMOTE === 'true' || env.GH_TOKEN === 'proxy-injected' ? 'proxy' : 'token';
}

/** L'ambiente del git figlio sulla strada del proxy: quello della sessione, aiutanti compresi, senza prompt. PURA. */
export function ambienteViaProxy(base) {
  return { ...(base || {}), GIT_TERMINAL_PROMPT: '0' };
}

/** Il clone cade dentro il checkout di Filo? L'hook di salvataggio lo pubblicherebbe intero. PURA. */
export function cloneDentroIlRepo(clone, root) {
  const norm = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  const r = relative(norm(root), norm(clone));
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
}

/** Le voci che decidono con quali credenziali e verso dove parla git: quelle del proxy non valgono per filo-security. PURA. */
export function voceDiAccesso(chiave) {
  const k = String(chiave || '').toLowerCase();
  return k.startsWith('credential.') || k === 'core.askpass'
    || (k.startsWith('http.') && k.endsWith('.extraheader'))
    || (k.startsWith('url.') && (k.endsWith('.insteadof') || k.endsWith('.pushinsteadof')));
}

/** L'origin di un clone è filo-security, con o senza `.git`? PURA. */
export function originDelServer(url) {
  const u = String(url || '').trim();
  return u === URL_SERVER || u === URL_NUDO;
}

/** Un URL da mostrare: l'eventuale utente:segreto prima della chiocciola non si stampa. PURA. */
export function urlSenzaSegreti(url) {
  return String(url || '').replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1***@');
}

/** Il nome di un ramo da passare a git: niente opzioni, refspec, `..` o forzature. PURA. */
export function ramoAccettabile(ramo) {
  const r = String(ramo || '');
  return /^[A-Za-z0-9._/-]+$/.test(r) && !r.startsWith('-') && !r.startsWith('/') && !r.endsWith('/')
    && !r.endsWith('.lock') && !r.includes('..') && !r.includes('//');
}

/** L'URL del repo con dentro il token, come utente `x-access-token`. Solo per l'ambiente del git figlio. PURA. */
export function urlConToken(token, url = URL_SERVER) {
  return String(url).replace(/^(https?:\/\/)/i, `$1x-access-token:${encodeURIComponent(token)}@`);
}

/** Il testo che git stampa, senza il token in nessuna forma e senza credenziali negli URL. PURA. */
export function senzaToken(testo, token) {
  let t = String(testo || '');
  for (const f of token ? [...new Set([token, encodeURIComponent(token)])] : []) t = t.split(f).join('***');
  return t.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s'"]*@/gi, '$1***@');
}

/**
 * Chi ha respinto git, dal suo stderr: dietro il proxy della sessione un rifiuto può non venire da GitHub, e dirlo di
 * GitHub svia la diagnosi (#1233). → 'proxy' | 'github' | 'ignoto' (rifiuto non firmato) | '' (non è un rifiuto). PURA.
 */
export function chiHaRespinto(stderr) {
  const t = String(stderr || '');
  if (/from proxy|returned error: 407|^remote:.*proxy/im.test(t)) return 'proxy';
  if (/^remote:.*(repository not found|invalid username or (password|token)|permission to \S+ denied|write access to repository not granted|password authentication|support for password)/im.test(t)) return 'github';
  if (/authentication failed|could not read username|returned error: 40[134]|not found/i.test(t)) return 'ignoto';
  return '';
}

/**
 * Le voci di git che fanno passare il token, e solo lui, verso filo-security. Senza token: solo gli azzeramenti, e
 * l'URL del repo resta sé stesso. `url` cambia solo nelle prove: il comando non lo espone. PURA.
 */
export function vociGitServer(token, url = URL_SERVER) {
  const voci = [['credential.helper', ''], ['core.askPass', '']];
  if (token) voci.push(['transfer.credentialsInUrl', 'allow']);
  for (const u of [url, url.replace(/\.git$/, '')]) {
    // Il riscrittore più lungo vince: quello sull'URL intero batte quelli del proxy su github.com, anche in spinta.
    const verso = token ? urlConToken(token, u) : u;
    voci.push([`url.${verso}.insteadOf`, u], [`url.${verso}.pushInsteadOf`, u]);
    // Un valore vuoto azzera le intestazioni raccolte dai file: nessuna Authorization estranea accanto al token.
    voci.push([`http.${u}.extraHeader`, '']);
  }
  return voci;
}

/**
 * L'ambiente del git figlio. Via askpass e aiutanti del proxy (ambiente e file di configurazione), tenute le altre voci
 * (certificati, proxy di rete), in coda le nostre, che le variabili d'ambiente fanno valere dopo ogni file. PURA.
 * → { env, tolte: [nomi] }: i nomi servono alla diagnosi, i valori non si mostrano mai.
 */
export function ambienteGitServer(base, token, url = URL_SERVER) {
  const env = { ...(base || {}) };
  const tolte = [];
  for (const k of ['GIT_ASKPASS', 'SSH_ASKPASS', 'GIT_CONFIG_PARAMETERS', 'GIT_TRACE_REDACT']) {
    if (k in env) { delete env[k]; tolte.push(k); }
  }
  const tenute = [];
  const n = Number.parseInt(env.GIT_CONFIG_COUNT, 10);
  for (let i = 0; Number.isInteger(n) && i < n; i++) {
    const k = env[`GIT_CONFIG_KEY_${i}`];
    if (k === undefined) continue;
    if (voceDiAccesso(k)) tolte.push(k);
    else tenute.push([k, env[`GIT_CONFIG_VALUE_${i}`] ?? '']);
  }
  for (const k of Object.keys(env)) if (/^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$/.test(k)) delete env[k];
  const voci = [...tenute, ...vociGitServer(token, url)];
  env.GIT_CONFIG_COUNT = String(voci.length);
  voci.forEach(([k, v], i) => { env[`GIT_CONFIG_KEY_${i}`] = k; env[`GIT_CONFIG_VALUE_${i}`] = v; });
  env.GIT_TERMINAL_PROMPT = '0';
  return { env, tolte };
}

/**
 * Cosa lanciare per `git-server <azione> <cartella> [<ramo>]`. `clonato`: la cartella ha già un `.git`. PURA.
 * → { errore } | { argv, dir, controllaOrigin, nota? }
 */
export function pianoGitServer({ azione, cartella, ramo, root, clonato = false } = {}) {
  if (!AZIONI_GIT_SERVER.includes(azione)) return { errore: `git-server vuole un'azione fra ${AZIONI_GIT_SERVER.join(', ')}.` };
  if (!String(cartella || '').trim()) return { errore: 'git-server vuole la cartella del clone di filo-security, fuori dal checkout di Filo.' };
  const dir = resolve(String(cartella));
  if (root && cloneDentroIlRepo(dir, root)) {
    return { errore: `la cartella ${dir} sta dentro il checkout di Filo (${resolve(root)}), che si pubblica: il clone va fuori.` };
  }
  const r = String(ramo || '').trim();
  if (r && !ramoAccettabile(r)) return { errore: `«${r}» non è un nome di ramo che git-server passa a git.` };
  if (azione === 'push') {
    if (!r) return { errore: 'git-server push vuole il ramo da spingere.' };
    if (r === 'main' || r === 'master') return { errore: 'su main di filo-security non si spinge: lo porta lì il cancello.' };
  }
  if (azione === 'clone' && !clonato) {
    if (r) return { errore: 'git-server clone prende solo la cartella: il ramo si sceglie dopo, nel clone.' };
    return { argv: ['clone', URL_SERVER, dir], dir, controllaOrigin: false };
  }
  if (!clonato) return { errore: `in ${dir} non c'è un clone: prima git-server clone.` };
  const passi = {
    clone: ['fetch', 'origin'],
    'ls-remote': ['ls-remote', 'origin', r || 'HEAD'],
    fetch: ['fetch', 'origin', ...(r ? [r] : [])],
    push: ['push', 'origin', `refs/heads/${r}:refs/heads/${r}`],
  };
  const nota = azione === 'clone' ? `il clone c'è già in ${dir}: lo aggiorno con fetch.` : '';
  return { argv: ['-C', dir, ...passi[azione]], dir, controllaOrigin: true, ...(nota ? { nota } : {}) };
}
