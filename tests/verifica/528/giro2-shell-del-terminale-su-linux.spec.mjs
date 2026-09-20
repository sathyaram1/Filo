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

// Le due strade equivalenti, provate facendo rispondere la shell stessa invece
// di fidarsi di cio' che le abbiamo chiesto: `$BASH_VERSION` e' vuota in sh e
// piena in bash.
const CHIEDI_CHI_SEI = 'echo "sono:${BASH_VERSION:-non-bash}"';

test('senza nessuna scelta, le due strade per lanciare un comando rispondono con la stessa shell', async ({ app }) => {
  const risposte = await app.evaluate(async ({}, comando) => {
    const { runCommand, resolveShell } = require('./src/main/services/terminal.js');
    const { createSession } = require('./src/main/services/shell.js');

    // Strada 1 — i comandi dell'assistente: nessuna preferenza salvata.
    const uno = await runCommand(comando, { trackCwd: true });

    // Strada 2 — la modalita' terminale della dashboard: stessa assenza di
    // scelta. La sessione e' persistente, quindi si aspetta l'uscita.
    const due = await new Promise((risolvi, rifiuta) => {
      const s = createSession({});
      let out = '';
      const stop = setTimeout(() => { try { s.kill(); } catch (_) {} rifiuta(new Error('la shell non ha risposto')); }, 20_000);
      s.exec(comando, {
        onData: ({ chunk }) => { out += chunk; },
        onExit: () => { clearTimeout(stop); try { s.kill(); } catch (_) {} risolvi({ out, shell: s.shell }); },
        onError: ({ message }) => { clearTimeout(stop); try { s.kill(); } catch (_) {} rifiuta(new Error(message)); },
      });
    });

    return {
      assistente: { out: uno.stdout || '', code: uno.code, shell: resolveShell(undefined) },
      terminale: { out: due.out, shell: due.shell },
    };
  }, CHIEDI_CHI_SEI);

  // Prima: tutte e due devono aver risposto. Su Linux una shell di Windows
  // fallirebbe con ENOENT, e l'utente vedrebbe un comando che non parte.
  expect(risposte.assistente.out, `i comandi dell'assistente non hanno prodotto niente: ${JSON.stringify(risposte.assistente)}`)
    .toContain('sono:');
  expect(risposte.terminale.out, `la modalita' terminale non ha prodotto niente: ${JSON.stringify(risposte.terminale)}`)
    .toContain('sono:');

  // Poi: e' la STESSA shell. Questo e' il rilievo del giro 1.
  const chi = (t) => (/sono:non-bash/.test(t) ? 'sh' : 'bash');
  expect(chi(risposte.assistente.out),
    `senza nessuna scelta l'assistente parla con ${chi(risposte.assistente.out)} e il terminale con ${chi(risposte.terminale.out)}: lo stesso comando puo' comportarsi in modo diverso a seconda di dove lo scrivi`)
    .toBe(chi(risposte.terminale.out));
});

test('chi sceglie Bash nelle Preferenze ottiene Bash su tutte e due le strade', async ({ app }) => {
  const risposte = await app.evaluate(async ({}, comando) => {
    const { runCommand } = require('./src/main/services/terminal.js');
    const { createSession } = require('./src/main/services/shell.js');

    const uno = await runCommand(comando, { shell: 'bash', trackCwd: true });
    const due = await new Promise((risolvi, rifiuta) => {
      const s = createSession({ shell: 'bash' });
      let out = '';
      const stop = setTimeout(() => { try { s.kill(); } catch (_) {} rifiuta(new Error('la shell non ha risposto')); }, 20_000);
      s.exec(comando, {
        onData: ({ chunk }) => { out += chunk; },
        onExit: () => { clearTimeout(stop); try { s.kill(); } catch (_) {} risolvi({ out, shell: s.shell }); },
        onError: ({ message }) => { clearTimeout(stop); try { s.kill(); } catch (_) {} rifiuta(new Error(message)); },
      });
    });
    return { assistente: uno.stdout || '', terminale: due.out };
  }, CHIEDI_CHI_SEI);

  expect(risposte.assistente, 'chi ha scelto Bash lancia i comandi dell\'assistente in un\'altra shell')
    .not.toMatch(/sono:non-bash/);
  expect(risposte.terminale, 'chi ha scelto Bash apre la modalita\' terminale in un\'altra shell')
    .not.toMatch(/sono:non-bash/);
});
