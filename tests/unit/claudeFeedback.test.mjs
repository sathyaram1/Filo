// Lo strumento con cui una sessione locale APRE un feedback
// (scripts/claude-feedback.mjs).
//
// Cosa si asserisce, e perché proprio questo:
//   · il feedback parte firmato come sessione locale — è tutto il motivo per
//     cui lo strumento esiste: depositarlo dalla strada dell'app lo farebbe
//     arrivare come un utente anonimo qualunque;
//   · i tre esiti hanno codici d'uscita DIVERSI (fatto / rifiutato / non
//     raggiungibile): chi lancia lo script deve poter distinguere "riprovare
//     non serve" da "riprova, era la rete";
//   · il numero assegnato viene riportato, e quando non c'è si dice invece di
//     fingerlo.
//
// `SN_FEEDBACK.submit` è sostituita nel test: qui si verifica lo strumento, non
// Firestore (nessuna rete).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(resolve(ROOT, 'src', 'shared', 'feedbackThread.js'));
const TH = globalThis.SN_FEEDBACK_THREAD;

const SCRIPT = await import('../../scripts/claude-feedback.mjs');
const FB = globalThis.SN_FEEDBACK;

/** Sostituisce submit per la durata di `fn`, raccogliendo cosa gli è arrivato. */
async function conSubmit(impl, fn) {
  const orig = FB.submit;
  const visti = [];
  FB.submit = async (payload) => { visti.push(payload); return impl(payload); };
  try { return await fn(visti); } finally { FB.submit = orig; }
}

test('il feedback parte firmato come sessione locale, non come utente anonimo', async () => {
  await conSubmit(async () => ({ id: 'doc1', seq: 512 }), async (visti) => {
    const r = await SCRIPT.apri({ titolo: 'Titolo', testo: 'Corpo del ritrovamento' });
    assert.equal(r.ok, true);
    assert.equal(r.seq, 512);
    assert.equal(visti.length, 1);
    // Il punto: la PROVENIENZA. Senza questa riga il feedback arriva come
    // 'user' e in dashboard non si distingue da quello di uno sconosciuto.
    assert.equal(visti[0].clientId, TH.LOCAL_CLIENT_ID);
    assert.equal(TH.authorKind(visti[0].clientId), 'local');
    // Titolo e testo finiscono dove li legge la dashboard.
    assert.equal(visti[0].name, 'Titolo');
    assert.equal(visti[0].text, 'Corpo del ritrovamento');
  });
});

test('titolo o testo mancanti: si ferma senza toccare la rete', async () => {
  await conSubmit(async () => { throw new Error('submit non doveva essere chiamata'); }, async (visti) => {
    const a = await SCRIPT.apri({ titolo: '', testo: 'c’è il testo' });
    assert.equal(a.ok, false);
    assert.equal(a.uso, true);
    const b = await SCRIPT.apri({ titolo: 'c’è il titolo', testo: '   ' });
    assert.equal(b.ok, false);
    assert.equal(b.uso, true);
    assert.equal(visti.length, 0);
  });
});

test('la prova a vuoto non deposita niente', async () => {
  await conSubmit(async () => { throw new Error('submit non doveva essere chiamata'); }, async (visti) => {
    const r = await SCRIPT.apri({ titolo: 'T', testo: 'X', dryRun: true });
    assert.equal(r.ok, true);
    assert.equal(r.dryRun, true);
    assert.equal(visti.length, 0);
  });
});

