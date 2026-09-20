// Verifica #635, giro 2 — le porte fra una parte e l'altra della home.
//
// Il giro 1 ha provato che la home si apre intera, che i comandi con lo slash
// rispondono, che l'accoglienza va avanti e che la cartella del terminale è
// una sola. Restavano fuori tre passaggi in cui una parte deve fidarsi di
// un'altra, e che un taglio sbagliato rompe senza far rumore:
//
//  1. l'interruttore del terminale, che sta in un pezzo, e il colore della
//     barra di scrittura, che sta in un altro: acceso e SPENTO. Spegnere è la
//     metà che nessuno prova, ed è quella che lascia un pezzo a credere di
//     essere ancora acceso;
//  2. «sono io il proprietario?», che la home sa e i comandi usano: entrando
//     e USCENDO. Se la risposta resta ferma a com'era, la posta delle
//     segnalazioni si apre a chi non la deve vedere, o non si apre più a chi
//     la gestisce;
//  3. la fine dell'accoglienza, che è un pezzo, e la home che deve riempirsi,
//     che è un altro: il messaggio in mezzo e i suggerimenti arrivano da lì.
//
// In coda, la barra di scrittura sotto pressione: comandi ripetuti in fretta,
// testo enorme, caratteri ostili.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// Manda un messaggio alle home aperte, come fa il resto dell'app.
async function annuncia(app, messaggio) {
  await app.evaluate(({ webContents }, msg) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
      if (url.includes('newtab') || url.includes('dashboard')) wc.send('filo:broadcast', msg);
    }
  }, messaggio);
}

const terminale = (acceso) => ({
  type: 'settings_updated',
  settings: { terminal: { enabled: acceso, shell: 'bash' } },
});

test('il terminale si spegne come si accende: la barra smette di parlare alla shell', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });

  // Niente shell vera: registriamo chi la chiama e cosa le chiede.
  await page.evaluate(() => {
    window.__eseguiti = [];
    window.filo = window.filo || {};
    window.filo.shellWhich = async () => ({ exists: true });
    window.filo.shellExec = ({ command, onExit }) => {
      window.__eseguiti.push(command);
      setTimeout(() => onExit({ code: 0, cwd: '' }), 10);
      return { abort() {}, sendInput() {} };
    };
  });

  // ── Acceso ───────────────────────────────────────────────────────────────
  await annuncia(app, terminale(true));
  await expect(input).toHaveAttribute('placeholder', /comando per la shell/, { timeout: 8_000 });
  await input.fill('/echo ciao');
  await expect(input).toHaveClass(/is-cmd-shell/, { timeout: 8_000 });
  await input.press('Enter');
  // Il comando è finito alla shell e in chat c'è la sua finestra di output.
  await expect.poll(async () => page.evaluate(() => window.__eseguiti.length), { timeout: 8_000 }).toBe(1);
  await expect(page.locator('#bubbles .dash-term')).toHaveCount(1, { timeout: 8_000 });
  await expect(input).toHaveValue('');

  // ── Spento ───────────────────────────────────────────────────────────────
  // Se si può accendere si deve poter spegnere, e spegnere deve valere per
  // TUTTE le parti: la riga grigia della cartella, il testo della barra, il
  // colore mentre si scrive e — la cosa che conta — dove finisce l'invio.
  await annuncia(app, terminale(false));
  await expect(input).toHaveAttribute('placeholder', /^Chiedi qualsiasi cosa…$/, { timeout: 8_000 });
  await expect(page.locator('#dashDir')).toBeHidden();

  await input.fill('/echo ciao');
  await expect(input).not.toHaveClass(/is-cmd-shell/, { timeout: 8_000 });
  // A terminale spento un "/comando" sconosciuto non è più roba da shell: la
  // home lo lascia alla conversazione invece di eseguirlo.
  const preso = await page.evaluate(() => window.SN_DASH_COMANDI.handleSlashCommand('/echo ciao'));
  expect(preso, 'a terminale spento la home esegue ancora comandi di shell').toBe(false);
  expect(await page.evaluate(() => window.__eseguiti.length)).toBe(1);

  // E riaccendendolo torna tutto: l'interruttore funziona nei due versi.
  await annuncia(app, terminale(true));
  await expect(input).toHaveAttribute('placeholder', /comando per la shell/, { timeout: 8_000 });
  const ripreso = await page.evaluate(() => window.SN_DASH_COMANDI.handleSlashCommand('/echo ancora'));
  expect(ripreso).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.__eseguiti.length), { timeout: 8_000 }).toBe(2);

  await annuncia(app, terminale(false));
});

