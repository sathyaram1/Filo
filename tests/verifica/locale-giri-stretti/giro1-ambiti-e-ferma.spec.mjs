// Prove del giro 1 (verifica locale) sul lavoro «giri stretti»: il meccanismo.
// Non aprono Filo: qui si prova cosa riceve chi verifica (testo e perimetro per
// ambito), la strada locale della chiusura e la porta `--ferma` della consegna.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const carica = (rel) => import(pathToFileURL(resolve(ROOT, rel)).href);

function dispatch(args) {
  const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts/dispatch.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

const REPORT = 'Ho corretto il rilievo sul salvataggio e lasciato stare il resto, che chiede una decisione.';

test('ogni ambito consegna un testo di ruolo diverso, e un ambito storto vale la verifica piena', async () => {
  const d = await carica('scripts/dispatch.mjs');
  const pieno = d.readRoleInstructions('verifier', { scope: 'pieno' });
  const chiusura = d.readRoleInstructions('verifier', { scope: 'chiusura' });
  const riall = d.readRoleInstructions('verifier', { scope: 'riallineamento' });
  expect(pieno).toContain('verifica avversariale');
  expect(chiusura).toContain('controllo di chiusura');
  expect(riall).toContain('controllo dopo un riallineamento');
  expect(new Set([pieno, chiusura, riall]).size).toBe(3);
  // Nessuna inclusione rimasta da espandere, e il metro dei livelli c'è in tutti.
  for (const t of [pieno, chiusura, riall]) {
    expect(t).not.toMatch(/includi:/);
    expect(t).toContain('## Il livello di ogni rilievo');
    expect(t).toContain('--record-verifier');
  }
  // I giri stretti dicono cosa vale un difetto fuori perimetro.
  for (const t of [chiusura, riall]) expect(t).toContain('## Fuori dal perimetro');
  // Mai meno verifica per un valore storto.
  for (const storto of ['Chiusura', 'chiusura2', '  ', null, undefined, 42, {}, '__proto__', 'constructor']) {
    expect(d.readRoleInstructions('verifier', { scope: storto })).toBe(pieno);
    expect(d.buildPayload({ role: 'verifier' }, { scope: storto }).scope).toBe('pieno');
  }
});

test('il perimetro arriva come testo leggibile, e un dato storto non diventa un comando', async () => {
  const d = await carica('scripts/dispatch.mjs');
  const ch = d.perimetroNote('chiusura', {
    rilievi: [{ level: 2, text: 'Il pulsante non salva col titolo vuoto' }, { level: 1, decision: true, text: 'bordo grigio' }],
    shaPrima: 'abc1234def',
  });
  expect(ch).toContain('## Perimetro di questo giro');
  expect(ch).toContain('[2] Il pulsante non salva col titolo vuoto');
  expect(ch).toContain('[1?] bordo grigio');
  expect(ch).toContain('git diff abc1234def..HEAD');

  // Uno sha che non è uno sha non finisce nel comando da copiare.
  const cattivo = d.perimetroNote('chiusura', { rilievi: [{ level: 2, text: 'x' }], shaPrima: 'abc1234; rm -rf /' });
  expect(cattivo).not.toContain('rm -rf');
  expect(cattivo).toContain('non comunicato');

  // Perimetro assente: lo si dice, non si tace.
  const vuoto = d.perimetroNote('chiusura', null);
  expect(vuoto).toContain('non comunicati');

  const ri = d.perimetroNote('riallineamento', { shaVerificato: 'ABCDEF1234', reportRebase: 'Conflitto in due punti.\nNon ho toccato la logica.' });
  expect(ri).toContain('git diff ABCDEF1234..HEAD');
  expect(ri).toContain('> Conflitto in due punti.');
  expect(ri).toContain('> Non ho toccato la logica.');
  expect(d.perimetroNote('riallineamento', {})).toContain('nessun report');
  expect(d.perimetroNote('pieno', { rilievi: [{ level: 2, text: 'x' }] })).toBe('');
});

test('dal server il perimetro viaggia solo verso chi verifica', async () => {
  const d = await carica('scripts/dispatch.mjs');
  const busta = { payload: { scope: 'riallineamento', perimetro: { shaVerificato: 'abcdef12' }, feedback: { text: 'x' } } };
  expect(d.serverCtx({ role: 'verifier' }, busta)).toMatchObject({ scope: 'riallineamento', perimetro: { shaVerificato: 'abcdef12' } });
  expect(d.serverCtx({ role: 'fixer' }, busta)).not.toHaveProperty('scope');
  expect(d.serverCtx({ role: 'new-work' }, busta)).not.toHaveProperty('perimetro');
});

test('in locale la chiusura vale solo con l’interruttore acceso e subito dopo una correzione', async () => {
  const v = await carica('scripts/verify-local.mjs');
  const caps = { cap2: 3, cap1: 1, cap0: 0 };
  const ramo = 'claude/prova';
  let s = v.withRequest({}, ramo, { request: 'fai la cosa', sha: 'a'.repeat(40) });
  expect(v.ambitoLocale({ ...caps, giroStretto: true }, s[ramo])).toBe('pieno'); // primo giro: sempre pieno

  const c = v.withCritique(s, ramo, { critique: 'Provato il cammino principale, funziona quasi tutto.\n[2] Il pulsante non salva col titolo vuoto.\n    Passi: apri, svuota, salva.', sha: 'a'.repeat(40), caps });
  expect(c.ok).toBe(true);
  expect(c.outcome).toBe('fix');
  const f = v.withFixed(c.state, ramo, { report: REPORT, sha: 'b'.repeat(40) });
  expect(f.ok).toBe(true);
  s = v.withRequest(f.state, ramo, { request: 'fai la cosa', sha: 'b'.repeat(40) });

  // Spento di serie: assente, false o un valore storto = verifica piena.
  for (const g of [undefined, false, 'true', 1, null]) expect(v.ambitoLocale({ ...caps, giroStretto: g }, s[ramo])).toBe('pieno');
  expect(v.ambitoLocale({ ...caps, giroStretto: true }, s[ramo])).toBe('chiusura');

  const brief = v.buildVerifierBrief({ request: 'fai la cosa', branch: ramo, recipe: v.readRecipe(ROOT, 'chiusura'), history: [], scope: 'chiusura', perimetro: s[ramo].chiusura });
  expect(brief).toContain('controllo di chiusura');
  expect(brief).toContain('## Perimetro di questo giro');
  expect(brief).toContain('[2] Il pulsante non salva col titolo vuoto.');
  expect(brief).toContain(`git diff ${'a'.repeat(40)}..HEAD`);
  // Il compito pieno non porta né il perimetro né il testo stretto.
  const briefPieno = v.buildVerifierBrief({ request: 'fai la cosa', branch: ramo, recipe: v.readRecipe(ROOT, 'pieno'), history: [], scope: 'pieno', perimetro: s[ramo].chiusura });
  expect(briefPieno).not.toContain('Perimetro di questo giro');
  expect(briefPieno).toContain('verifica avversariale');

  // Rilanciare start (compito perso) resta chiusura; dopo un pass si torna al pieno.
  const s2 = v.withRequest(s, ramo, { request: 'fai la cosa', sha: 'b'.repeat(40) });
  expect(v.ambitoLocale({ ...caps, giroStretto: true }, s2[ramo])).toBe('chiusura');
  const p = v.withCritique(s2, ramo, { critique: 'Rifatti i passi del rilievo: ora il salvataggio avviene anche col titolo vuoto. Tutto chiuso.', sha: 'b'.repeat(40), caps });
  expect(p.outcome).toBe('pass');
  const s3 = v.withRequest(p.state, ramo, { request: 'fai la cosa', sha: 'c'.repeat(40) });
  expect(v.ambitoLocale({ ...caps, giroStretto: true }, s3[ramo])).toBe('pieno');
});

test('--ferma: parte solo con una segnalazione vera, e solo sulla consegna della correzione', async () => {
  const dir = cartellaTemporanea('giri-stretti-ferma');
  const seg = join(dir, 'seg.md');
  const vuoto = join(dir, 'vuoto.md');
  writeFileSync(seg, '## Problema\nprova\n');
  writeFileSync(vuoto, '   \n');

  let r = dispatch(['--record-fixed', 'abc', REPORT, '--ferma']);
  expect(r.code).toBe(1);
  expect(r.out).toContain('--ferma vuole anche --segnala');

  r = dispatch(['--record-fixed', 'abc', REPORT, '--segnala', vuoto, '--ferma']);
  expect(r.code).toBe(1);
  expect(r.out).toContain('non ho consegnato niente');

  // Scritta storta: si ferma, non consegna una correzione normale al posto dello stop.
  for (const storta of ['--Ferma', '—ferma', '--fermo']) {
    r = dispatch(['--record-fixed', 'abc', REPORT, '--segnala', seg, storta]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('Argomento non capito');
  }

  // Sulle altre consegne non esiste.
  r = dispatch(['--record-verifier', 'abc', 'Provato tutto quanto e funziona bene davvero, nessun rilievo trovato qui dentro.', '--ferma']);
  expect(r.code).toBe(1);
  expect(r.out).toContain('Argomento non capito');

  // In regola (in qualunque ordine): passa i controlli locali e arriva fino al biglietto.
  for (const args of [[REPORT, '--segnala', seg, '--ferma'], [REPORT, '--ferma', '--segnala', seg], ['--ferma', REPORT, '--segnala', seg]]) {
    r = dispatch(['--record-fixed', 'abc', ...args]);
    expect(r.out).not.toContain('Argomento non capito');
    expect(r.out).not.toContain('--ferma vuole');
  }

  const d = await carica('scripts/dispatch.mjs');
  expect(d.fixedPayload({ report: 'r', segnalazione: 's', ferma: true }).stop).toBe(true);
  expect(d.fixedPayload({ report: 'r', segnalazione: 's' })).not.toHaveProperty('stop');
  expect(d.fixedReplyText('abc', { outcome: 'stop' }, true)).toContain('FERMATO');
  // Un server che non conferma lo stop: chi ha fermato lo deve sapere.
  expect(d.fixedReplyText('abc', {}, true)).toContain('ATTENZIONE');
});

test('chiusura dopo un riallineamento a main: chi verifica sa che il diff porta anche le modifiche di main', async () => {
  // In locale `start` riallinea il ramo a main PRIMA di consegnare il compito: il commit
  // di partenza è quello di prima del rebase, e il diff fino a HEAD contiene anche main.
  const v = await carica('scripts/verify-local.mjs');
  const brief = v.buildVerifierBrief({
    request: 'x', branch: 'claude/prova', recipe: v.readRecipe(ROOT, 'chiusura'), history: [], scope: 'chiusura',
    perimetro: { rilievi: [{ level: 2, text: 'Il pulsante non salva' }], shaPrima: 'a'.repeat(40) },
  });
  const dopoIlDiff = brief.slice(brief.indexOf('Il codice cambiato dalla correzione'));
  expect(dopoIlDiff).toMatch(/\bmain\b/);
});

test('senza rete l’app non dà per letto «giro stretto spento»', async () => {
  const { createRequire } = await import('node:module');
  const D = createRequire(import.meta.url)(resolve(ROOT, 'src/main/services/defaultsStore.js'));
  const vero = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  let letto = null;
  try { letto = await D.getRoutineCaps('tok'); } catch (_) { letto = null; } finally { globalThis.fetch = vero; }
  // O si rifiuta di rispondere, o dice «non lo so»: mai un false che sembra del server.
  expect(letto === null || letto.giroStretto !== false).toBe(true);
});

test('chi corregge viene a sapere che può fermarsi: la risposta alla critica nomina --ferma', async () => {
  const d = await carica('scripts/dispatch.mjs');
  // Il testo della fase 2 è quello che l'owner ha salvato in Gestione → Automazioni
  // (oggi: senza nessun cenno a --ferma). Quello che lo strumento stampa deve
  // bastare da solo a far scoprire la porta.
  const testo = d.verifierReplyText({
    outcome: 'fix',
    phase2: {
      findings: [{ level: 2, text: 'Il pulsante non salva' }], derived: [],
      budgets: { cap2: { left: 2, cap: 3 } },
      instructions: 'FASE 2 — adesso correggi tu.\n8. Consegna:\n  node scripts/dispatch.mjs --record-fixed <id> "<report>" [--frase "<frase>"] [--segnala <file.md>]',
    },
  });
  expect(testo).toContain('--ferma');
});
