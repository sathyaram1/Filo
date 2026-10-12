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
import { TETTO_ATTESA_MS } from '../helpers/attese.mjs';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
require(resolve(ROOT, 'src', 'shared', 'feedbackThread.js'));
const TH = globalThis.SN_FEEDBACK_THREAD;

const SCRIPT = await import('../../scripts/claude-feedback.mjs');
const FB = globalThis.SN_FEEDBACK;

// La credenziale vera va in rete col token dell'owner: nei test ce n'è una finta
// (#908: senza token lo strumento non apre niente), tolta dove un test lo vuole.
const CRED_FINTA = async () => ({ idToken: 'tok-test' });
SCRIPT.credenziale.ottieni = CRED_FINTA;
// Le routine lanciano questi test con FILO_ROUTINE=1 nell'ambiente: lo strumento non deve credersi una routine qui.
SCRIPT.ambiente.routine = () => false;

/** Sostituisce submit per la durata di `fn`, raccogliendo cosa gli è arrivato. */
async function conSubmit(impl, fn) {
  const orig = FB.submit;
  const visti = [];
  FB.submit = async (payload, opts) => { visti.push(payload); visti.opts = [...(visti.opts || []), opts]; return impl(payload, opts); };
  try { return await fn(visti); } finally { FB.submit = orig; }
}

/** Raccoglie stderr per la durata di `fn`. */
async function conStderr(fn) {
  const righe = [];
  const orig = console.error;
  console.error = (...a) => righe.push(a.join(' '));
  try { await fn(); } finally { console.error = orig; }
  return righe.join('\n');
}

test('#595 col token admin il feedback parte autenticato e con la prova del mittente', async () => {
  SCRIPT.credenziale.ottieni = async () => ({ idToken: 'tok-owner' });
  try {
    await conSubmit(async (_p, opts) => ({ id: 'd', seq: 3, senderProof: opts && opts.idToken ? 'admin' : '' }), async (visti) => {
      let code;
      const err = await conStderr(async () => { code = await SCRIPT.main(['T', 'X', '--locale']); });
      assert.equal(code, SCRIPT.EXIT.FATTO);
      const o = visti.opts[0];
      assert.equal(o.idToken, 'tok-owner');
      // Mai il ripiego anonimo: senza la prova sarebbe un feedback d'utente.
      assert.equal(o.soloAdmin, true);
      // #908: di norma è un lavoro locale, firmato dalla sessione, con l'ora in millisecondi.
      assert.equal(o.localOnly.by, TH.LOCAL_CLIENT_ID);
      assert.ok(Number.isInteger(o.localOnly.at) && o.localOnly.at > 1.7e12);
      assert.doesNotMatch(err, /anonimo/);
    });
  } finally {
    SCRIPT.credenziale.ottieni = CRED_FINTA;
  }
});

test('#908 senza token: si ferma e lo dice, niente feedback anonimo', async () => {
  SCRIPT.credenziale.ottieni = async () => ({ idToken: '', motivo: 'nessuna credenziale admin su questa macchina' });
  try {
    await conSubmit(async () => ({ id: 'd', seq: 4 }), async (visti) => {
      let code;
      const err = await conStderr(async () => { code = await SCRIPT.main(['T', 'X', '--locale']); });
      assert.equal(code, SCRIPT.EXIT.RIFIUTATO);
      assert.equal(visti.length, 0, 'non parte niente');
      assert.match(err, /RIFIUTATO.*admin-login/);
    });
  } finally {
    SCRIPT.credenziale.ottieni = CRED_FINTA;
  }
});

test('#595 token rifiutato dal server: lo dice su stderr', async () => {
  SCRIPT.credenziale.ottieni = async () => ({ idToken: 'tok-vecchio' });
  try {
    // Con soloAdmin la submit non riparte da anonima: lancia, e lo strumento lo dice.
    await conSubmit(async () => { throw new Error('firestore create fallito (403): token admin rifiutato, e questo feedback non parte da anonimo'); }, async () => {
      let code;
      const err = await conStderr(async () => { code = await SCRIPT.main(['T', 'X', '--locale']); });
      assert.equal(code, SCRIPT.EXIT.RIFIUTATO);
      assert.match(err, /403.*anonimo/);
    });
  } finally {
    SCRIPT.credenziale.ottieni = CRED_FINTA;
  }
});

