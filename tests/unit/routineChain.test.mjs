// Il PUNTO DI CONSEGNA: dal biglietto al pacchetto che il lavoratore riceve.
//
// PERCHÉ QUESTO FILE ESISTE
//   Lo stesso guasto è passato DUE volte con l'intera suite verde: la busta del
//   server arrivava, ma ciò che veniva passato a chi compone il pacchetto era
//   incartato male, e al lavoratore arrivava un compito vuoto — con il giro che
//   usciva dicendo che era andato tutto bene, dopo aver pure dichiarato al
//   server che quel feedback era in lavorazione.
//
//   I controlli sulle singole funzioni non lo vedevano, e non potevano: quelle
//   funzioni non si erano mai rotte. A rompersi era la GIUNTURA — cosa viene
//   passato a chi. Questo file guarda la giuntura, lanciando il giro vero
//   contro un server finto, in una cartella usa-e-getta: nessuna rete, nessun
//   ramo vero, nessun semaforo vero.
//
//   Se domani qualcuno reincarta la busta, o il server manda una busta vuota,
//   qui diventa rosso. È l'unica cosa che sarebbe diventata rossa su entrambi i
//   guasti già successi.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const FEEDBACK = {
  name: 'Il pulsante non compare',
  text: 'Quando apro le impostazioni il pulsante per rimuovere un modello non c’è.',
  num: '#900',
};

/** Server finto: risponde alle sole chiamate del canale che il giro fa. */
function fintoServer(rispostaLavoro) {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/routineWork')) res.end(JSON.stringify(rispostaLavoro));
      else res.end(JSON.stringify({ ok: true }));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

/**
 * Lancia il giro vero col biglietto, contro il server finto, dentro una
 * cartella git usa-e-getta (così claim e posizionamento non toccano niente di
 * reale). Ritorna il JSON che il giro consegna al lavoratore.
 */
async function giro(rispostaLavoro) {
  const { srv, port } = await fintoServer(rispostaLavoro);
  const casa = mkdtempSync(resolve(tmpdir(), 'filo-catena-'));
  try {
    mkdirSync(resolve(casa, '.claude'), { recursive: true });
    // Le ricette dei ruoli si cercano sotto la stessa radice: senza copiarle,
    // il lavoratore riceverebbe un ruolo senza istruzioni — e il controllo che
    // dice "la ricetta deve arrivare non vuota" fallirebbe per il motivo
    // sbagliato.
    cpSync(resolve(REPO, 'routines', 'roles'), resolve(casa, 'routines', 'roles'), { recursive: true });
    // Un deposito git minimo CON un suo "altrove" dove spedire: il giro prende
    // il semaforo spedendo un file, e se non ha dove spedirlo si tira indietro
    // credendo che il lavoro sia di qualcun altro. Serve finto, ma completo.
    const altrove = resolve(casa, 'altrove.git');
    execFileSync('git', ['init', '-q', '--bare', altrove]);
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: casa });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: casa });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: casa });
    writeFileSync(resolve(casa, 'segnaposto.txt'), 'x', 'utf8');
    execFileSync('git', ['add', '-A'], { cwd: casa });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: casa });
    execFileSync('git', ['remote', 'add', 'origin', altrove], { cwd: casa });
    execFileSync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: casa });
    // I lavori dell'iter arrivano con un ramo già esistente: se non c'è, il
    // giro si ferma — giustamente, ma per un motivo che non è quello in prova.
    const ramo = String(rispostaLavoro.branch || '');
    if (ramo) {
      execFileSync('git', ['branch', ramo], { cwd: casa });
      execFileSync('git', ['push', '-q', 'origin', ramo], { cwd: casa });
    }

    const out = await new Promise((risolvi) => {
      const p = spawn(process.execPath, [resolve(REPO, 'scripts', 'dispatch.mjs'), '--ticket', 'biglietto-di-prova'], {
        cwd: casa,
        env: {
          ...process.env,
          FILO_ROUTINE_API: `http://127.0.0.1:${port}`,
          // ⚠️ SENZA QUESTE DUE il giro lavora sul deposito VERO: il percorso
          // se lo ricava da dove sta lo script, non dalla cartella da cui è
          // stato lanciato. Lanciarlo senza ha già creato un ramo e un semaforo
          // veri, spediti sul ramo principale — un test che sporca ciò che
          // dovrebbe sorvegliare.
          FILO_REPO_ROOT: casa,
          FILO_DISPATCH_STATE_DIR: resolve(casa, 'stato'),
          FILO_SPOOL_DIR: resolve(casa, 'coda'),
          // Interruttore acceso senza chiedere niente alla rete.
          FILO_ROUTINES_ENABLED: '1',
          // La chiave NON deve servire: se servisse, questo test lo direbbe.
          FILO_FEEDBACK_PRIVKEY: '',
        },
      });
      let so = ''; let se = '';
      p.stdout.on('data', (c) => { so += c; });
      p.stderr.on('data', (c) => { se += c; });
      p.on('close', () => risolvi({ so, se }));
    });
    const i = out.so.indexOf('{');
    const j = out.so.lastIndexOf('}');
    return { json: i >= 0 ? JSON.parse(out.so.slice(i, j + 1)) : null, stderr: out.se };
  } finally {
    srv.close();
    rmSync(casa, { recursive: true, force: true });
  }
}

