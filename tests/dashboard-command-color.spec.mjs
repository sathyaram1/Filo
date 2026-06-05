// Evidenziazione live dei comandi nella nuova scheda (dashboard).
//
// FEEDBACK (alpha): "puoi cambiare la colorazione dei comandi mentre li digito
// rendendoli rossi se non verrebbero riconosciuti?"
//
// La dashboard già coloriva arancione i comandi Filo / i siti e azzurro i
// comandi shell. Ora un "/comando" che NON verrà riconosciuto (né interno né
// sito, in modalità normale) viene colorato di rosso (classe is-cmd-unknown),
// così l'utente vede al volo che non farà nulla di speciale.
//
// Pre-condizione che senza il fix fallirebbe: prima un "/xyz" sconosciuto non
// riceveva alcuna classe (classifyInput tornava 'none'), quindi nessun rosso.

import { test, expect } from './fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

test('dashboard: i comandi "/" non riconosciuti diventano rossi mentre si digita', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });

  // Comando Filo noto → arancione (filo), non rosso.
  await input.fill('/help');
  await expect(input).toHaveClass(/is-cmd-filo/);
  await expect(input).not.toHaveClass(/is-cmd-unknown/);

  // Navigazione a sito → arancione (filo), non rosso.
  await input.fill('/google.com');
  await expect(input).toHaveClass(/is-cmd-filo/);
  await expect(input).not.toHaveClass(/is-cmd-unknown/);

  // Prefisso di un comando valido ("/he" → "/help"): niente rosso (l'utente
  // sta ancora digitando), così non lampeggia a ogni tasto.
  await input.fill('/he');
  await expect(input).not.toHaveClass(/is-cmd-unknown/);
  await expect(input).not.toHaveClass(/is-cmd-filo/);

  // "/xyz" non è un comando né un sito → ROSSO.
  await input.fill('/xyz');
  await expect(input).toHaveClass(/is-cmd-unknown/);
  await expect(input).not.toHaveClass(/is-cmd-filo/);

  // Anche con argomenti, se il primo token non è riconosciuto → rosso.
  await input.fill('/xyz qualcosa');
  await expect(input).toHaveClass(/is-cmd-unknown/);

  // Testo normale (senza "/") → nessuna classe comando.
  await input.fill('ciao come stai');
  await expect(input).not.toHaveClass(/is-cmd-unknown/);
  await expect(input).not.toHaveClass(/is-cmd-filo/);
  await expect(input).not.toHaveClass(/is-cmd-shell/);

  // Svuotando l'input, il rosso sparisce.
  await input.fill('/xyz');
  await expect(input).toHaveClass(/is-cmd-unknown/);
  await input.fill('');
  await expect(input).not.toHaveClass(/is-cmd-unknown/);
});