test('#595 prova a vuoto ed errore d’uso non chiedono la credenziale', async () => {
  let chiesta = 0;
  SCRIPT.credenziale.ottieni = async () => { chiesta += 1; return { idToken: '' }; };
  try {
    await conSubmit(async () => ({ id: 'd' }), async () => {
      await SCRIPT.main(['T', 'X', '--locale', '--dry-run']);
      await conStderr(() => SCRIPT.main(['T']));
    });
    assert.equal(chiesta, 0);
  } finally {
    SCRIPT.credenziale.ottieni = CRED_FINTA;
  }
});

test('il feedback parte firmato come sessione locale, non come utente anonimo', async () => {
  await conSubmit(async () => ({ id: 'doc1', seq: 512 }), async (visti) => {
    const r = await SCRIPT.apri({ titolo: 'Titolo', testo: 'Corpo del ritrovamento', idToken: 'tok' });
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
  const fatto = await conSubmit(async () => ({ id: 'd', seq: 1 }), () => SCRIPT.main(['T', 'X', '--locale']));
  assert.equal(fatto, SCRIPT.EXIT.FATTO);

  // Rifiutato dal server (le regole hanno detto no): riprovare identico è inutile.
  const rifiutato = await conSubmit(
    async () => { throw new Error('firestore create fallito (403): permission denied'); },
    () => SCRIPT.main(['T', 'X', '--locale']),
  );
  assert.equal(rifiutato, SCRIPT.EXIT.RIFIUTATO);

  // Server non raggiungibile: riprovare è esattamente la cosa giusta.
  const irraggiungibile = await conSubmit(
    async () => { throw new Error('fetch failed'); },
    () => SCRIPT.main(['T', 'X', '--locale']),
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

  // #602 — la cifratura che non si può fare è un no definitivo: riprovare non
  // cambia niente finché la copia dell'app resta com'è. Senza questa riga
  // finiva fra i "riprova" e lo script ci girava dentro all'infinito.
  const cifratura = new Error('Non è partito niente: manca la chiave con cui si cifra.');
  cifratura.cifratura = true;
  assert.equal(SCRIPT.exitCodeForError(cifratura), SCRIPT.EXIT.RIFIUTATO);
});

test('priorità: la scala è 3/2/1/0, si accettano tutti e quattro i gradini, il resto è un errore d’uso', () => {
  assert.deepEqual(SCRIPT.PRIORITA_AMMESSE, [0, 1, 2, 3]);
  assert.deepEqual(SCRIPT.parsePriorita(undefined), { ok: true, valore: null });
  assert.deepEqual(SCRIPT.parsePriorita('2'), { ok: true, valore: 2 });
  // Lo 0 è un gradino della scala (un caso raro), non «nessuna priorità»:
  // rifiutarlo lasciava un feedback senza modo di dire «vale zero».
  assert.deepEqual(SCRIPT.parsePriorita('0'), { ok: true, valore: 0 });
  assert.equal(SCRIPT.parsePriorita('4').ok, false);
  assert.match(SCRIPT.parsePriorita('4').motivo, /ammessi 0, 1, 2, 3/);
  assert.equal(SCRIPT.parsePriorita('-1').ok, false);
  assert.equal(SCRIPT.parsePriorita('alta').ok, false);
});

test('priorità 0 dalla riga di comando: si accetta e si dichiara (prova a vuoto), senza depositare', async () => {
  await conSubmit(async () => { throw new Error('submit non doveva essere chiamata'); }, async (visti) => {
    const righe = [];
    const orig = console.log;
    console.log = (...a) => righe.push(a.join(' '));
    let code;
    try { code = await SCRIPT.main(['T', 'X', '--locale', '--priorita', '0', '--dry-run']); } finally { console.log = orig; }
    assert.equal(code, SCRIPT.EXIT.FATTO);
    assert.equal(visti.length, 0);
    // Uno 0 letto come «falso» spariva dalla riga: il numero va stampato.
    assert.match(righe.join('\n'), /priorità 0/);
  });
});

test('priorità fuori scala: si ferma PRIMA di depositare', async () => {
  await conSubmit(async () => { throw new Error('submit non doveva essere chiamata'); }, async (visti) => {
    const code = await SCRIPT.main(['T', 'X', '--locale', '--priorita', '9']);
    assert.equal(code, SCRIPT.EXIT.USO);
    assert.equal(visti.length, 0);
  });
});

test('numero assegnato: si stampa, e quando manca non lo si inventa', async () => {
  const righe = [];
  const orig = console.log;
  console.log = (...a) => righe.push(a.join(' '));
  try {
    await conSubmit(async () => ({ id: 'd1', seq: 777 }), () => SCRIPT.main(['T', 'X', '--locale']));
    await conSubmit(async () => ({ id: 'd2', seq: null }), () => SCRIPT.main(['T', 'X', '--locale']));
  } finally { console.log = orig; }
  assert.ok(righe.some((r) => r.includes('#777')), 'il numero assegnato va stampato');
  assert.ok(righe.some((r) => /Numero non assegnato/.test(r)), 'senza numero lo si deve dire');
  assert.ok(!righe.some((r) => /#null|#undefined|#NaN/.test(r)), 'mai un numero inventato');
});

// ── Allegati (`--allega`) ────────────────────────────────────────────────────
// Il testo di un feedback ha un tetto (~6000 caratteri): una spec va allegata,
// e deve partire CON il feedback nella forma che l'app usa per i file
// ({ name, type, dataUrl }), così viene cifrata e caricata come dall'app.

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

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
  const dir = cartellaTemporanea('filo-allega-');
  const spec = join(dir, 'spec.md');
  writeFileSync(spec, '# Spec\n\nContenuto della spec.', 'utf8');
  await conSubmit(async () => ({ id: 'd1', seq: 800, files: [{ url: 'u', name: 'spec.md', type: 'text/markdown' }], failed: [] }), async (visti) => {
    const code = await SCRIPT.main(['Titolo', 'Testo', '--locale', '--allega', spec]);
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
    assert.equal(await SCRIPT.main(['T', 'X', '--locale', '--allega', join(tmpdir(), 'non-esiste-' + Date.now() + '.md')]), SCRIPT.EXIT.USO);
    const dir = cartellaTemporanea('filo-allega-');
    const html = join(dir, 'pagina.html');
    writeFileSync(html, '<script>1</script>', 'utf8');
    assert.equal(await SCRIPT.main(['T', 'X', '--locale', '--allega', html]), SCRIPT.EXIT.USO);
    assert.equal(visti.length, 0);
  });
});

test('--allega: un allegato non caricato si dice e l\'uscita non è "fatto"', async () => {
  const dir = cartellaTemporanea('filo-allega-');
  const spec = join(dir, 'spec.md');
  writeFileSync(spec, '# Spec', 'utf8');
  const errori = [];
  const orig = console.error;
  console.error = (...a) => errori.push(a.join(' '));
  try {
    await conSubmit(async () => ({ id: 'd1', seq: 801, files: [], failed: [{ name: 'spec.md', reason: 'caricamento non riuscito' }] }), async () => {
      const code = await SCRIPT.main(['T', 'X', '--locale', '--allega', spec]);
      assert.equal(code, SCRIPT.EXIT.RIFIUTATO);
    });
  } finally { console.error = orig; }
  assert.ok(errori.some((r) => /ALLEGATO NON CARICATO: spec.md/.test(r)), 'l\'allegato mancante va detto');
});

test('--allega: una immagine va nel campo delle immagini (i giudici la guardano), un documento nei file', async () => {
  const dir = cartellaTemporanea('filo-allega-');
  const png = join(dir, 'shot.png');
  writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
  const md = join(dir, 'spec.md');
  writeFileSync(md, '# spec', 'utf8');
  await conSubmit(async () => ({ id: 'd1', seq: 900, images: ['u1'], files: [{ url: 'u2', name: 'spec.md' }], failed: [] }), async (visti) => {
    const code = await SCRIPT.main(['T', 'X', '--locale', '--allega', png, '--allega', md]);
    assert.equal(code, SCRIPT.EXIT.FATTO);
    assert.equal(visti[0].images.length, 1);
    assert.ok(visti[0].images[0].dataUrl.startsWith('data:image/png;base64,'));
    assert.equal(visti[0].files.length, 1);
    assert.equal(visti[0].files[0].name, 'spec.md');
  });
});

// ── Lavori locali (#908) ─────────────────────────────────────────────────────

test('#908 --locale: il feedback nasce lavoro locale, e l’uscita lo dice col numero per il finish', async () => {
  const righe = [];
  const orig = console.log;
  console.log = (...a) => righe.push(a.join(' '));
  try {
    await conSubmit(async (_p, o) => ({ id: 'd9', seq: 909, senderProof: 'admin', localOnly: !!o.localOnly }), async (visti) => {
      assert.equal(await SCRIPT.main(['T', 'X', '--locale']), SCRIPT.EXIT.FATTO);
      assert.ok(visti.opts[0].localOnly);
    });
  } finally { console.log = orig; }
  assert.ok(righe.some((r) => /Lavoro locale/.test(r) && /--feedback 909/.test(r)), righe.join('\n'));
});

// Verifica di #908, giro 6: la regola dell'owner sulle segnalazioni non urgenti apre un feedback senza opzioni, e
// di norma voleva le routine. Senza scelta non si apre niente, a vuoto o no, e il rifiuto dice le due strade.
test('#908 senza --locale né --non-locale non apre niente e dice le due strade; con tutte e due nemmeno', async () => {
  await conSubmit(async () => { throw new Error('submit non doveva essere chiamata'); }, async (visti) => {
    for (const argv of [['T', 'X'], ['T', 'X', '--dry-run'], ['T', 'X', '--locale', '--non-locale']]) {
      let code;
      const err = await conStderr(async () => { code = await SCRIPT.main(argv); });
      assert.equal(code, SCRIPT.EXIT.USO, argv.join(' '));
      assert.match(err, argv.length === 4 ? /scegline uno/ : /--non-locale {2}una segnalazione per le routine[\s\S]*--locale {6}il lavoro di questa sessione/, argv.join(' '));
    }
    assert.equal(visti.length, 0);
  });
});

test('#908 --non-locale: stessa prova del mittente, ma è per le routine', async () => {
  const righe = [];
  const orig = console.log;
  console.log = (...a) => righe.push(a.join(' '));
  try {
    await conSubmit(async () => ({ id: 'd10', seq: 910, senderProof: 'admin' }), async (visti) => {
      assert.equal(await SCRIPT.main(['T', 'X', '--non-locale']), SCRIPT.EXIT.FATTO);
      assert.equal(visti.opts[0].soloAdmin, true);
      assert.equal(visti.opts[0].localOnly, undefined);
      assert.equal(visti[0].text, 'X', 'l’opzione non finisce nel testo');
    });
  } finally { console.log = orig; }
  assert.ok(righe.some((r) => /per le routine/.test(r)));
});

test('#908 apri senza token: rifiuto, non una submit anonima', async () => {
  await conSubmit(async () => { throw new Error('submit non doveva essere chiamata'); }, async (visti) => {
    const r = await SCRIPT.apri({ titolo: 'T', testo: 'X' });
    assert.equal(r.ok, false);
    assert.equal(r.codice, SCRIPT.EXIT.RIFIUTATO);
    assert.equal(visti.length, 0);
  });
});

// #914: da qui il feedback nasce dell'owner e salta i giudici; una routine apre dal canale, mai lavoro locale.
test('#914 una routine non apre feedback da qui, né locali né per le routine: niente credenziale, niente submit', async () => {
  let chiesta = 0;
  SCRIPT.credenziale.ottieni = async () => { chiesta += 1; return { idToken: 'tok-owner' }; };
  SCRIPT.ambiente.routine = () => true;
  try {
    for (const scelta of ['--locale', '--non-locale']) {
      await conSubmit(async () => ({ id: 'd', seq: 1, senderProof: 'admin' }), async (visti) => {
        let code;
        const err = await conStderr(async () => { code = await SCRIPT.main(['T', 'X', scelta]); });
        assert.equal(code, SCRIPT.EXIT.RIFIUTATO, scelta);
        assert.equal(visti.length, 0, scelta);
        assert.match(err, /routine-channel\.mjs deliver feedback/);
        assert.match(err, /--reason locale/);
      });
    }
    assert.equal(chiesta, 0);
  } finally {
    SCRIPT.credenziale.ottieni = CRED_FINTA;
    SCRIPT.ambiente.routine = () => false;
  }
});

test('#914 una routine si riconosce dalla dichiarazione, dal biglietto o dal ruolo; una sessione no', async () => {
  const { isRoutineInstance } = await import('../../scripts/lib/routine-role.mjs');
  const { cartellaTemporanea } = await import('../helpers/percorsi.mjs');
  const vuota = cartellaTemporanea('routine-o-no-');
  assert.equal(isRoutineInstance(vuota, { env: {} }), false);
  assert.equal(isRoutineInstance(vuota, { env: { FILO_ROUTINE: '0' } }), false);
  assert.equal(isRoutineInstance(vuota, { env: { FILO_ROUTINE_ROLE: 'boh' } }), false);
  assert.equal(isRoutineInstance(vuota, { env: { FILO_ROUTINE: '1' } }), true);
  assert.equal(isRoutineInstance(vuota, { env: { FILO_ROUTINE_TICKET: 'abc' } }), true);
  assert.equal(isRoutineInstance(vuota, { env: { FILO_ROUTINE_ROLE: 'fixer' } }), true);
  const { writeRole } = await import('../../scripts/lib/routine-role.mjs');
  writeRole(vuota, 'new-work');
  assert.equal(isRoutineInstance(vuota, { env: {} }), true, 'il ruolo scritto da dispatch');
});

test('#914 dentro una routine owner-feedback rifiuta il segno locale e il sì dell’owner (#913) prima di scrivere', async () => {
  const { spawnSync } = await import('node:child_process');
  // #957: --approva-locale non c'è più per nessuno, routine compresa.
  const tolta = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'owner-feedback.mjs'), '123', '--approva-locale'], {
    env: { ...process.env, FILO_ROUTINE: '1' }, encoding: 'utf8', timeout: TETTO_ATTESA_MS,
  });
  assert.equal(tolta.status, 1, tolta.stderr);
  assert.match(tolta.stderr, /--approva-locale non c'è più/);
  for (const opzione of ['--solo-locale']) {
    const r = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'owner-feedback.mjs'), '123', opzione], {
      env: { ...process.env, FILO_ROUTINE: '1' }, encoding: 'utf8', timeout: TETTO_ATTESA_MS,
    });
    assert.equal(r.status, 3, `${opzione}: ${r.stderr}`);
    assert.match(r.stderr, /una routine non segna lavoro locale/);
  }
});