test('la posta delle segnalazioni segue chi è entrato, e si richiude quando esce', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });
  const ultimaBolla = page.locator('#bubbles .dash-bubble').last();

  // ── Nessun accesso: il comando spiega e indica l'altra strada ─────────────
  await input.fill('/feedback');
  await input.press('Enter');
  await expect(ultimaBolla).toContainText('li vede chi li gestisce', { timeout: 8_000 });
  await input.fill('/help');
  await input.press('Enter');
  await expect(ultimaBolla).not.toContainText('posta delle segnalazioni', { timeout: 8_000 });

  // ── Entra il proprietario ────────────────────────────────────────────────
  await annuncia(app, {
    type: 'auth_changed',
    signedIn: true,
    isAdmin: true,
    profile: { name: 'Proprietario', email: 'owner@esempio.test' },
  });
  await expect.poll(async () => {
    await input.fill('/help');
    await input.press('Enter');
    return page.locator('#bubbles .dash-bubble').last().innerText();
  }, { timeout: 8_000 }).toContain('posta delle segnalazioni');

  // Adesso il comando apre davvero la posta invece di spiegare.
  await input.fill('/feedback');
  await input.press('Enter');
  await expect.poll(async () => app.evaluate(({ webContents }) => webContents
    .getAllWebContents()
    .map((wc) => { try { return wc.getURL(); } catch (_) { return ''; } })
    .some((u) => u.includes('feedback/feedback.html'))), { timeout: 10_000 }).toBe(true);
  await expect(page.locator('#bubbles .dash-bubble').last())
    .not.toContainText('li vede chi li gestisce');

  // ── Esce ─────────────────────────────────────────────────────────────────
  // La risposta «sei il proprietario» non deve restare ferma a com'era.
  await annuncia(app, { type: 'auth_changed', signedIn: false, profile: null });
  await expect.poll(async () => {
    await input.fill('/feedback');
    await input.press('Enter');
    return page.locator('#bubbles .dash-bubble').last().innerText();
  }, { timeout: 8_000 }).toContain('li vede chi li gestisce');
  await input.fill('/help');
  await input.press('Enter');
  await expect(page.locator('#bubbles .dash-bubble').last())
    .not.toContainText('posta delle segnalazioni');
});

test('finita l’accoglienza la home si riempie: il messaggio in mezzo e i suggerimenti', async ({ app, openTab }) => {
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

  // La fine dell'intervista la annuncia il main: il messaggio centrale e i
  // suggerimenti che arrivano con lei sono lo stato della HOME, scritto da
  // un'altra parte. Se quello stato è rimasto in due copie, qui la home resta
  // vuota mentre la parte dell'accoglienza crede di averla riempita.
  await annuncia(app, {
    type: 'filo_onboarding_done',
    message: 'Bentornato, ho imparato come lavori.',
    suggestions: [
      { text: 'Riprendi la lettura di ieri', icon: 'book', importance: 5 },
      { text: 'Archivia le schede vecchie', icon: 'broom', importance: 4 },
    ],
  });

  await expect(page.locator('#homeMessage')).toHaveText('Bentornato, ho imparato come lavori.', { timeout: 10_000 });
  await expect(page.locator('#suggestions .dash-suggestion')).toHaveCount(2, { timeout: 10_000 });
  await expect(page.locator('#suggestions')).toContainText('Riprendi la lettura di ieri');
  // L'intervista è chiusa: la chat è sparita e si riparte dalla home.
  await expect(page.locator('body')).toHaveAttribute('data-state', 'home');
});

