// Giro 2 di verifica del feedback #528 — la modalita' terminale su Linux,
// maltrattata.
//
// Il feedback chiede che su Linux la modalita' terminale parta dalla shell
// dell'utente invece che da PowerShell. Cambiare quale programma viene
// lanciato cambia anche COME il comando ci arriva: i marcatori che Filo
// aggiunge per sapere com'e' finito il comando e in che cartella si trova sono
// diversi da shell a shell. Quindi la domanda non e' solo «parte?», ma «regge
// quello che un utente ci butta dentro?».
//
// Filo deve poter essere usato male (filosofia): un comando vuoto, uno lungo
// diecimila caratteri, uno pieno di emoji o di virgolette, dieci comandi uno
// dietro l'altro. Niente di tutto questo deve lasciare la modalita' terminale
// muta o appesa.

import { test, expect } from '../../fixtures/electron.mjs';

test.skip(process.platform === 'win32', 'la porta e\' quella di Linux e Mac');

// Lancia un comando dalla stessa porta che usa la dashboard e aspetta l'esito.
// Ritorna anche `errore` invece di far esplodere il test: qui il difetto da
// scoprire e' proprio «non risponde piu' niente».
async function lancia(page, comando, { attesaMs = 30_000 } = {}) {
  return page.evaluate(([cmd, tetto]) => new Promise((risolvi) => {
    let out = '';
    const stop = setTimeout(() => risolvi({ out, code: null, appeso: true }), tetto);
    window.filo.shellExec({
      command: cmd,
      onData: ({ chunk }) => { out += chunk; },
      onExit: ({ code, cwd }) => { clearTimeout(stop); risolvi({ out, code, cwd }); },
      onError: ({ message }) => { clearTimeout(stop); risolvi({ out, errore: message }); },
    });
  }), [comando, attesaMs]);
}

async function apriPagina(openTab) {
  const page = await openTab('filo://preferences/preferences.html');
  await page.waitForFunction(() => !!window.filo?.shellExec, null, { timeout: 15_000 });
  return page;
}

test('un comando vuoto o di soli spazi non lascia la modalita\' terminale appesa', async ({ openTab }) => {
  const page = await apriPagina(openTab);
  for (const comando of ['', '   ', '\n', '\t\t']) {
    const esito = await lancia(page, comando, { attesaMs: 15_000 });
    expect(esito.appeso, `con il comando ${JSON.stringify(comando)} la modalita' terminale resta appesa e non risponde piu'`).toBeFalsy();
  }
  // E dopo il maltrattamento la shell e' ancora viva: e' questo che l'utente
  // vede, non il singolo comando vuoto.
  const dopo = await lancia(page, 'echo ancora-viva');
  expect(dopo.out, `dopo i comandi vuoti la shell non risponde piu': ${JSON.stringify(dopo)}`).toContain('ancora-viva');
});

test('un comando lungo diecimila caratteri arriva intero e risponde', async ({ openTab }) => {
  const page = await apriPagina(openTab);
  // `echo` con un argomento enorme: l'output deve tornare tutto, senza che il
  // marcatore di fine si perda per strada.
  const riempimento = 'x'.repeat(10_000);
  const esito = await lancia(page, `echo ${riempimento}`);
  expect(esito.appeso, 'un comando di diecimila caratteri lascia la modalita\' terminale appesa').toBeFalsy();
  expect(esito.out.length, `sono tornati solo ${esito.out.length} caratteri su 10.000`).toBeGreaterThan(9_000);
  expect(esito.code, 'il comando lungo non e\' arrivato in fondo').toBe(0);
});

test('emoji, virgolette e caratteri speciali non rompono il comando', async ({ openTab }) => {
  const page = await apriPagina(openTab);
  const casi = [
    ['echo "ciao 🌍 mondo"', 'ciao 🌍 mondo'],
    ["echo 'niente $VARIABILE qui'", 'niente $VARIABILE qui'],
    ['echo "accenti: perché però"', 'accenti: perché però'],
    ['echo "<script>alert(1)</script>"', '<script>alert(1)</script>'],
    ['echo "punto;e;virgola"', 'punto;e;virgola'],
  ];
  for (const [comando, atteso] of casi) {
    const esito = await lancia(page, comando);
    expect(esito.appeso, `«${comando}» lascia la modalita' terminale appesa`).toBeFalsy();
    expect(esito.out, `«${comando}» non ha restituito quello che l'utente ha scritto: ${JSON.stringify(esito)}`)
      .toContain(atteso);
  }
});

test('un comando che fallisce lo dice, invece di far finta di essere riuscito', async ({ openTab }) => {
  const page = await apriPagina(openTab);
  const esito = await lancia(page, 'exit 3');
  expect(esito.appeso, 'un comando fallito lascia la modalita\' terminale appesa').toBeFalsy();
  expect(esito.code, `un comando uscito con 3 viene riportato come ${esito.code}`).toBe(3);
});

test('dieci comandi uno dietro l\'altro, e la cartella resta quella di prima', async ({ openTab }) => {
  const page = await apriPagina(openTab);
  for (let i = 0; i < 10; i++) {
    const esito = await lancia(page, `echo giro-${i}`);
    expect(esito.appeso, `al giro ${i} la modalita' terminale si e' piantata`).toBeFalsy();
    expect(esito.out, `al giro ${i} non e' tornato niente: ${JSON.stringify(esito)}`).toContain(`giro-${i}`);
  }
  // `cd` deve persistere: e' la cosa che un utente si aspetta da un terminale,
  // e passa dal marcatore che cambia con la shell.
  const dove = await lancia(page, 'cd / && pwd');
  expect(dove.out.trim(), `dopo «cd /» la cartella riportata e' ${JSON.stringify(dove.out.trim())}`).toContain('/');
  const dopo = await lancia(page, 'pwd');
  expect(dopo.out.trim(), 'il «cd» non e\' rimasto: ogni comando riparte da capo').toBe('/');
});
