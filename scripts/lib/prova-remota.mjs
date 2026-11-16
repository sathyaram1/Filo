// Gli unit sulla fusione provati su GitHub per il finish sul PC dell'owner (#1497.3, D-185): li esegue la corsa
// «Unit sulla fusione», senza credenziali, e il PC ne legge solo l'esito. Mai un ripiego sull'esecuzione locale.
// Sentinelle: tests/unit/provaRemota.test.mjs e tests/unit/finishUnitLontane.test.mjs.

import { execFileSync } from 'node:child_process';
import { MARCA } from '../unit-fusione-azione.mjs';
import { ESITI, gitIn, refspecMain } from './unit-sulla-fusione.mjs';

export const WORKFLOW = 'unit-fusione.yml';
export const EVENTO = 'unit-fusione';
export const JOB_ESITO = 'unit';
export const API = 'https://api.github.com';
// La parte Windows di default prova tutto: il PC dell'owner è Windows, e prima gli unit li provava tutti lui.
export const MODI_WINDOWS = Object.freeze(['tutti', 'toccati']);
export const OGNI_MS = 30 * 1000;
// La corsa compare in Actions dopo qualche secondo, a volte minuti; poi due lavori da 90 minuti al massimo più l'unione.
export const TETTO_PARTENZA_MS = 15 * 60 * 1000;
export const TETTO_CORSA_MS = 200 * 60 * 1000;
const SHA = /^[0-9a-f]{40}$/;

const primaRiga = (s) => String(s || '').split(/\r?\n/).find((r) => r.trim()) || '';
const minuti = (ms) => Math.max(1, Math.round(ms / 60000));

