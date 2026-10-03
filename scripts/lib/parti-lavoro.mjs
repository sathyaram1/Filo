// Le parti di un lavoro locale, app e server (#915): la pratica si chiude quando tutte sono su main, e una parte che
// arriva a pratica già chiusa dall'altra vale solo per poco. Il server applica le stesse regole (localWork.js di
// filo-security, prova di coppia lì). Test: tests/unit/partiLavoro.test.mjs.

import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';

export const PARTI = Object.freeze(['app', 'server']);
export const FINESTRA_PARTE_TARDIVA_MS = 48 * 60 * 60 * 1000;
export const NOME_PARTE = Object.freeze({ app: 'dell’app', server: 'del server' });

export const RAMO_RE = /^claude\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/**
 * `localMerges` dai campi REST del feedback: { app?: ms, server?: ms }, le parti già su main, `solo` se una parte
 * ha chiuso la pratica dicendo che il lavoro stava tutto lì (server:fondi --solo-server), `ramo` quello dell'ultima
 * parte fusa. PURA.
 */
export function partiDaCampi(fields) {
  const m = fields?.localMerges?.mapValue?.fields || {};
  const out = {};
  for (const p of PARTI) {
    const v = m[p];
    const at = Number(v?.integerValue ?? v?.doubleValue);
    if (Number.isFinite(at) && at > 0) out[p] = at;
  }
  if (PARTI.includes(m.solo?.stringValue)) out.solo = m.solo.stringValue;
  if (RAMO_RE.test(m.ramo?.stringValue || '')) out.ramo = m.ramo.stringValue;
  return out;
}

/**
 * La parte `parte`, dal ramo `ramo`, può usare la pratica chiusa? Solo se è un lavoro locale, l'ha chiusa la fusione
 * dell'altra parte da meno di FINESTRA_PARTE_TARDIVA_MS, questa non è ancora su main e il ramo ha lo stesso nome di
 * quello fuso: lo stesso nome è come si riconoscono le parti di un lavoro (#915). `solo`: chi fonde dice che il
 * lavoro sta tutto in questa parte. Il mittente provato lo controlla chi chiama. PURA.
 * @returns {{ ok: true, altra: string, at: number } | { ok: false, motivo: string }}
 */
export function parteTardiva({ status, parti = {}, parte, ramo = '', solo = false, locale = false, ora = Date.now() } = {}) {
  const no = (motivo) => ({ ok: false, motivo });
  if (status !== 'done') return no(`la pratica non è chiusa (stato «${status || 'assente'}»)`);
  if (!PARTI.includes(parte)) return no(`parte sconosciuta: ${parte}`);
  if (!locale) return no('manca il segno «solo in locale»');
  const altra = PARTI.find((p) => p !== parte);
  if (parti[parte]) return no(`la parte ${NOME_PARTE[parte]} di questo lavoro è già su main`);
  if (!parti[altra]) return no(`non l’ha chiusa la fusione della parte ${NOME_PARTE[altra]} di un lavoro locale`);
  // Lavoro dichiarato tutto da una parte sola: l'altra non ha un seguito, e nessun ramo può farsi passare per lui.
  if (parti.solo === altra) return no(`l’ha chiusa la parte ${NOME_PARTE[altra]} dicendo che il lavoro stava tutto lì`);
  if (solo) return no(`dici che il lavoro sta tutto nella parte ${NOME_PARTE[parte]}, ma la pratica l’ha chiusa la fusione della parte ${NOME_PARTE[altra]}: non è di questo lavoro`);
  if (!parti.ramo) return no(`non dice quale ramo l’ha chiusa, quindi non so se è di questo lavoro`);
  if (parti.ramo !== ramo) {
    return no(`l’ha chiusa la fusione di ${parti.ramo}, e vale solo per la parte ${NOME_PARTE[parte]} con lo stesso nome di ramo, non per ${ramo || 'un ramo senza nome'}`);
  }
  const eta = ora - parti[altra];
  if (eta > FINESTRA_PARTE_TARDIVA_MS || eta < -10 * 60 * 1000) {
    return no(`la parte ${NOME_PARTE[altra]} è su main da più di ${FINESTRA_PARTE_TARDIVA_MS / 3600000} ore`);
  }
  return { ok: true, altra, at: parti[altra] };
}

const RAMO_RE = /^claude\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/**
 * La parte del server che manca: il ramo di filo-security con lo stesso nome di quello dell'app, se c'è e non è
 * ancora su origin/main del server. `cartellaServer` = filo-security/functions ('' = server assente).
 * @returns {{ part: 'server', branch: string }[]}
 */
export function partiServerInSospeso(ramo, { cartellaServer = '', git = gitIn } = {}) {
  if (!cartellaServer || !RAMO_RE.test(String(ramo || '')) || /\.\./.test(ramo)) return [];
  const radice = dirname(cartellaServer);
  const ref = [`refs/heads/${ramo}`, `refs/remotes/origin/${ramo}`]
    .find((r) => git(radice, ['rev-parse', '--verify', '--quiet', r]) !== null);
  if (!ref) return [];
  if (git(radice, ['merge-base', '--is-ancestor', ref, 'refs/remotes/origin/main']) !== null) return [];
  return [{ part: 'server', branch: ramo }];
}

function gitIn(cwd, args) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (_) { return null; }
}
