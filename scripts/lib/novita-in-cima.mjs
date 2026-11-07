// Le righe di un ramo sotto versioni già uscite riportate nel blocco della prossima versione, nel clone (#2057): la
// regola pura sta in src/shared/novitaInCima.js, che il server incorpora; qui git, file e testi per chi lancia.
// Sentinella: tests/unit/novitaInCima.test.mjs.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// La regola si carica al primo uso: chi importa questo modulo solo di passaggio (dispatch, via la prova sulla fusione)
// gira anche da una copia degli strumenti senza src/shared.
let regola = null;
const N = () => {
  if (!regola) {
    require(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shared', 'novitaInCima.js'));
    regola = globalThis.SN_NOVITA_IN_CIMA;
  }
  return regola;
};

// Uguali a quelle della regola (la sentinella le confronta): servono anche senza caricarla.
export const FILE_NOVITA = 'src/shared/patchNotes.js';
export const CAMPO = 'prossimaVersione';
export const BASTA_SPOSTARE = Object.freeze(['verde', 'rosso_anche_su_main']);

export const prossimaVersione = (manifesto) => N().prossimaVersione(manifesto);
/** I blocchi del registro scritto in `src`, letti come dati senza eseguirlo. Lancia se il testo non è un registro. */
export const registroDa = (src) => N().leggiRegistro(src);
export const aggiunteSottoUscite = (prima, dopo, uscita) => N().aggiunteSottoUscite(prima, dopo, uscita);
export const sottoUsciteSuMain = (prima, dopo, manifesto, versioneMain) => N().sottoUsciteSuMain(prima, dopo, manifesto, versioneMain);
export const spostaInCima = (src, opzioni) => N().spostaInCima(src, opzioni);

/**
 * Nel clone `root`: confronta il registro col punto in cui il ramo si stacca da main e, con `commit`, sposta e committa
 * il solo registro; senza, dice soltanto cosa sposterebbe (`soloLettura`). Non lavora a metà di un rebase o con il
 * registro già modificato fuori dai commit.
 * → { ok, spostate, verso, commit, motivo, soloLettura?, inAttesa?, uscitaSuMain? } (inAttesa: vedi sottoUsciteSuMain)
 */
export function riportaInCima(root, { commit = false, basi = ['origin/main', 'main'], oggi = new Date().toISOString().slice(0, 10), aMeta = () => '', identita = null, exec = execFileSync } = {}) {
  const git = (args) => String(exec('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }));
  const no = (motivo) => ({ ok: false, spostate: [], verso: '', commit: '', motivo });
  const percorso = join(root, FILE_NOVITA);
  // Un deposito senza registro (le prove degli strumenti) non ha niente da spostare.
  if (!existsSync(percorso)) return { ok: true, spostate: [], verso: '', commit: '', motivo: '' };
  const inCorso = aMeta(root);
  if (inCorso) return no(`${inCorso} è a metà: finiscila, poi rilancia`);
  let base = '';
  let refMain = '';
  for (const ref of basi) {
    try { base = git(['merge-base', 'HEAD', ref]).trim(); } catch (_) { base = ''; }
    if (base) { refMain = ref; break; }
  }
  if (!base) return no(`non trovo dove il ramo si stacca da ${basi.join(' o ')}`);
  let prima;
  try { prima = registroDa(git(['show', `${base}:${FILE_NOVITA}`])); } catch (e) { return no(`non leggo il registro a ${base.slice(0, 9)}: ${String(e.stderr || e.message || e).trim().split('\n')[0]}`); }
  let manifesto;
  let src;
  try {
    manifesto = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    src = readFileSync(percorso, 'utf8');
  } catch (e) { return no(`non leggo il registro o il manifesto: ${e.message}`); }
  const r = spostaInCima(src, { prima, manifesto, oggi });
  if (!r.ok) return no(r.motivo);
  // Solo un avviso: un main illeggibile non ferma lo spostamento che sul ramo si può fare.
  let uscitaSuMain = '';
  try { uscitaSuMain = String(JSON.parse(git(['show', `${refMain}:package.json`])).version || ''); } catch (_) { uscitaSuMain = ''; }
  const inAttesa = sottoUsciteSuMain(prima, registroDa(r.src), manifesto, uscitaSuMain);
  const attesa = inAttesa.length ? { inAttesa, uscitaSuMain } : {};
  if (!r.spostate.length) return { ok: true, spostate: [], verso: r.verso, commit: '', motivo: '', ...attesa };
  // Senza `commit` si guarda soltanto: chi verifica lo lancia per riconoscere il caso, e il suo ramo non deve cambiare.
  if (!commit) return { ok: true, spostate: r.spostate, verso: r.verso, commit: '', motivo: '', soloLettura: true, ...attesa };
  if (git(['status', '--porcelain', '--', FILE_NOVITA]).trim()) {
    return no(`${FILE_NOVITA} ha già modifiche fuori dai commit: committale o toglile, poi rilancia`);
  }
  writeFileSync(percorso, r.src, 'utf8');
  const chi = identita ? ['-c', `user.name=${identita.nome}`, '-c', `user.email=${identita.email}`] : [];
  try {
    git([...chi, 'commit', '-q', '-m', `novità: ${r.spostate.length === 1 ? 'una riga del ramo' : `${r.spostate.length} righe del ramo`} da versioni uscite al blocco ${r.verso}`, '--', FILE_NOVITA]);
  } catch (e) {
    return { ok: false, spostate: r.spostate, verso: r.verso, commit: '', motivo: `spostate ma non committate: ${String(e.stderr || e.message || e).trim().split('\n')[0]}` };
  }
  return { ok: true, spostate: r.spostate, verso: r.verso, commit: git(['rev-parse', 'HEAD']).trim(), motivo: '', ...attesa };
}

/** Le righe da stampare per un esito di riportaInCima. PURA. */
export function testoRiportaInCima(r) {
  if (!r.ok) return [`Novità: righe del ramo non spostate. ${r.motivo}`];
  const attesa = Array.isArray(r.inAttesa) ? r.inAttesa : [];
  const dopo = attesa.length ? [
    `Novità: ${attesa.length === 1 ? 'una riga del ramo sta' : `${attesa.length} righe del ramo stanno`} sotto la ${r.uscitaSuMain}, uscita su main dopo la partenza del ramo. `
      + `Dopo il rebase su main le sposta questo strumento, e in routine lo fa da sé il riallineamento che precede la fusione: sul ramo com'è non c'è niente da correggere.`,
    ...attesa.map((s) => `  in ${s.version}: ${s.riga.slice(0, 100)}`),
  ] : [];
  if (!r.spostate.length) return dopo.length ? dopo : [`Novità: nessuna riga del ramo sotto una versione già uscita.`];
  if (r.soloLettura) {
    return [
      `Novità: ${r.spostate.length === 1 ? 'una riga del ramo sta' : `${r.spostate.length} righe del ramo stanno`} sotto versioni già uscite alla partenza del ramo e ${r.spostate.length === 1 ? 'va' : 'vanno'} nel blocco ${r.verso}. `
        + 'Non ho toccato niente: le sposta e le committa `node scripts/novita-in-cima.mjs --commit`.',
      ...r.spostate.map((s) => `  in ${s.version}: ${s.riga.slice(0, 100)}`),
      ...dopo,
    ];
  }
  return [
    `Novità: ${r.spostate.length === 1 ? 'una riga del ramo era' : `${r.spostate.length} righe del ramo erano`} sotto versioni già uscite, ora ${r.spostate.length === 1 ? 'sta' : 'stanno'} nel blocco ${r.verso}${r.commit ? ` (commit ${r.commit.slice(0, 9)})` : ''}:`,
    ...r.spostate.map((s) => `  da ${s.version}: ${s.riga.slice(0, 100)}`),
    ...dopo,
  ];
}