test('#914 la priorità scelta parte col documento, e senza scelta non se ne inventa una', async () => {
  SCRIPT.credenziale.ottieni = async () => ({ idToken: 'tok-owner' });
  try {
    await conSubmit(async (_p, opts) => ({ id: 'd', seq: 4, senderProof: opts && opts.idToken ? 'admin' : '' }), async (visti) => {
      const out = [];
      const orig = console.log;
      console.log = (...a) => out.push(a.join(' '));
      try {
        assert.equal(await SCRIPT.main(['T', 'X', '--non-locale', '--priorita', '0']), SCRIPT.EXIT.FATTO);
        assert.equal(await SCRIPT.main(['T', 'X', '--non-locale']), SCRIPT.EXIT.FATTO);
      } finally { console.log = orig; }
      assert.equal(visti.opts[0].priority, 0, 'lo 0 è una priorità da scrivere');
      assert.equal('priority' in visti.opts[1], false);
      assert.match(out.join('\n'), /Priorità 0 impostata/);
      assert.match(out.join('\n'), /la decide il giudice di priorità/);
    });
  } finally {
    SCRIPT.credenziale.ottieni = CRED_FINTA;
  }
});

test('#914 la create admin porta priorità cifrata e priorityManual; la create anonima no', async () => {
  const corpi = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === 'POST' && /\/feedback\?/.test(String(url))) {
      corpi.push({ auth: !!(init.headers && init.headers.Authorization), body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ name: 'projects/p/databases/(default)/documents/feedback/x' }), text: async () => '' };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  try {
    await FB.submit({ text: 't', clientId: 'local:claude', name: 'n' }, { idToken: 'tok', soloAdmin: true, priority: 2 });
    await FB.submit({ text: 't', clientId: 'utente', name: 'n' }, { priority: 2 });
  } finally { globalThis.fetch = origFetch; }
  const admin = corpi.find((c) => c.auth);
  const anonimo = corpi.find((c) => !c.auth);
  assert.ok(admin && anonimo, 'due create, una autenticata e una no');
  assert.match(admin.body.fields.priority.stringValue, /^FENC1:/, 'cifrata: il documento è pubblico');
  assert.equal(admin.body.fields.priorityManual.booleanValue, true);
  assert.equal('priority' in anonimo.body.fields, false, 'il create anonimo non la ammette');
});