/** owner/repo da un indirizzo di origin su GitHub, '' se non lo è. PURA. */
export function repoDaOrigin(url) {
  const m = String(url || '').trim().match(/github\.com[:/]+([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : '';
}

/** Il modo della parte Windows: quello chiesto se è noto, se no `tutti`. PURA. */
export function modoWindows(v) {
  const s = String(v || '').trim().toLowerCase();
  return MODI_WINDOWS.includes(s) ? s : 'tutti';
}

/** Il nome della corsa, nel titolo che il workflow le dà: diverso a ogni richiesta, mai uguale a quelli del server. PURA. */
export function nomeCorsa({ ramo, main, ora = Date.now() }) {
  return `pc-${String(ramo).slice(0, 12)}-${String(main).slice(0, 12)}-${Number(ora).toString(36)}`;
}

/** Gli spec per la corsa (`tests/<nome>` → `<nome>`), separati da virgola; '' = nessuno, e la parte degli spec non parte. PURA. */
export function specPerLaCorsa(spec) {
  return (Array.isArray(spec) ? spec : []).map((s) => String(s).replace(/\\/g, '/').replace(/^tests\//, '').replace(/\.spec\.mjs$/, '')).join(',');
}

/** La richiesta per repository_dispatch. PURA. */
export function richiestaDispatch({ ramo, main, corsa, windows = 'tutti', spec = [] }) {
  const s = specPerLaCorsa(spec);
  return { event_type: EVENTO, client_payload: { ramo, main, corsa, windows: modoWindows(windows), ...(s ? { spec: s } : {}) } };
}

/** La corsa col titolo della richiesta, la più nuova. PURA. */
export function corsaDallElenco(runs, corsa) {
  const titolo = `${EVENTO} ${corsa}`;
  const trovate = (Array.isArray(runs) ? runs : []).filter((r) => r && (r.display_title === titolo || r.name === titolo));
  return trovate.sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0] || null;
}

/**
 * L'esito della coppia dal registro del lavoro che unisce: l'ultima riga che, tolto l'orario di Actions, comincia con
 * la marca, e dice la stessa coppia. PURA. → il campo | { errore }.
 */
export function campoDalRegistro(testo, { ramo, main }) {
  const righe = String(testo || '').split(/\r?\n/)
    .map((r) => r.replace(/^﻿?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/, ''))
    .filter((r) => r.startsWith(`${MARCA} `));
  if (!righe.length) return { errore: 'nel registro della corsa non c\'è la riga con l\'esito' };
  let c = null;
  try { c = JSON.parse(righe[righe.length - 1].slice(MARCA.length + 1)); } catch (_) { c = null; }
  if (!c || typeof c !== 'object') return { errore: 'la riga con l\'esito non si legge' };
  if (c.ramo !== ramo || c.main !== main) return { errore: 'la riga con l\'esito parla di un\'altra coppia di commit' };
  if (c.esito !== 'non_provata' && !ESITI.includes(c.esito)) return { errore: `esito sconosciuto: ${String(c.esito).slice(0, 40)}` };
  return c;
}

/** La prova, nella forma di provaUnitSullaFusione, dal campo letto su GitHub. PURA. */
export function provaDalCampo(c, remota = {}) {
  const dove = { remota };
  if (c.errore) return { errore: c.errore, mainSha: c.main || '', ...dove };
  if (c.esito === 'non_provata') return { errore: `la corsa su GitHub non ha provato la coppia (${String(c.motivo || 'senza motivo')})`, mainSha: c.main, ...dove };
  const out = { esito: c.esito, mainSha: SHA.test(String(c.mainSha || '')) ? c.mainSha : c.main, ...dove };
  if (Array.isArray(c.rossi)) out.rossi = c.rossi.map(String);
  if (Array.isArray(c.file)) out.file = c.file.map(String);
  if (c.storia && typeof c.storia === 'object') out.storia = c.storia;
  for (const k of ['specChiesti', 'specProvati']) if (Number.isInteger(c[k])) out[k] = c[k];
  return out;
}

/**
 * Chiesti degli spec, la corsa deve dire di averli provati tutti: un main che non sa ancora provarli risponde coi soli
 * unit, e quel verde non vale per gli spec. PURA. → la prova, o { errore }.
 */
export function conGliSpec(prova, chiesti) {
  const n = Array.isArray(chiesti) ? chiesti.length : 0;
  if (!n || prova.errore) return prova;
  if (prova.specChiesti !== n) {
    return { errore: `la corsa su GitHub non ha provato i ${n} spec delle aree toccate che le ho chiesto (ne dice ${Number.isInteger(prova.specChiesti) ? prova.specChiesti : 'nessuno'})`, mainSha: prova.mainSha || '', ...(prova.remota ? { remota: prova.remota } : {}) };
  }
  return prova;
}

/** Il token per l'API: quello dell'ambiente, o quello di GitHub CLI. '' se non c'è. */
export function tokenGitHub(env = process.env) {
  const daEnv = String(env.GH_TOKEN || env.GITHUB_TOKEN || '').trim();
  if (daEnv) return daEnv;
  try {
    return String(execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000, windowsHide: true }) || '').trim();
  } catch (_) { return ''; }
}

/** Chiamate all'API di GitHub. `fetchImpl` e `base` per le prove. */
export function apiGitHub({ token, base = process.env.FILO_GITHUB_API || API, fetchImpl = fetch } = {}) {
  const radice = String(base).replace(/\/+$/, '');
  return async function api(percorso, { metodo = 'GET', corpo = null, testo = false } = {}) {
    const r = await fetchImpl(`${radice}/${percorso.replace(/^\/+/, '')}`, {
      method: metodo,
      headers: {
        Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'filo-finish',
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
      signal: AbortSignal.timeout(60000),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`GitHub risponde ${r.status} a ${metodo} ${percorso.split('?')[0]}${t ? `: ${primaRiga(t).slice(0, 200)}` : ''}`);
    if (testo) return t;
    return t ? JSON.parse(t) : {};
  };
}

/**
 * Accende la corsa per (punta, origin/main di adesso). → { repo, ramo, main, corsa, api } | { errore }.
 * La punta dev'essere già su origin: la corsa la scarica da lì.
 */
export async function avviaProvaRemota({ root, punta, spec = [], env = process.env, git = gitIn(root), api = null, ora = Date.now() } = {}) {
  const ramo = String(punta || '').toLowerCase();
  if (!SHA.test(ramo)) return { errore: 'punta del ramo non valida' };
  const url = git(['config', '--get', 'remote.origin.url']);
  const repo = repoDaOrigin(url.ok ? url.out : '');
  if (!repo) return { errore: `origin non è un repo di GitHub (${primaRiga(url.out) || 'nessun origin'})` };
  const f = git(['fetch', '--quiet', 'origin', refspecMain()]);
  if (!f.ok) return { errore: `non riesco a scaricare main da origin (${primaRiga(f.out)})` };
  const m = git(['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}']);
  const main = m.ok ? m.out.trim().toLowerCase() : '';
  if (!SHA.test(main)) return { errore: 'non riesco a leggere lo sha di main' };
  let chiama = api;
  if (!chiama) {
    const token = tokenGitHub(env);
    if (!token) return { errore: 'nessun accesso a GitHub su questo PC: installa GitHub CLI e lancia «gh auth login», o metti un token in GH_TOKEN' };
    chiama = apiGitHub({ token, base: env.FILO_GITHUB_API || API });
  }
  const corsa = nomeCorsa({ ramo, main, ora });
  try {
    await chiama(`repos/${repo}/dispatches`, { metodo: 'POST', corpo: richiestaDispatch({ ramo, main, corsa, windows: env.FILO_FINISH_UNIT_WINDOWS, spec }) });
  } catch (e) {
    return { errore: `GitHub non ha acceso la corsa (${String((e && e.message) || e).slice(0, 300)})`, main };
  }
  return { repo, ramo, main, corsa, api: chiama, partita: ora, spec: Array.isArray(spec) ? [...spec] : [] };
}

const dormi = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Aspetta la corsa accesa da avviaProvaRemota e ne legge l'esito. → prova (vedi provaDalCampo), con `remota.url`.
 * Senza corsa, finita senza esito o oltre il tetto: { errore }, mai un esito inventato.
 */
export async function attendiProvaRemota(avvio, { scrivi = (s) => console.log(s), ogni = OGNI_MS, tettoPartenza = TETTO_PARTENZA_MS, tettoCorsa = TETTO_CORSA_MS, adesso = () => Date.now(), aspetta = dormi } = {}) {
  if (!avvio || avvio.errore) return { errore: (avvio && avvio.errore) || 'corsa non accesa', mainSha: (avvio && avvio.main) || '' };
  const { repo, ramo, main, corsa, api } = avvio;
  const inizio = adesso();
  let corsaVista = null;
  let ultimoAvviso = inizio;
  for (;;) {
    let elenco = null;
    try {
      elenco = await api(`repos/${repo}/actions/workflows/${WORKFLOW}/runs?event=repository_dispatch&per_page=50`);
    } catch (e) {
      return { errore: `non riesco a leggere le corse su GitHub (${String((e && e.message) || e).slice(0, 300)})`, mainSha: main };
    }
    corsaVista = corsaDallElenco(elenco && elenco.workflow_runs, corsa) || corsaVista;
    const remota = { corsa, url: (corsaVista && corsaVista.html_url) || '' };
    if (corsaVista && corsaVista.status === 'completed') {
      let jobs;
      try { jobs = await api(`repos/${repo}/actions/runs/${corsaVista.id}/jobs?per_page=100`); } catch (e) {
        return { errore: `non riesco a leggere i lavori della corsa (${String((e && e.message) || e).slice(0, 300)})`, mainSha: main, remota };
      }
      const job = ((jobs && jobs.jobs) || []).find((j) => j && j.name === JOB_ESITO);
      if (!job) return { errore: `la corsa è finita (${corsaVista.conclusion || 'senza conclusione'}) senza il lavoro che scrive l'esito`, mainSha: main, remota };
      let registro;
      try { registro = await api(`repos/${repo}/actions/jobs/${job.id}/logs`, { testo: true }); } catch (e) {
        return { errore: `non riesco a leggere il registro della corsa (${String((e && e.message) || e).slice(0, 300)})`, mainSha: main, remota };
      }
      const c = campoDalRegistro(registro, { ramo, main });
      return provaDalCampo(c.errore ? { ...c, main } : c, remota);
    }
    const passato = adesso() - inizio;
    if (!corsaVista && passato >= tettoPartenza) {
      return { errore: `dopo ${minuti(passato)} minuti la corsa non compare fra quelle di GitHub`, mainSha: main, remota };
    }
    if (passato >= tettoCorsa) return { errore: `la corsa non è finita in ${minuti(passato)} minuti`, mainSha: main, remota };
    if (adesso() - ultimoAvviso >= 5 * 60 * 1000) {
      ultimoAvviso = adesso();
      scrivi(`  … unit su GitHub da ${minuti(passato)} minuti (${corsaVista ? corsaVista.status : 'in coda'})${remota.url ? `: ${remota.url}` : ''}`);
    }
    await aspetta(ogni);
  }
}

/** Accende e aspetta: la prova di chiediConProva quando main si muove. */
export async function provaRemota({ root, punta, scrivi = (s) => console.log(s), ...resto } = {}) {
  scrivi('▸ Unit sulla fusione: li chiedo a GitHub, il tuo PC non li esegue');
  return attendiProvaRemota(await avviaProvaRemota({ root, punta, ...resto }), { scrivi });
}
