// Sentinella: nessun file sotto scripts/ o src/ indica le routine come posto per la chiave privata dei feedback,
// che dal canale del server la legge solo lui (ROUTINE-AUTH-SPEC.md §3). Il caso che l'ha fatta nascere: il
// messaggio di gen-feedback-keys.mjs diceva di metterla nella configurazione delle routine (#774).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ESTENSIONI = new Set(['.js', '.mjs', '.cjs', '.ts', '.html', '.json', '.md', '.sh', '.ps1', '.yml', '.yaml', '.txt']);
const ROUTINE = /routin/i;
const CHIAVE = /\bprivat[ae]\b|PRIVKEY|chiave di lettura/i;
// Una riga sulle routine vicina alla chiave passa solo se dice lei stessa che la chiave non c'è.
const NEGA = /nessuna copia|solo (il|dal|al) server|nessuna chiave|senza ?(la )?chiave|non (la |ce l'?)(legge|leggono|usa|usano|cerca|cercano|ha|hanno)\b/i;
const FINESTRA = 2;

function righeSospette(testo) {
  const righe = testo.split('\n');
  const out = [];
  righe.forEach((riga, i) => {
    if (!ROUTINE.test(riga) || NEGA.test(riga)) return;
    const da = Math.max(0, i - FINESTRA);
    const vicine = righe.slice(da, i + FINESTRA + 1);
    if (vicine.some((r) => CHIAVE.test(r))) out.push({ riga: i + 1, testo: riga.trim() });
  });
  return out;
}

function sorgenti(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sorgenti(p, acc);
    else if (ESTENSIONI.has(extname(e))) acc.push(p);
  }
  return acc;
}

test('il rilevatore riconosce le frasi che mettevano la chiave sulle routine, e lascia passare quelle che la negano', () => {
  const vecchie = [
    "    '  • routine:  variabile d\\'ambiente FILO_FEEDBACK_PRIVKEY (mai in chiaro nel repo).\\n' +",
    '//   - PRIVATA   -> stampata a video, da salvare FUORI dal repo (owner/backend/\n//                  routine). Non viene mai scritta su disco da questo script.',
    '//     PRIVATA (owner / backend / routine) rifà l\'ECDH e decifra. Chi cifra NON',
    '//   - Cloud/routine: passata come env `FILO_FEEDBACK_PRIVKEY` nella config',
    '// codice di cifratura vive su main senza rompere i lettori\n// che non hanno ancora la chiave privata (dashboard owner, routine cloud,',
  ];
  for (const t of vecchie) assert.ok(righeSospette(t).length > 0, `non riconosciuta: ${t}`);

  const buone = [
    "'\\nDove va la privata (S1.5):\\n' +\n'  • backend:  secret delle Cloud Functions;\\n' +\n'  • routine:  nessuna copia, la legge solo il server.\\n' +",
    '// La chiave privata dei feedback: le routine non la leggono.',
    "// La chiave privata la tiene il server:\n// alle routine il payload arriva già decifrato, non ce l'hanno.",
  ];
  for (const t of buone) assert.deepEqual(righeSospette(t), [], `segnalata per sbaglio: ${t}`);
});

test('il messaggio di gen-feedback-keys.mjs dice che alle routine non va nessuna copia della privata', () => {
  const pubblica = readFileSync(join(ROOT, 'src', 'shared', 'feedbackPublicKey.js'), 'utf8');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_/i.test(k)));
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'gen-feedback-keys.mjs'), '--print'],
    { cwd: ROOT, env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  // --print non deve toccare la chiave pubblica nel repo: qui lo si lancia davvero.
  assert.equal(readFileSync(join(ROOT, 'src', 'shared', 'feedbackPublicKey.js'), 'utf8'), pubblica);

  const blocco = r.stdout.slice(r.stdout.indexOf('Dove va la privata'));
  assert.ok(blocco.startsWith('Dove va la privata'), `manca il blocco «Dove va la privata»:\n${r.stdout}`);
  const voceRoutine = blocco.split('\n').find((l) => /•\s*routine\b/i.test(l));
  assert.ok(voceRoutine, `il blocco non dice niente delle routine:\n${blocco}`);
  assert.match(voceRoutine, /nessuna copia/i);
  assert.match(voceRoutine, /solo il server/i);
  assert.doesNotMatch(voceRoutine, /PRIVKEY|\benv\b|variabile|secret/i);
});

test('nessun file sotto scripts/ o src/ indica le routine come posto per la chiave privata', () => {
  const file = [...sorgenti(join(ROOT, 'scripts')), ...sorgenti(join(ROOT, 'src'))];
  assert.ok(file.length > 50, `trovati solo ${file.length} file: la ricerca non guarda dove dovrebbe`);
  const trovati = [];
  for (const f of file) {
    for (const s of righeSospette(readFileSync(f, 'utf8'))) {
      trovati.push(`${relative(ROOT, f).replace(/\\/g, '/')}:${s.riga}  ${s.testo}`);
    }
  }
  assert.deepEqual(trovati, [],
    'Queste righe mettono le routine vicino alla chiave privata. La privata la legge solo il server: togli le routine '
    + 'dall\'elenco, o scrivi sulla stessa riga che non la hanno (es. «nessuna copia»).');
});
