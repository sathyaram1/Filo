// Le righe che un ramo ha aggiunto al registro delle novità sotto versioni già uscite, riportate nel blocco della
// prossima versione: il gesto meccanico di ogni riallineamento (#2057). Tocca solo quel file, e non scrive mai un
// registro che, rieseguito, non dia esattamente i dati attesi. Sentinella: tests/unit/novitaInCima.test.mjs.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const SHARED = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'shared');
require(join(SHARED, 'patchNotes.js'));
require(join(SHARED, 'novitaFusione.js'));
const { cmpVersion, testo } = globalThis.SN_PATCH_NOTES;
// Lettura del sorgente e prossima versione stanno nel modulo che il server incorpora: una regola sola (#2543).
const {
  FILE, CAMPO: CAMPO_MANIFESTO, prossimaVersione: prossimaDelModulo, chiaviDoppie: doppieDelModulo,
  testoChiaviDoppie: testoDoppie, mappaSorgente, tagliaElemento, applica, modificheInCima,
} = globalThis.SN_NOVITA_FUSIONE;

export const FILE_NOVITA = FILE;
export const CAMPO = CAMPO_MANIFESTO;
const A_B_C = /^\d+\.\d+\.\d+$/;
const CHIAVI = ['features', 'fixes'];

/** La prossima versione con la regola del server che la pubblica: `prossimaVersione` di primo livello, o patch+1. `{ versione, dichiarata }` | `{ errore }`. PURA. */
export const prossimaVersione = prossimaDelModulo;
/** Le proprietà scritte due volte nello stesso blocco (#2320). `[{ version, chiave }]`; lancia se il testo non si legge. PURA. */
export const chiaviDoppie = doppieDelModulo;
/** Il motivo da stampare per le chiavi doppie di chiaviDoppie. PURA. */
export const testoChiaviDoppie = testoDoppie;

/** I blocchi del registro scritto in `src`, eseguito a parte. Lancia se il testo non è un registro. */
export function registroDa(src) {
  const sandbox = {};
  vm.runInNewContext(String(src), sandbox);
  const notes = sandbox.SN_PATCH_NOTES && sandbox.SN_PATCH_NOTES.NOTES;
  if (!Array.isArray(notes)) throw new Error('il file non registra SN_PATCH_NOTES.NOTES');
  return notes;
}

const righe = (n) => CHIAVI.flatMap((chiave) => (n[chiave] || []).map((r, indice) => ({ chiave, indice, riga: testo(r) })));

/**
 * Le righe che `dopo` aggiunge rispetto a `prima` sotto le versioni fino a `uscita` compresa, ognuna con blocco,
 * elenco e posto. Si contano le righe per blocco: riscrivere una riga già uscita, o spostarla nel blocco della
 * prossima versione, resta lecito. PURA.
 */
export function aggiunteSottoUscite(prima, dopo, uscita) {
  const vecchie = new Map(prima.map((n) => [n.version, righe(n).map((r) => r.riga)]));
  const out = [];
  for (const n of dopo) {
    if (cmpVersion(n.version, uscita) > 0) continue;
    const prec = vecchie.get(n.version) || [];
    const ora = righe(n);
    if (ora.length <= prec.length) continue;
    for (const r of ora) if (!prec.includes(r.riga)) out.push({ version: n.version, ...r });
  }
  return out;
}

/**
 * Le righe che il ramo ha scritto sotto versioni uscite su main DOPO la sua partenza (#2130): sul ramo la sentinella è
 * verde, sulla fusione rossa, e si spostano solo dopo il rebase. `versioneMain`: la versione del manifesto di main. PURA.
 */
export function sottoUsciteSuMain(prima, dopo, manifesto, versioneMain) {
  const delRamo = String((manifesto && manifesto.version) || '');
  const suMain = String(versioneMain || '');
  if (!A_B_C.test(delRamo) || !A_B_C.test(suMain) || cmpVersion(suMain, delRamo) <= 0) return [];
  return aggiunteSottoUscite(prima, dopo, suMain).map(({ version, riga }) => ({ version, riga }));
}

const json = (x) => JSON.stringify(x);

/**
 * Sposta nel blocco della prossima versione le righe che il registro `src` ha in più di `prima` sotto versioni già
 * uscite per `manifesto`; il blocco si apre in cima se non c'è, con la data `oggi`. PURA.
 * → { ok: true, src, spostate: [{ version, chiave, riga }], verso } | { ok: false, motivo }
 */