test('tre esiti, tre codici d’uscita diversi', async () => {
  // Fatto.
  const fatto = await conSubmit(async () => ({ id: 'd', seq: 1 }), () => SCRIPT.main(['T', 'X']));
  assert.equal(fatto, SCRIPT.EXIT.FATTO);

  // Rifiutato dal server (le regole hanno detto no): riprovare identico è inutile.
  const rifiutato = await conSubmit(
    async () => { throw new Error('firestore create fallito (403): permission denied'); },
    () => SCRIPT.main(['T', 'X']),
  );
  assert.equal(rifiutato, SCRIPT.EXIT.RIFIUTATO);

  // Server non raggiungibile: riprovare è esattamente la cosa giusta.
  const irraggiungibile = await conSubmit(
    async () => { throw new Error('fetch failed'); },
    () => SCRIPT.main(['T', 'X']),
  );
  assert.equal(irraggiungibile, SCRIPT.EXIT.IRRAGGIUNGIBILE);

  // I tre codici sono davvero distinti (se collassassero, il chiamante non
  // potrebbe decidere niente).
  assert.equal(new Set([fatto, rifiutato, irraggiungibile]).size, 3);

  // Uso sbagliato: né l'uno né l'altro.
  const uso = await conSubmit(async () => ({ id: 'd', seq: 1 }), () => SCRIPT.main([]));
  assert.equal(uso, SCRIPT.EXIT.USO);
});

test('il guasto del server è "riprova", il rifiuto no', () => {
  assert.equal(SCRIPT.exitCodeForError(new Error('firestore create fallito (500): boom')), SCRIPT.EXIT.IRRAGGIUNGIBILE);
  assert.equal(SCRIPT.exitCodeForError(new Error('firestore create fallito (429): slow down')), SCRIPT.EXIT.IRRAGGIUNGIBILE);
  assert.equal(SCRIPT.exitCodeForError(new Error('firestore create fallito (400): bad')), SCRIPT.EXIT.RIFIUTATO);
  assert.equal(SCRIPT.exitCodeForError(new Error('firestore create fallito (409): esiste già')), SCRIPT.EXIT.RIFIUTATO);
  assert.equal(SCRIPT.exitCodeForError(new Error('ETIMEDOUT')), SCRIPT.EXIT.IRRAGGIUNGIBILE);
});

test('priorità: si accettano 1-3, il resto è un errore d’uso', () => {
  assert.deepEqual(SCRIPT.parsePriorita(undefined), { ok: true, valore: null });
  assert.deepEqual(SCRIPT.parsePriorita('2'), { ok: true, valore: 2 });
  assert.equal(SCRIPT.parsePriorita('0').ok, false);
  assert.equal(SCRIPT.parsePriorita('4').ok, false);
  assert.equal(SCRIPT.parsePriorita('alta').ok, false);
});

test('priorità fuori scala: si ferma PRIMA di depositare', async () => {
  await conSubmit(async () => { throw new Error('submit non doveva essere chiamata'); }, async (visti) => {
    const code = await SCRIPT.main(['T', 'X', '--priorita', '9']);
    assert.equal(code, SCRIPT.EXIT.USO);
    assert.equal(visti.length, 0);
  });
});

