// prova-test-nuovi.mjs — i casi nuovi o cambiati del ramo, corsi senza il lavoro (rosso atteso) e con (verde atteso), senza
// modello (#2505). L'esito resta accanto al clone per la consegna della stessa punta. Regole: tests/unit/provaTestNuovi.test.mjs.
// Uso: node scripts/prova-test-nuovi.mjs [--base <sha>] [--server <clone>] [--json]

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absolutizeOutput, pinnedRepoRoot } from './lib/tools-pin.mjs';
import { estremiDelLavoro, parteDelServer, ramoCorrente } from './lib/lettura-diff.mjs';
import { PROVE_SERVER, provaTestNuovi, testoDellaProva, VERSIONE } from './lib/prova-test-nuovi.mjs';

const USO = 'node scripts/prova-test-nuovi.mjs [--base <sha>] [--server <clone>] [--json]';

/** Dove resta l'esito: nella cartella di git del clone, che il salvataggio automatico non vede. */
export function fileDellEsito(root) {
  const gd = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: root, encoding: 'utf8' }).trim();
  return join(gd, 'filo-prova-test-nuovi.json');
}

const punta = (dir) => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim(); } catch (_) { return ''; } };

function esitoGrezzo(root) {
  try { return JSON.parse(readFileSync(fileDellEsito(root), 'utf8')); } catch (_) { return null; }
}

/** Il clone del server dell'ultima prova salvata, anche se non vale più: la prova rifatta lo riprende. '' se no. */
export function cloneDellUltimaProva(root) {
  const e = esitoGrezzo(root);
  return (e && e.server && typeof e.server.clone === 'string' && e.server.clone) || '';
}

/** Il clone del server se questo è un lavoro server (lì c'è un ramo con lo stesso nome, con commit suoi); '' se no. */
export function serverDelLavoro(root, { clone = '' } = {}) {
  const funzioni = clone ? '' : cartellaDelServer(root);
  const c = clone || (funzioni ? dirname(funzioni) : '');
  if (!c) return '';
  const s = parteDelServer(c, ramoCorrente(root));
  return s.head ? c : '';
}

// Dopo la prova, la riga delle novità e i testi in .md non cambiano l'esito dei test: la prova si riprende.
const SOLO_TESTI = (p) => p === 'src/shared/patchNotes.js' || (/\.md$/i.test(p) && !/^tests\//.test(p));

function soloTestiDopo(root, da, a) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', da, a], { cwd: root, stdio: 'ignore' });
    const toccati = execFileSync('git', ['diff', '--name-only', '-z', da, a], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    return toccati.every(SOLO_TESTI);
  } catch (_) { return false; }
}

/**
 * L'esito salvato, se vale ancora: la punta dell'app di allora, o una che da lì cambia solo testi; se c'era il server
 * la stessa punta del suo ramo; e in un lavoro server deve avere la parte del server. null se no.
 */
export function esitoSalvato(root) {
  const e = esitoGrezzo(root);
  const ora = punta(root);
  if (!e || e.versione !== VERSIONE || !e.app || !e.app.punta) return null;
  if (e.app.punta !== ora && !soloTestiDopo(root, e.app.punta, ora)) return null;
  if (e.server && e.server.clone && e.server.punta && punteDelServer(e.server.clone, ramoCorrente(root)) !== e.server.punta) return null;
  if (!e.server && serverDelLavoro(root)) return null;
  return e;
}

const punteDelServer = (clone, ramo) => { const s = parteDelServer(clone, ramo); return s.head || ''; };

/**
 * La prova intera (app, e server se c'è il clone), salvata accanto al clone. Senza `server` il clone si cerca da sé:
 * un lavoro server non resta mai senza la sua parte perché nessuno l'ha chiesta. { app, server? } | { errore }
 */
export function provaDelRamo(root, { base = '', server = '', log = (s) => console.error(s) } = {}) {
  const e = estremiDelLavoro(root, { base });
  if (e.errore) return { errore: e.errore };
  if (e.avviso) log(`Attenzione: ${e.avviso}.`);
  if (!server) server = serverDelLavoro(root);
  const out = { versione: VERSIONE, app: provaTestNuovi({ root, base: e.base, head: e.head, log }) };
  if (server) {
    const clone = resolve(server);
    const s = parteDelServer(clone, ramoCorrente(root));
    if (s.nonLetto) out.server = { clone, nonProvato: s.nonLetto };
    else if (s.vuoto) out.server = { clone, nonProvato: s.vuoto };
    else {
      const p = provaTestNuovi({ root: clone, base: s.base, head: s.head, prove: PROVE_SERVER, moduli: ['functions/node_modules'], cwdRel: 'functions', log });
      out.server = { clone, ...p };
    }
  }
  try { writeFileSync(fileDellEsito(root), JSON.stringify(out, null, 2) + '\n'); } catch (_) { /* la consegna la rifà */ }
  return out;
}

/** Il testo intero, app e server. PURA. */
export function testoDelRamo(e) {
  const righe = [testoDellaProva(e.app, 'App')];
  if (e.server) righe.push(e.server.nonProvato ? `Server: non provato, ${e.server.nonProvato}` : testoDellaProva(e.server, 'Server'));
  return righe.join('\n\n');
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const root = process.env.FILO_REPO_ROOT ? resolve(process.env.FILO_REPO_ROOT) : (pinnedRepoRoot() || resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  absolutizeOutput(root);
  const argv = process.argv.slice(2);
  const o = { json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') o.json = true;
    else if (['--base', '--server'].includes(argv[i]) && argv[i + 1]) o[argv[i].slice(2)] = argv[++i];
    else { console.error(`argomento non capito: ${argv[i]}. Uso: ${USO}`); process.exit(1); }
  }
  const e = provaDelRamo(root, { base: o.base, server: o.server });
  if (e.errore) { console.error(`Non riesco a provare i test nuovi: ${e.errore}.`); process.exit(3); }
  console.log(o.json ? JSON.stringify(e, null, 2) : testoDelRamo(e));
}