test('quello che disegnano le parti si legge, in chiaro e in scuro', async ({ app, openTab }) => {
  // Il blocco di attività e la finestra di output del terminale sono i due
  // pezzi di schermo che il taglio ha spostato di file. Qui si guarda che
  // arrivino a schermo interi e leggibili nei due temi: un colore rimasto
  // indietro in un foglio di stile si vedrebbe qui.
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  await page.evaluate(() => {
    window.filo = window.filo || {};
    window.filo.shellWhich = async () => ({ exists: true });
    window.filo.shellExec = ({ onData, onExit }) => {
      onData({ chunk: 'primo\n\u001b[31mrosso\u001b[0m\nultimo\n', stream: 'stdout' });
      setTimeout(() => onExit({ code: 0, cwd: '/tmp/filo-verifica-635' }), 10);
      return { abort() {}, sendInput() {} };
    };
  });
  await annuncia(app, terminale(true));
  await expect(page.locator('#input')).toHaveAttribute('placeholder', /comando per la shell/, { timeout: 8_000 });
  await page.locator('#input').fill('/echo prova');
  await page.locator('#input').press('Enter');
  await expect(page.locator('#bubbles .dash-term-out')).toContainText('rosso', { timeout: 8_000 });
  // Il comando che hai scritto si rilegge sopra il suo output: senza, una
  // conversazione di comandi diventa una pila di risposte senza domande.
  await expect(page.locator('#bubbles .dash-term-cmd')).toContainText('echo prova', { timeout: 8_000 });
  // La cartella che il comando ha lasciato compare nella riga sopra la barra.
  await expect(page.locator('#dashDir')).toHaveText('/tmp/filo-verifica-635', { timeout: 8_000 });

  // E un blocco di attività, disegnato dall'altra parte, nelle stesse bolle.
  await page.evaluate(() => {
    const act = window.SN_DASH_ATTIVITA.create(document.getElementById('bubbles'));
    act.addRow('CERCA_WEB', '🔎', 'orari dei treni');
    act.finish({ failed: false });
  });
  await expect(page.locator('#bubbles .dash-activity')).toHaveCount(1, { timeout: 8_000 });

  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.snTheme = t; }, tema);
    const colori = await page.evaluate(() => {
      const out = document.querySelector('#bubbles .dash-term-out');
      const att = document.querySelector('#bubbles .dash-activity');
      const cs = (el) => {
        const s = getComputedStyle(el);
        return { colore: s.color, sfondo: s.backgroundColor };
      };
      const cmd = document.querySelector('#bubbles .dash-term-cmd');
      const r = cmd.getBoundingClientRect();
      return {
        terminale: cs(out),
        attivita: cs(att),
        comando: cs(cmd),
        rettangoloComando: { x: Math.round(r.x), larghezza: Math.round(r.width), altezza: Math.round(r.height) },
        dietroIlComando: getComputedStyle(cmd.parentElement).backgroundColor,
        altezzaTerminale: out.getBoundingClientRect().height,
        altezzaAttivita: att.getBoundingClientRect().height,
      };
    });
    console.log(tema, JSON.stringify(colori.comando), JSON.stringify(colori.rettangoloComando), colori.dietroIlComando);
    // Niente scritte invisibili, niente blocchi schiacciati a zero.
    expect(colori.terminale.colore).not.toBe(colori.terminale.sfondo);
    expect(colori.attivita.colore).not.toBe(colori.attivita.sfondo);
    expect(colori.altezzaTerminale).toBeGreaterThan(10);
    expect(colori.altezzaAttivita).toBeGreaterThan(10);
    await page.screenshot({ path: `tests/.shots/verifica-635-giro2-parti-${tema}.png` }).catch(() => {});
  }
  await annuncia(app, terminale(false));
});

test('la barra di scrittura sotto pressione non porta giù nessuna parte', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });
  const guasti = [];
  page.on('pageerror', (e) => guasti.push(String((e && e.message) || e)));

  // Lo stesso comando dieci volte di fila, senza aspettare: ogni invio deve
  // lasciare la sua risposta e la barra pronta per il prossimo.
  for (let i = 0; i < 10; i++) {
    await input.fill('/help');
    await input.press('Enter');
  }
  await expect.poll(async () => page.locator('#bubbles .dash-bubble').count(), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(10);
  await expect(input).toHaveValue('');

  // Testo enorme e caratteri ostili dentro un comando che PRENDE argomenti:
  // deve rispondere spiegando l'uso, non morire e non finire nella pagina.
  for (const arg of ['a'.repeat(10_000), '<img src=x onerror="window.__rotto=1">', '\u0000', '😀'.repeat(500)]) {
    await input.fill(`/set timer ${arg}`);
    await input.press('Enter');
    await expect(input).toHaveValue('', { timeout: 8_000 });
  }
  await expect(page.locator('#bubbles .dash-bubble').last()).toContainText('timer', { timeout: 8_000 });
  expect(await page.evaluate(() => window.__rotto === undefined)).toBe(true);
  expect(await page.evaluate(() => document.querySelectorAll('#bubbles img').length)).toBe(0);

  // La home è ancora viva e ognuna delle sue parti risponde.
  const parti = await page.evaluate(() => Object.keys(window).filter((k) => k.startsWith('SN_DASH_')).sort());
  expect(parti).toEqual(['SN_DASH_ATTIVITA', 'SN_DASH_COMANDI', 'SN_DASH_ONBOARDING', 'SN_DASH_TERMINALE']);
  expect(guasti, `la home ha stampato errori: ${guasti.join(' | ')}`).toEqual([]);
});