test('lavoro nuovo: al lavoratore arrivano ruolo, ricetta e il TESTO del feedback', async () => {
  const { json } = await giro({
    ok: true, role: 'new-work', id: 'fid-900', num: FEEDBACK.num, branch: '',
    payload: { role: 'new-work', num: FEEDBACK.num, feedback: FEEDBACK },
  });
  assert.ok(json, 'il giro deve consegnare qualcosa');
  assert.equal(json.role, 'new-work');
  assert.ok(json.instructions && json.instructions.length > 500,
    `la ricetta del ruolo deve arrivare non vuota (arrivati ${(json.instructions || '').length} caratteri)`);
  assert.ok(json.payload && json.payload.feedback, 'il feedback deve esserci');
  assert.equal(json.payload.feedback.text, FEEDBACK.text,
    'è il testo del feedback che il lavoratore usa: senza, lavora alla cieca');
});

test('correzione: arriva anche la critica di chi aveva bocciato', async () => {
  const { json } = await giro({
    ok: true, role: 'fixer', id: 'fid-900', num: FEEDBACK.num, branch: 'worker/900',
    payload: { role: 'fixer', feedback: FEEDBACK, critique: 'il pulsante compare ma non fa niente', loopCount: 1 },
  });
  assert.equal(json.role, 'fixer');
  assert.equal(json.payload.feedback.text, FEEDBACK.text);
  assert.equal(json.payload.verifierCritique, 'il pulsante compare ma non fa niente',
    'senza la critica la correzione riparte alla cieca');
});

test('controllo di sicurezza: ramo e differenze, MAI il feedback', async () => {
  const { json } = await giro({
    ok: true, role: 'secaudit', id: 'fid-900', num: FEEDBACK.num, branch: 'worker/900',
    // Busta manomessa: ci infiliamo dentro il feedback apposta.
    payload: { role: 'secaudit', branch: 'worker/900', feedback: FEEDBACK },
  });
  assert.equal(json.role, 'secaudit');
  assert.equal(json.payload.feedback, undefined);
  assert.equal(JSON.stringify(json.payload).includes(FEEDBACK.text), false,
    'il testo del feedback non deve raggiungerlo per nessuna strada');
});

test('busta formalmente giusta ma VUOTA dentro → il giro si ferma', async () => {
  // È la forma di guasto silenzioso entrata dalla porta del server: ruolo,
  // indirizzo e ramo a posto, ma niente su cui lavorare.
  const { json } = await giro({
    ok: true, role: 'new-work', id: 'fid-900', num: FEEDBACK.num, branch: '',
    payload: { role: 'new-work', feedback: null },
  });
  assert.equal(json.role, 'halt', 'consegnare un compito vuoto è peggio che non consegnare niente');
  assert.match(JSON.stringify(json.payload), /vuoto/);
});

test('busta senza ruolo, o con un ruolo sconosciuto → il giro si ferma', async () => {
  for (const risposta of [
    { ok: true, payload: {} },
    { ok: true, role: 'capo', id: 'x', payload: {} },
  ]) {
    const { json } = await giro(risposta);
    assert.equal(json.role, 'halt', JSON.stringify(risposta));
  }
});