export function spostaInCima(src, { prima, manifesto, oggi }) {
  let dopo;
  try { dopo = registroDa(src); } catch (e) { return { ok: false, motivo: `il registro non si esegue: ${e.message}` }; }
  // Prima del conteggio: con una chiave doppia il blocco eseguito ha meno righe di main, e il conteggio non vede niente.
  let doppie;
  try { doppie = chiaviDoppie(src); } catch (e) { return { ok: false, motivo: `non riesco a leggere il registro: ${e.message}` }; }
  if (doppie.length) return { ok: false, motivo: testoChiaviDoppie(doppie) };
  const uscita = String((manifesto && manifesto.version) || '');
  const p = prossimaVersione(manifesto);
  if (p.errore) return { ok: false, motivo: p.errore };
  const sposta = aggiunteSottoUscite(prima, dopo, uscita);
  if (!sposta.length) return { ok: true, src, spostate: [], verso: p.versione };
  const versioni = dopo.map((n) => n.version);
  const doppia = versioni.find((v, k) => versioni.indexOf(v) !== k);
  if (doppia) return { ok: false, motivo: `il blocco ${doppia} compare due volte: sistemalo a mano, poi rilancia` };
  // Righe diverse da prima più di quelle in più: il ramo ne ha anche riscritta una già letta da chi ha quella versione,
  // e quale sia l'aggiunta non è meccanico. Spostarle tutte svuoterebbe un blocco uscito.
  for (const n of dopo) {
    const quante = sposta.filter((s) => s.version === n.version).length;
    const prec = prima.find((x) => x.version === n.version);
    if (quante > righe(n).length - (prec ? righe(prec).length : 0)) {
      return { ok: false, motivo: `nel blocco ${n.version}, già uscito, il ramo ha anche riscritto righe che c'erano: sposta a mano nel blocco ${p.versione} solo quelle aggiunte` };
    }
  }
  const sopra = dopo.filter((n) => cmpVersion(n.version, uscita) > 0);
  if (sopra.length > 1 || (sopra.length && (sopra[0] !== dopo[0] || sopra[0].version !== p.versione))) {
    return { ok: false, motivo: `sopra la versione ${uscita} ci sono i blocchi ${sopra.map((n) => n.version).join(', ')}: ne serve uno solo, ${p.versione}, in cima. Sistemalo a mano, poi rilancia` };
  }

  let mappa;
  try { mappa = mappaSorgente(src); } catch (e) { return { ok: false, motivo: `non riesco a leggere il registro: ${e.message}` }; }
  if (mappa.blocchi.length !== dopo.length) return { ok: false, motivo: 'il registro scritto e quello eseguito non hanno gli stessi blocchi' };
  for (let b = 0; b < dopo.length; b++) {
    for (const chiave of CHIAVI) {
      const n = (dopo[b][chiave] || []).length;
      const e = mappa.blocchi[b].elenchi[chiave];
      if ((e ? e.elementi.length : 0) !== n) return { ok: false, motivo: `nel blocco ${dopo[b].version} «${chiave}» scritto e eseguito non tornano` };
    }
  }

  // I dati attesi, prima del testo: il testo nuovo deve rieseguire esattamente questi.
  const attesi = JSON.parse(json(dopo));
  const via = new Set(sposta.map((s) => `${s.version}\u0000${s.chiave}\u0000${s.indice}`));
  const daPortare = { features: [], fixes: [] };
  const modifiche = [];
  for (let b = 0; b < dopo.length; b++) {
    const n = dopo[b];
    const blocco = mappa.blocchi[b];
    const tutte = righe(n);
    const partono = tutte.filter((r) => via.has(`${n.version}\u0000${r.chiave}\u0000${r.indice}`));
    if (!partono.length) continue;
    for (const r of partono) daPortare[r.chiave].push(src.slice(blocco.elenchi[r.chiave].elementi[r.indice].inizio, blocco.elenchi[r.chiave].elementi[r.indice].fine));
    if (partono.length === tutte.length) {
      modifiche.push(tagliaElemento(src, blocco, mappa.blocchi));
      attesi[b] = null;
      continue;
    }
    for (const chiave of CHIAVI) {
      const e = blocco.elenchi[chiave];
      if (!e) continue;
      const qui = partono.filter((r) => r.chiave === chiave).map((r) => r.indice);
      if (!qui.length) continue;
      attesi[b][chiave] = attesi[b][chiave].filter((_, k) => !qui.includes(k));
      if (qui.length === e.elementi.length) { modifiche.push({ da: e.apre, a: e.chiude + 1, testo: '[]' }); continue; }
      for (const k of qui) modifiche.push(tagliaElemento(src, e.elementi[k], e.elementi));
    }
  }

  const testoDi = (r) => JSON.parse(json(r));
  const portate = (chiave) => sposta.filter((s) => s.chiave === chiave).map((s) => testoDi(dopo.find((n) => n.version === s.version)[chiave][s.indice]));
  const cima = sopra[0] ? mappa.blocchi[0] : null;
  const primo = mappa.blocchi.find((_, b) => attesi[b] !== null) || mappa.blocchi[0];
  const inCima = modificheInCima(src, { cima, primo, versione: p.versione, oggi, daPortare });
  if (!inCima.ok) return { ok: false, motivo: inCima.motivo };
  modifiche.push(...inCima.modifiche);
  if (cima) {
    for (const chiave of CHIAVI) {
      if (!daPortare[chiave].length) continue;
      const nuovo = !cima.elenchi[chiave];
      attesi[0][chiave] = [...(attesi[0][chiave] || []), ...portate(chiave)];
      if (nuovo && chiave === 'features' && inCima.featuresPrimaDiFixes) {
        const voci = Object.entries(attesi[0]).filter(([k]) => k !== chiave);
        voci.splice(voci.findIndex(([k]) => k === 'fixes'), 0, [chiave, attesi[0][chiave]]);
        attesi[0] = Object.fromEntries(voci);
      }
    }
  } else {
    const nuovo = { version: p.versione, date: oggi };
    for (const chiave of CHIAVI) if (daPortare[chiave].length) nuovo[chiave] = portate(chiave);
    attesi.unshift(nuovo);
  }

  let nuovoSrc;
  try { nuovoSrc = applica(src, modifiche); } catch (e) { return { ok: false, motivo: e.message }; }
  let rieseguito;
  try { rieseguito = registroDa(nuovoSrc); } catch (e) { return { ok: false, motivo: `lo spostamento non darebbe un registro valido (${e.message}): sposta le righe a mano` }; }
  if (json(rieseguito) !== json(attesi.filter((n) => n !== null))) {
    return { ok: false, motivo: 'lo spostamento non darebbe esattamente il registro atteso: sposta le righe a mano' };
  }
  return { ok: true, src: nuovoSrc, spostate: sposta.map(({ version, chiave, riga }) => ({ version, chiave, riga })), verso: p.versione };
}

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
      + `Le sposta da sé la fusione con main, al cancello come in \`npm run finish\`: sul ramo com'è non c'è niente da correggere.`,
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