test('numero assegnato: si stampa, e quando manca non lo si inventa', async () => {
  const righe = [];
  const orig = console.log;
  console.log = (...a) => righe.push(a.join(' '));
  try {
    await conSubmit(async () => ({ id: 'd1', seq: 777 }), () => SCRIPT.main(['T', 'X']));
    await conSubmit(async () => ({ id: 'd2', seq: null }), () => SCRIPT.main(['T', 'X']));
  } finally { console.log = orig; }
  assert.ok(righe.some((r) => r.includes('#777')), 'il numero assegnato va stampato');
  assert.ok(righe.some((r) => /Numero non assegnato/.test(r)), 'senza numero lo si deve dire');
  assert.ok(!righe.some((r) => /#null|#undefined|#NaN/.test(r)), 'mai un numero inventato');
});

// ── Allegati (`--allega`) ────────────────────────────────────────────────────
// Il testo di un feedback ha un tetto (~6000 caratteri): una spec va allegata,
// e deve partire CON il feedback nella forma che l'app usa per i file
// ({ name, type, dataUrl }), così viene cifrata e caricata come dall'app.

import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('mimeDiAllegato: solo i tipi dell\'allowlist del gate L0, dal nome', () => {
  assert.equal(SCRIPT.mimeDiAllegato('spec.md'), 'text/markdown');
  assert.equal(SCRIPT.mimeDiAllegato('SPEC.MD'), 'text/markdown');
  assert.equal(SCRIPT.mimeDiAllegato('errori.log'), 'text/plain');
  assert.equal(SCRIPT.mimeDiAllegato('dati.json'), 'application/json');
  assert.equal(SCRIPT.mimeDiAllegato('pagina.html'), '', 'un tipo attivo non parte nemmeno');
  assert.equal(SCRIPT.mimeDiAllegato('script.js'), '');
  assert.equal(SCRIPT.mimeDiAllegato('senza-estensione'), '');
});

test('--allega: il documento parte con il feedback, nella forma dell\'app', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'filo-allega-'));
  const spec = join(dir, 'spec.md');
  writeFileSync(spec, '# Spec\n\nContenuto della spec.', 'utf8');
  await conSubmit(async () => ({ id: 'd1', seq: 800, files: [{ url: 'u', name: 'spec.md', type: 'text/markdown' }], failed: [] }), async (visti) => {
    const code = await SCRIPT.main(['Titolo', 'Testo', '--allega', spec]);
    assert.equal(code, SCRIPT.EXIT.FATTO);
    assert.equal(visti.length, 1);
    const files = visti[0].files;
    assert.equal(files.length, 1);
    assert.equal(files[0].name, 'spec.md');
    assert.equal(files[0].type, 'text/markdown');
    assert.ok(files[0].dataUrl.startsWith('data:text/markdown;base64,'));
    assert.equal(Buffer.from(files[0].dataUrl.split(',')[1], 'base64').toString('utf8'), '# Spec\n\nContenuto della spec.');
    assert.equal(visti[0].text, 'Testo', 'il percorso dell\'allegato non finisce nel testo');
  });
});

test('--allega: file mancante o di tipo non ammesso → errore d\'uso, niente deposito', async () => {
  await conSubmit(async () => { throw new Error('submit non doveva essere chiamata'); }, async (visti) => {
    assert.equal(await SCRIPT.main(['T', 'X', '--allega', join(tmpdir(), 'non-esiste-' + Date.now() + '.md')]), SCRIPT.EXIT.USO);
    const dir = mkdtempSync(join(tmpdir(), 'filo-allega-'));
    const html = join(dir, 'pagina.html');
    writeFileSync(html, '<script>1</script>', 'utf8');
    assert.equal(await SCRIPT.main(['T', 'X', '--allega', html]), SCRIPT.EXIT.USO);
    assert.equal(visti.length, 0);
  });
});

test('--allega: un allegato non caricato si dice e l\'uscita non è "fatto"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'filo-allega-'));
  const spec = join(dir, 'spec.md');
  writeFileSync(spec, '# Spec', 'utf8');
  const errori = [];
  const orig = console.error;
  console.error = (...a) => errori.push(a.join(' '));
  try {
    await conSubmit(async () => ({ id: 'd1', seq: 801, files: [], failed: [{ name: 'spec.md', reason: 'caricamento non riuscito' }] }), async () => {
      const code = await SCRIPT.main(['T', 'X', '--allega', spec]);
      assert.equal(code, SCRIPT.EXIT.RIFIUTATO);
    });
  } finally { console.error = orig; }
  assert.ok(errori.some((r) => /ALLEGATO NON CARICATO: spec.md/.test(r)), 'l\'allegato mancante va detto');
});

test('--allega: un\x27immagine va nel campo delle immagini (i giudici la guardano), un documento nei file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'filo-allega-'));
  const png = join(dir, 'shot.png');
  writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
  const md = join(dir, 'spec.md');
  writeFileSync(md, '# spec', 'utf8');
  await conSubmit(async () => ({ id: 'd1', seq: 900, images: ['u1'], files: [{ url: 'u2', name: 'spec.md' }], failed: [] }), async (visti) => {
    const code = await SCRIPT.main(['T', 'X', '--allega', png, '--allega', md]);
    assert.equal(code, SCRIPT.EXIT.FATTO);
    assert.equal(visti[0].images.length, 1);
    assert.ok(visti[0].images[0].dataUrl.startsWith('data:image/png;base64,'));
    assert.equal(visti[0].files.length, 1);
    assert.equal(visti[0].files[0].name, 'spec.md');
  });
});
