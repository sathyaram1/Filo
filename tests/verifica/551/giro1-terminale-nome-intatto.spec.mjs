// Verifica #551 — giro 1, la PRIMA cura: il terminale non deve più storpiare
// i nomi. Il giro che conta è quello intero, come lo fa Filo dal vivo:
// elenca la cartella col terminale → prende il nome dall'output → lo passa al
// lettore di documenti. Se in mezzo un carattere si perde, l'ultimo passo
// fallisce «in modo onesto» su un file che esiste.
//
// Nota di ambiente, dichiarata perché conta nel leggere questi verdi: il
// guasto originale è della console di Windows (tabella OEM), e queste prove
// girano nel contenitore Linux delle routine, dove lo stdout è già UTF-8.
// Qui si tiene chiusa la catena — sonda della cartella, troncamento, busta
// del contenuto esterno, lettore — che sta in mezzo e che vale su ogni
// piattaforma. La parte propria di Windows la tengono gli unit sui preludi.

import { test, expect } from '../../fixtures/electron.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const HOME = 'filo://dashboard/dashboard.html';

// Un trattino lungo e una «à»: i due segni che la tabella OEM non sa scrivere.
const NOME = 'RELAZIONE — attività finale.txt';

const execAction = (app, action, opts) =>
  app.evaluate((_electron, { action, opts }) =>
    globalThis.SN_EXECUTE_FILO_ACTION(action, opts), { action, opts });

const accendiTerminale = (page) =>
  page.evaluate(async () => chrome.runtime.sendMessage({
    type: 'filo_confirm_action',
    action: { type: 'IMPOSTA_PREFERENZA', chiave: 'terminale', valore: 'on' },
  }));

const leggiDocumento = (page, percorso) =>
  page.evaluate((p) => new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: window.SN_MSG.MSG.FILO_RUN_ACTION,
      action: { type: 'LEGGI_DOCUMENTO', percorso: p },
    }, (r) => resolve(r));
  }), percorso);

test('il nome che torna dal terminale apre il file senza bisogno di indovinare', async ({ app, openTab }) => {
  const dir = cartellaTemporanea('filo-551-term-');
  try {
    writeFileSync(join(dir, NOME), 'bilancio chiuso\n', 'utf8');
    const page = await openTab(HOME);
    await accendiTerminale(page);

    const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando: `ls "${dir}"` });
    expect(r.executed, `il comando non è partito: ${JSON.stringify(r).slice(0, 400)}`).toBe(true);
    const stdout = String(r.output?.stdout || '');

    // Il nome torna IDENTICO a com'è sul disco…
    expect(stdout).toContain(NOME);
    // …e senza caratteri di sostituzione: uno solo vuol dire un byte perso.
    expect(stdout.includes('�'), 'nell’output c’è un carattere di sostituzione').toBe(false);

    // E ora la prova che chiude la catena: il nome PRESO DALL'OUTPUT apre il
    // file senza che il lettore debba tollerare niente. `requested` vuoto è
    // esattamente questo: nessuna svista da perdonare, il terminale ha detto
    // il nome giusto.
    const dallOutput = stdout.split(/\r?\n/).map((s) => s.trim()).find((s) => s.endsWith('.txt'));
    expect(dallOutput).toBe(NOME);
    const letto = await leggiDocumento(page, join(dir, dallOutput));
    expect(letto?.executed).toBe(true);
    expect(letto.output.text).toContain('bilancio chiuso');
    expect(letto.output.requested, 'il nome era giusto: non serviva tolleranza').toBe('');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('la cartella corrente continua a persistere fra un comando e l’altro', async ({ app, openTab }) => {
  // Il preludio di codifica si infila PRIMA della sonda che riporta la
  // cartella: se rompesse quel protocollo, un `cd` smetterebbe di valere per il
  // comando dopo e l'assistente girerebbe a vuoto nella cartella sbagliata.
  const dir = cartellaTemporanea('filo-551-cwd-');
  try {
    writeFileSync(join(dir, NOME), 'x\n', 'utf8');
    const page = await openTab(HOME);
    await accendiTerminale(page);

    const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando: 'pwd', cwd: dir }, { cwd: dir });
    expect(r.executed).toBe(true);
    const out = String(r.output?.stdout || '');
    // Il marcatore interno non si mostra all'utente.
    expect(out).not.toContain('__FILO_ONESHOT_CWD');
    expect(String(r.output?.cwd || out)).toContain('filo-551-cwd-');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('un nome pieno di segni difficili sopravvive al giro intero', async ({ app, openTab }) => {
  // Input limite sul cammino segnalato: apostrofo tipografico, emoji, spazi
  // doppi, trattini di tre fogge diverse. Sono tutti caratteri che un utente
  // vero si ritrova nei nomi, messi lì da un programma di scrittura o da un
  // telefono.
  const dir = cartellaTemporanea('filo-551-segni-');
  const difficile = 'Bolletta 2024–2025 — «l’ENEL» 🙂  finale.txt';
  try {
    writeFileSync(join(dir, difficile), 'importo: 42,00\n', 'utf8');
    const page = await openTab(HOME);
    await accendiTerminale(page);

    const r = await execAction(app, { type: 'ESEGUI_COMANDO', comando: 'ls', cwd: dir }, { cwd: dir });
    expect(r.executed).toBe(true);
    expect(String(r.output?.stdout || '')).toContain(difficile);

    const letto = await leggiDocumento(page, join(dir, difficile));
    expect(letto?.executed).toBe(true);
    expect(letto.output.text).toContain('importo: 42,00');
    expect(letto.output.name).toBe(difficile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
