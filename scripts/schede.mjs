// Le schede dei feedback aperti per il manutentore (SPEC-RIDISEGNO-LAVORO.md § 2): Haiku le scrive col ruolo scheda.md, Opus
// rilegge chi toglie lavoro e un campione. Solo in locale (token e chiave dell'owner), fuori dal repo. Test: tests/unit/schede.test.mjs.
// Uso: npm run feedback:schede -- elenca | scrivi [--solo 812,815] [--paralleli 6] | rileggi [--quota 0.1] | stato [--cartella <dir>] [--dry-run]

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { espandiInclusioni } from './lib/role-text.mjs';
import './lib/freno-letture.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CARTELLA_PREDEFINITA = resolve(ROOT, '..', 'filo-schede');
export const INDICE = 'indice.json';

export const STATI_CHIUSI = ['done', 'archived', 'attack_confirmed', 'spam_confirmed'];
export const VALIDI = ['si', 'no', 'dubbio', 'non letto'];
export const TIPI = ['bug', 'feature', 'design', 'processo', 'sicurezza', 'documento'];
export const AREE = ['chat-filo', 'home', 'editor', 'browser-schede', 'impostazioni', 'gestione-owner', 'feedback-app',
  'server-filo-security', 'routine-script', 'test', 'sito', 'pacchetti-rilasci', 'deck-builder', 'altro'];
export const CAMPI_LETTI = ['seq', 'subSeq', 'status', 'priority', 'updatedAt'];

const RILETTURA = [
  'RILETTURA. La scheda che trovi nel file l\'ha scritta un modello più piccolo. Rifai i controlli dei passi 1-3 e',
  'correggi i campi sbagliati, con le stesse regole; poi aggiungi alla scheda il campo "riletta" con una riga su cosa',
  'hai cambiato ("confermata" se niente). Riscrivi il file intero, e rispondi con la riga del passo 4.',
].join(' ');

/** Le righe lette (già decifrate) → i feedback aperti dell'indice, dal numero più basso. PURA. */
export function apertiDaRighe(righe) {
  const num = (r) => {
    const s = Number(r.seq); const sub = Number(r.subSeq);
    return Number.isInteger(s) && s > 0 ? (Number.isInteger(sub) && sub > 0 ? `${s}.${sub}` : String(s)) : '';
  };
  return (Array.isArray(righe) ? righe : [])
    .map((r) => ({
      id: String(r._id || ''), num: num(r), stato: String(r.status || '').trim(),
      priorita: Number.isInteger(Number(r.priority)) && String(r.priority).trim() !== '' ? Number(r.priority) : null,
      aggiornato: String(r.updatedAt || r._updateTime || ''),
    }))
    .filter((f) => f.id && f.num && f.stato && !STATI_CHIUSI.includes(f.stato))
    .sort((a, b) => Number(a.num) - Number(b.num));
}

