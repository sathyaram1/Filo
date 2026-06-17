// FEEDBACK (alpha): "voglio che i comandi e le risposte vengano sempre
// visualizzati. in questo caso erano semplici cd senza output quindi scrivi un
// testo apposito 'sei in []'. […] i testi dei comandi esistono ma sono bianchi.
// colorali del colore del resto del testo e mettili in un box dello stesso
// colore dell'utente ma rendi il box quadrato […] anche le risposte del
// terminale devono essere quadrate."
//
// Contratto (asserisce il SUCCESSO, non l'assenza di errore):
//   • un comando con output mostra riga di comando + output, entrambi leggibili;
//   • un `cd` senza output NON lascia una scatola vuota: mostra "sei in <cwd>";
//   • un altro comando muto mostra "(nessun output)" (mai una scatola vuota);
//   • la riga di comando è una scatola QUADRATA col colore della bolla utente
//     (sfondo scuro), così si distingue dalle bolle arrotondate.
//
// Pre-condizione che senza il fix fallirebbe: prima un `cd` senza output non
// rendeva alcun corpo (la scatola restava vuota/invisibile) e la riga di
// comando aveva sfondo trasparente con testo tenue.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// Renderizza una lista di azioni Filo nella conversazione della dashboard,
// usando l'hook esposto dalla pagina (window.__filoDashActions.renderActions),
// e ritorna l'HTML + alcuni dati calcolati dei nodi comando.
async function renderCmd(page, output) {
  return page.evaluate((out) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    window.__filoDashActions.renderActions(host, [{ type: 'ESEGUI_COMANDO', _output: out }]);
    const line = host.querySelector('.dash-cmd-line');
    const outEl = host.querySelector('.dash-cmd-output');
    const cs = line ? getComputedStyle(line) : null;
    return {
      lineText: line ? line.textContent : null,
      outText: outEl ? outEl.textContent : null,
      outIsEmpty: outEl ? outEl.classList.contains('dash-cmd-output-empty') : null,
      // border-radius piccolo (squadrato) → numero basso, < 8px
      lineRadius: cs ? parseFloat(cs.borderTopLeftRadius) : null,
      // lo sfondo della riga comando NON è trasparente (era il bug "testo bianco")
      lineBg: cs ? cs.backgroundColor : null,
    };
  }, output);
}

test('dashboard: un `cd` senza output mostra "sei in <cwd>", non una scatola vuota', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

  const r = await renderCmd(page, { command: 'cd ..', stdout: '', stderr: '', cwd: '/home/utente/progetti', executed: true });
  expect(r.lineText).toBe('$ cd ..');
  expect(r.outText).toBe('sei in /home/utente/progetti');
  expect(r.outIsEmpty).toBe(true);
  // scatola squadrata (non la bolla arrotondata da 16px)
  expect(r.lineRadius).toBeLessThan(8);
  // sfondo opaco (riga di comando leggibile, non più "testo bianco" trasparente)
  expect(r.lineBg).not.toBe('rgba(0, 0, 0, 0)');
  expect(r.lineBg).not.toBe('transparent');
});

test('dashboard: un comando con output mostra comando + risposta leggibili', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

  const r = await renderCmd(page, { command: 'ls', stdout: 'a.txt\nb.txt', stderr: '', executed: true });
  expect(r.lineText).toBe('$ ls');
  expect(r.outText).toContain('a.txt');
  expect(r.outText).toContain('b.txt');
  expect(r.outIsEmpty).toBe(false);
});

test('dashboard: un comando muto non-cd mostra "(nessun output)"', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

  const r = await renderCmd(page, { command: 'clear', stdout: '', stderr: '', executed: true });
  expect(r.lineText).toBe('$ clear');
  expect(r.outText).toBe('(nessun output)');
  expect(r.outIsEmpty).toBe(true);
});
