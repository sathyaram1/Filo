// Giro 2 di verifica del feedback #528 — la modalita' terminale su Linux.
//
// IL SINTOMO
//   Il feedback chiede, fra i punti dove il codice dava per scontato Windows,
//   che «la shell di default sia quella dell'utente, non PowerShell». Il giro 1
//   aveva trovato la porta a meta': le due strade equivalenti per lanciare un
//   comando — la modalita' terminale della dashboard e i comandi che lancia
//   l'assistente — non partivano dalla stessa shell quando l'utente non aveva
//   scelto niente.
//
//   Qui si guarda dal punto di vista dell'utente Linux, non del codice:
//
//   1. Apre le Preferenze e cerca «Shell da usare». Se il menu gli offre
//      PowerShell, il Prompt dei comandi e «Bash (WSL)», gli sta offrendo tre
//      programmi che sulla sua macchina non esistono: un menu che mente.
//   2. Lancia lo stesso comando dalle due strade equivalenti senza aver
//      toccato niente nelle Preferenze (la condizione di chiunque apra Filo
//      per la prima volta). Deve rispondere la stessa shell, e deve essere una
//      shell che su Linux esiste.
//   3. Sceglie Bash nelle Preferenze: la scelta deve valere davvero, su
//      tutte e due le strade.
//
// Queste prove restano nel ramo: sono la memoria del giro.

import { test, expect } from '../../fixtures/electron.mjs';

test.skip(process.platform === 'win32', 'la porta e\' quella di Linux e Mac');

test('nelle Preferenze la shell offerta e\' una che su Linux esiste davvero', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForSelector('#terminalShell', { timeout: 15_000 });

  const voci = await page.$$eval('#terminalShell option', (os) => os.map((o) => ({
    value: o.value, label: o.textContent.trim(),
  })));

  const valori = voci.map((v) => v.value);
  // Il successo dal punto di vista dell'utente: nel menu non compare nessun
  // programma di Windows, e c'e' la shell di sistema.
  expect(valori, `le Preferenze offrono shell di Windows su Linux: ${JSON.stringify(voci)}`)
    .not.toContain('powershell');
  expect(valori, `le Preferenze offrono il Prompt dei comandi su Linux: ${JSON.stringify(voci)}`)
    .not.toContain('cmd');
  expect(valori, 'manca la shell di sistema fra quelle scegliibili').toContain('sh');

  // E quella selezionata all'apertura, senza che l'utente abbia scelto niente,
  // non e' una voce fantasma: e' una di quelle che il menu mostra.
  const scelta = await page.$eval('#terminalShell', (s) => s.value);
  expect(valori, `il menu mostra ${JSON.stringify(valori)} ma ha selezionato "${scelta}"`)
    .toContain(scelta);
});

// La modalita' terminale della dashboard, provata dove vive davvero: da una
// pagina filo://, con la stessa porta che usa la dashboard (`window.filo`).
// La shell risponde da se' chi e': `$BASH_VERSION` e' vuota in sh e piena in
// bash, quindi non ci si fida di cio' che le abbiamo chiesto.
const CHIEDI_CHI_SEI = 'echo "sono:${BASH_VERSION:-non-bash}"';

async function lanciaDalTerminale(page, shell) {
  return page.evaluate(([comando, sh]) => new Promise((risolvi, rifiuta) => {
    let out = '';
    const stop = setTimeout(() => rifiuta(new Error('la shell non ha risposto entro il tempo')), 25_000);
    window.filo.shellExec({
      command: comando,
      shell: sh === null ? undefined : sh,
      onData: ({ chunk }) => { out += chunk; },
      onExit: ({ code }) => { clearTimeout(stop); risolvi({ out, code }); },
      onError: ({ message }) => { clearTimeout(stop); rifiuta(new Error(message)); },
    });
  }), [CHIEDI_CHI_SEI, shell === undefined ? null : shell]);
}

const chiHaRisposto = (t) => (/sono:non-bash/.test(t) ? 'sh' : /sono:/.test(t) ? 'bash' : 'nessuno');

test('senza aver scelto niente, la modalita\' terminale lancia davvero un comando su Linux', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForFunction(() => !!window.filo?.shellExec, null, { timeout: 15_000 });

  // Nessuna shell chiesta: e' la condizione di chi apre Filo per la prima
  // volta e non tocca le Preferenze.
  const esito = await lanciaDalTerminale(page, undefined);

  // Il successo dal punto di vista dell'utente: il comando GIRA e risponde.
  // Se qui partisse powershell.exe, su Linux non esisterebbe e non
  // arriverebbe niente.
  expect(esito.out, `la modalita' terminale non ha eseguito il comando: ${JSON.stringify(esito)}`)
    .toContain('sono:');
  expect(esito.code, `il comando e' uscito con ${esito.code}`).toBe(0);
  expect(chiHaRisposto(esito.out), 'senza nessuna scelta deve rispondere la shell di sistema')
    .toBe('sh');
});

test('chi sceglie Bash nelle Preferenze ottiene davvero Bash nella modalita\' terminale', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForFunction(() => !!window.filo?.shellExec, null, { timeout: 15_000 });

  const esito = await lanciaDalTerminale(page, 'bash');
  expect(esito.out, `chiedendo Bash non ha risposto nessuna shell: ${JSON.stringify(esito)}`)
    .toContain('sono:');
  expect(chiHaRisposto(esito.out), 'la voce «Bash» delle Preferenze non cambia chi risponde')
    .toBe('bash');
});

// E il valore che l'app usa quando l'utente non ha scelto niente ("powershell",
// che sta nei valori di serie ed e' nato su Windows) su Linux non deve MAI
// arrivare cosi' com'e' a uno spawn: li' non esiste.
test('una preferenza nata su Windows non fa partire PowerShell su Linux', async ({ openTab }) => {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForFunction(() => !!window.filo?.shellExec, null, { timeout: 15_000 });

  const esito = await lanciaDalTerminale(page, 'powershell');
  expect(esito.out, `con la preferenza di serie il comando non parte: ${JSON.stringify(esito)}`)
    .toContain('sono:');
  expect(esito.code, 'il comando non e\' andato a buon fine').toBe(0);
});