/** I motivi per cui una scheda non è buona (vuoto = buona). PURA. */
export function validaScheda(s, num) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['non è un oggetto JSON'];
  const m = [];
  const testo = (k, max) => {
    if (typeof s[k] !== 'string' || !s[k].trim()) m.push(`manca «${k}»`);
    else if (max && s[k].length > max) m.push(`«${k}» è lungo ${s[k].length} caratteri, il massimo è ${max}`);
  };
  const elenco = (k, max) => {
    if (!Array.isArray(s[k]) || s[k].some((x) => typeof x !== 'string')) m.push(`«${k}» non è un elenco di testi`);
    else if (max && s[k].length > max) m.push(`«${k}» ha ${s[k].length} voci, il massimo è ${max}`);
  };
  if (String(s.numero || '').replace(/^#/, '') !== String(num)) m.push(`«numero» è ${JSON.stringify(s.numero)}, non ${num}`);
  testo('titolo_breve', 80);
  testo('riassunto', 2000);
  testo('prova', 1000);
  if (!VALIDI.includes(s.valido)) m.push(`«valido» deve essere uno fra ${VALIDI.join(', ')}`);
  if (!TIPI.includes(s.tipo) && s.valido !== 'non letto') m.push(`«tipo» deve essere uno fra ${TIPI.join(', ')}`);
  if (!AREE.includes(s.area) && s.valido !== 'non letto') m.push(`«area» deve essere una fra ${AREE.join(', ')}`);
  if (typeof s.urgente !== 'boolean') m.push('«urgente» deve essere true o false');
  elenco('file_probabili', 5);
  elenco('doppione_di');
  elenco('parole_chiave', 10);
  if (s.risolto_su_main !== null && typeof s.risolto_su_main !== 'string') m.push('«risolto_su_main» è uno sha con la riga, o null');
  if (s.valido === 'no' && !String(s.prova || '').trim()) m.push('«valido: no» vuole la prova');
  return m;
}

/** La scheda va (ri)scritta? Manca, non è buona o non ha la stessa fonte del feedback di adesso. PURA. */
export function daScrivere(f, scheda) {
  if (!scheda || validaScheda(scheda, f.num).length) return true;
  const fonte = scheda._fonte || {};
  return fonte.id !== f.id || fonte.stato !== f.stato || fonte.aggiornato !== f.aggiornato;
}

/** Cosa non va nella scheda dopo il giro di un agente: non riscritta, non buona, o una rilettura senza «riletta». PURA. */
export function difettiDopoAgente({ riscritta, scheda, num, rilettura = false }) {
  if (!riscritta) return ['l\'agente non ha riscritto la scheda'];
  return [...validaScheda(scheda, num), ...(rilettura && !String((scheda && scheda.riletta) || '').trim() ? ['manca «riletta»'] : [])];
}

/** Il campione stabile: lo stesso numero cade sempre dalla stessa parte. PURA. */
export function nelCampione(num, quota) {
  const h = createHash('sha256').update(String(num)).digest().readUInt32BE(0);
  return h / 0x100000000 < quota;
}

/**
 * Le schede da far rileggere a Opus: tutte quelle che tolgono lavoro (non valido, doppione) e un campione delle altre,
 * mai una già riletta sulla stessa fonte. PURA.
 */
export function daRileggere(schede, { quota = 0.1 } = {}) {
  return (Array.isArray(schede) ? schede : []).filter((s) => {
    if (!s || s._riletta) return false;
    const toglie = s.valido === 'no' || (Array.isArray(s.doppione_di) && s.doppione_di.length > 0);
    return toglie || nelCampione(String(s.numero || '').replace(/^#/, ''), quota);
  });
}

/** Il testo per l'agente: il ruolo della scheda, e in coda i dati di questo giro. PURA rispetto ai suoi ingressi. */
export function promptScheda(ruolo, { num, cartella, radice, rilettura = false }) {
  return [
    ruolo.trim(), '',
    `Feedback: ${num}`,
    `Cartella delle schede: ${cartella}`,
    `Radice del repo: ${radice}`,
    ...(rilettura ? ['', `${RILETTURA} Il file: ${join(cartella, `${num}.json`)}`] : []),
  ].join('\n');
}

function leggiJson(f) {
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (_) { return null; }
}
const fileScheda = (cartella, num) => join(cartella, `${num}.json`);

/** Le schede che ci sono nella cartella, lette. */
export function leggiSchede(cartella) {
  if (!existsSync(cartella)) return [];
  return readdirSync(cartella).filter((n) => /^\d+(\.\d+)?\.json$/.test(n)).map((n) => leggiJson(join(cartella, n))).filter(Boolean);
}

/** Riassunto per `stato`. PURA. */
export function riepilogo(indice, schede) {
  const per = (k) => schede.reduce((m, s) => ({ ...m, [s[k] ?? '?']: (m[s[k] ?? '?'] || 0) + 1 }), {});
  const mappa = new Map(schede.map((s) => [String(s.numero || '').replace(/^#/, ''), s]));
  const daFare = (indice || []).filter((f) => daScrivere(f, mappa.get(f.num)));
  return { aperti: (indice || []).length, schede: schede.length, daScrivere: daFare.length, daRileggere: daRileggere(schede).length, valido: per('valido'), area: per('area') };
}

/** Lancia gli agenti al più `paralleli` alla volta; `lavora(voce)` → esito. */
export async function aGruppi(voci, paralleli, lavora) {
  const esiti = new Array(voci.length);
  let prossimo = 0;
  const operaio = async () => {
    while (prossimo < voci.length) {
      const i = prossimo; prossimo += 1;
      // eslint-disable-next-line no-await-in-loop
      esiti[i] = await lavora(voci[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(paralleli, voci.length)) }, operaio));
  return esiti;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function opzione(argv, nome) {
  const i = argv.findIndex((a) => a === nome || a.startsWith(`${nome}=`));
  if (i < 0) return undefined;
  return argv[i].includes('=') ? argv[i].slice(nome.length + 1) : argv[i + 1];
}

async function elenca(cartella, dryRun) {
  const { acquireBearer } = await import('./lib/firestore-auth.mjs');
  // La pubblica prima della cifratura, come in claude-feedback.mjs.
  for (const m of ['feedbackThread.js', 'feedbackPublicKey.js', 'feedbackCrypto.js', 'feedback.js']) await import(`../src/shared/${m}`);
  const { decryptFeedbackList } = await import('./lib/decrypt-feedback-fields.mjs');
  const token = await acquireBearer();
  const r = await globalThis.SN_FEEDBACK.listAllPaged({ idToken: token, fields: CAMPI_LETTI });
  const righe = await decryptFeedbackList(r.rows);
  const indice = apertiDaRighe(righe);
  if (!dryRun) { mkdirSync(cartella, { recursive: true }); writeFileSync(join(cartella, INDICE), `${JSON.stringify(indice, null, 1)}\n`); }
  console.log(`${indice.length} feedback aperti su ${righe.length} letti${dryRun ? ' (prova a vuoto: indice non scritto)' : `: indice in ${join(cartella, INDICE)}`}.`);
  if (r.complete === false) console.error(`AVVISO: la lettura non è completa, ${righe.length} documenti: rilancia prima di scrivere le schede.`);
  console.log(`Documenti letti: ${righe.length}.`);
}

async function lanciaAgenti(voci, { cartella, modello, paralleli, rilettura, dryRun }) {
  if (!voci.length) { console.log('Niente da fare.'); return 0; }
  if (dryRun) { console.log(`(prova a vuoto) ${voci.length} agenti ${modello}, ${paralleli} alla volta: ${voci.map((v) => `#${v.num}`).join(', ')}`); return 0; }
  const { trovaClaude, argomentiClaude, leggiUscitaClaude, envFiglio, accessoDaStatus, SENZA_ACCESSO, esegui } = await import('./orchestratore-locale.mjs');
  const bin = trovaClaude();
  if (!bin) { console.error('Non trovo Claude Code da riga di comando (FILO_CLAUDE_BIN, o `claude` nel PATH). Non ho lanciato niente.'); return 3; }
  const env = envFiglio(process.env, { cwd: ROOT });
  const auth = await esegui(bin, ['auth', 'status'], { env, timeoutMs: 60_000 });
  if (!accessoDaStatus(auth.stdout)) { console.error(SENZA_ACCESSO); return 3; }
  const dirRuoli = join(ROOT, 'routines', 'roles');
  const ruolo = espandiInclusioni(readFileSync(join(dirRuoli, 'scheda.md'), 'utf8'), dirRuoli);
  let costo = 0;
  let falliti = 0;
  await aGruppi(voci, paralleli, async (v) => {
    const args = argomentiClaude({ model: modello, effort: '', nome: `scheda #${v.num}`, addDirs: [cartella] });
    // Una scheda vecchia che l'agente non riscrive resterebbe buona e verrebbe timbrata come nuova: conta l'ora del file.
    const prima = existsSync(fileScheda(cartella, v.num)) ? statSync(fileScheda(cartella, v.num)).mtimeMs : 0;
    const out = await esegui(bin, args, { cwd: ROOT, env, input: promptScheda(ruolo, { num: v.num, cartella, radice: ROOT, rilettura }), timeoutMs: 15 * 60_000 });
    const u = leggiUscitaClaude(out.stdout, out.stderr, out.code);
    costo += u.costo;
    const riscritta = existsSync(fileScheda(cartella, v.num)) && statSync(fileScheda(cartella, v.num)).mtimeMs > prima;
    const scheda = riscritta ? leggiJson(fileScheda(cartella, v.num)) : null;
    const male = difettiDopoAgente({ riscritta, scheda, num: v.num, rilettura });
    if (!u.ok || male.length) {
      falliti += 1;
      console.error(`#${v.num}: ${u.ok ? `scheda non buona (${male.join('; ')})` : `agente fallito (${u.errore.split('\n')[0]})`}: resta da rifare.`);
      return;
    }
    const { _riletta: _vecchia, ...nuova } = scheda;
    const stampata = { ...nuova, _fonte: { id: v.id, stato: v.stato, aggiornato: v.aggiornato, at: new Date().toISOString(), modello } };
    if (rilettura) stampata._riletta = { at: new Date().toISOString(), modello };
    writeFileSync(fileScheda(cartella, v.num), `${JSON.stringify(stampata, null, 1)}\n`);
    console.log(u.testo.split('\n').find((r) => r.trim()) || `#${v.num}: fatta`);
  });
  console.log(`${voci.length - falliti} schede su ${voci.length}${falliti ? `, ${falliti} da rifare (rilancia lo stesso comando)` : ''}. Costo dichiarato dagli agenti: ${costo.toFixed(2)} $.`);
  return falliti ? 3 : 0;
}

export async function main(argv) {
  const [cmd] = argv;
  const cartella = resolve(opzione(argv, '--cartella') || CARTELLA_PREDEFINITA);
  const dentro = relative(ROOT, cartella);
  if (!dentro || (!dentro.startsWith('..') && !isAbsolute(dentro))) {
    console.error('Le schede contengono il testo dei feedback: dentro il repo pubblico non le scrivo. Scegli una --cartella fuori.');
    return 1;
  }
  const dryRun = argv.includes('--dry-run');
  const paralleli = Math.max(1, Math.min(20, Number(opzione(argv, '--paralleli')) || 6));
  const indice = leggiJson(join(cartella, INDICE));
  if (cmd === 'elenca') { await elenca(cartella, dryRun); return 0; }
  if (!['scrivi', 'rileggi', 'stato'].includes(cmd)) {
    console.error('Uso: npm run feedback:schede -- elenca | scrivi [--solo 812,815] [--paralleli 6] | rileggi [--quota 0.1] | stato [--cartella <dir>] [--dry-run]');
    return 1;
  }
  if (!Array.isArray(indice)) { console.error(`Manca l'indice in ${join(cartella, INDICE)}: prima npm run feedback:schede -- elenca.`); return 1; }
  const schede = leggiSchede(cartella);
  if (cmd === 'stato') { console.log(JSON.stringify(riepilogo(indice, schede), null, 1)); return 0; }
  const perNum = new Map(indice.map((f) => [f.num, f]));
  if (cmd === 'scrivi') {
    const solo = String(opzione(argv, '--solo') || '').split(/[\s,]+/).map((n) => n.replace(/^#/, '')).filter(Boolean);
    const ignoti = solo.filter((n) => !perNum.has(n));
    if (ignoti.length) { console.error(`Non sono fra gli aperti dell'indice: ${ignoti.map((n) => `#${n}`).join(', ')}. Rilancia elenca se sono nuovi.`); return 1; }
    const mappa = new Map(schede.map((s) => [String(s.numero || '').replace(/^#/, ''), s]));
    const voci = (solo.length ? solo.map((n) => perNum.get(n)) : indice).filter((f) => solo.length || daScrivere(f, mappa.get(f.num)));
    return lanciaAgenti(voci, { cartella, modello: opzione(argv, '--modello') || 'haiku', paralleli, rilettura: false, dryRun });
  }
  const quota = Math.max(0, Math.min(1, Number(opzione(argv, '--quota') ?? 0.1)));
  const voci = daRileggere(schede, { quota }).map((s) => perNum.get(String(s.numero).replace(/^#/, ''))).filter(Boolean);
  return lanciaAgenti(voci, { cartella, modello: opzione(argv, '--modello') || 'opus', paralleli, rilettura: true, dryRun });
}

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) process.exit(await main(process.argv.slice(2)));
