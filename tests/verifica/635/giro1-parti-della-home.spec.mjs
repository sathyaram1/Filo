// Verifica #635, giro 1 — la home divisa in parti resta una home sola.
//
// La segnalazione chiedeva di tagliare la pagina della nuova scheda in quattro
// pezzi. Per chi la usa NON deve cambiare niente: è questo che si prova qui,
// dal di fuori, senza guardare com'è stato tagliato.
//
// Le tre cose che un taglio così rompe in silenzio, e che qui diventano rosse:
//
//  1. un pezzo che la pagina non carica: la home muore alla prima riga che lo
//     nomina, e lo si scopre solo aprendo quella schermata;
//  2. lo stato tenuto in due copie: la cartella del terminale la cambiano tre
//     porte diverse, e la barra grigia finisce per raccontare una cartella in
//     cui non sei;
//  3. un blocco che si appende sempre nello stesso posto perché se lo pesca da
//     solo, invece di ricevere da chi lo crea il posto dove va.

import { test, expect } from '../../fixtures/electron.mjs';

const NEWTAB = 'filo://newtab/';

// Accende (o spegne) la modalità terminale su tutte le home aperte, e nello
// storage per quelle che si apriranno dopo.
async function accendiTerminale(app, acceso = true) {
  await app.evaluate(async ({ webContents }, on) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
      if (url.includes('newtab') || url.includes('dashboard')) {
        wc.send('filo:broadcast', {
          type: 'settings_updated',
          settings: { terminal: { enabled: on, shell: 'bash' } },
        });
      }
    }
    try { await globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: on, shell: 'bash' } }); } catch (_) {}
  }, acceso);
}

test('la home si apre intera: nessun errore, e ognuna delle sue parti risponde', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const guasti = [];
  page.on('pageerror', (e) => guasti.push(String((e && e.message) || e)));
  page.on('console', (m) => { if (m.type() === 'error') guasti.push(m.text()); });

  // Quello che l'utente vede: barra di scrittura, controlli in alto a destra,
  // le tre colonne. Se un pezzo non si è caricato, la pagina muore prima di qui.
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('#dash')).toBeVisible();
  await expect.poll(async () => page.locator('#dashControls > *').count(), { timeout: 8_000 })
    .toBeGreaterThan(0);

  const stato = await page.evaluate(() => {
    const parti = Object.keys(window).filter((k) => k.startsWith('SN_DASH_')).sort();
    return {
      parti,
      init: parti.map((k) => typeof window[k].init),
      hook: window.__filoDashActions ? Object.keys(window.__filoDashActions).sort() : null,
      creaConContenitore: typeof window.SN_DASH_ATTIVITA?.create,
    };
  });
  expect(stato.parti).toEqual([
    'SN_DASH_ATTIVITA', 'SN_DASH_COMANDI', 'SN_DASH_ONBOARDING', 'SN_DASH_TERMINALE',
  ]);
  expect(stato.init).toEqual(['function', 'function', 'function', 'function']);
  expect(stato.creaConContenitore).toBe('function');
  // L'aggancio con cui una ventina di spec disegnano azioni senza pilotare il
  // modello: se cambia forma, si rompono tutti insieme.
  expect(stato.hook).toEqual(['applyCommandCwd', 'getCwd', 'refreshAccountControl', 'renderActions']);

  // La home si ricarica senza lasciarsi dietro errori (un modulo che tocca il
  // DOM al caricamento, o un globale che non c'è, uscirebbe qui).
  await page.reload();
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  expect(guasti, `la home ha stampato errori: ${guasti.join(' | ')}`).toEqual([]);
});

test('la cartella corrente è una sola: quella che Filo cambia è quella che la barra usa', async ({ app, openTab }) => {
  // Tre porte cambiano la cartella (un `cd` digitato, un `cd` che Filo esegue
  // dentro una risposta, il valore ripescato all'avvio). Con una copia per
  // pezzo, la riga grigia e il controllo «questo comando esiste?» finiscono a
  // guardare cartelle diverse: qui si chiede che siano la stessa.
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  await accendiTerminale(app, true);
  await expect(page.locator('#input')).toHaveAttribute('placeholder', /comando per la shell/, { timeout: 8_000 });

  // Registriamo con quale cartella viene chiesto «esiste questo comando?».
  await page.evaluate(() => {
    window.__cwdChiesti = [];
    window.filo = window.filo || {};
    window.filo.shellWhich = async (opts) => {
      window.__cwdChiesti.push(String((opts && opts.cwd) || ''));
      return { exists: true };
    };
  });

  // Filo esegue un comando dentro una risposta e finisce in un'altra cartella.
  const NUOVA = '/tmp/filo-verifica-635';
  await page.evaluate((cwd) => {
    window.__filoDashActions.applyCommandCwd([
      { type: 'ESEGUI_COMANDO', _output: { command: 'cd /tmp/filo-verifica-635', stdout: '', cwd } },
    ]);
  }, NUOVA);

  // 1) La riga grigia sopra la barra dice dove sei davvero.
  await expect(page.locator('#dashDir')).toHaveText(NUOVA, { timeout: 8_000 });
  await expect(page.locator('#dashDir')).toBeVisible();
  // 2) Chi legge la cartella dall'esterno legge la stessa.
  expect(await page.evaluate(() => window.__filoDashActions.getCwd())).toBe(NUOVA);
  // 3) E il controllo del comando mentre si scrive parte da lì, non da una
  //    copia vecchia rimasta indietro.
  await page.locator('#input').fill('/ls');
  await expect.poll(async () => page.evaluate(() => window.__cwdChiesti.length), { timeout: 8_000 })
    .toBeGreaterThan(0);
  const chiesti = await page.evaluate(() => window.__cwdChiesti);
  expect(chiesti[chiesti.length - 1]).toBe(NUOVA);

  await accendiTerminale(app, false);
});

test('i comandi con lo slash rispondono ancora, e quello inventato resta rosso', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  const input = page.locator('#input');
  await expect(input).toBeVisible({ timeout: 8_000 });

  // Un comando vero: risponde, svuota la barra e rimette il cursore dentro.
  await input.fill('/help');
  await expect(input).toHaveClass(/is-cmd-filo/);
  await input.press('Enter');
  await expect(page.locator('#bubbles .dash-bubble').last()).toContainText('/help', { timeout: 8_000 });
  await expect(input).toHaveValue('');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('input');

  // Un comando inventato: rosso.
  await input.fill('/questo-non-esiste-635');
  await expect(input).toHaveClass(/is-cmd-unknown/);

  // Casi limite della barra: vuoto, soli spazi, la sola barra, emoji,
  // marcatura ostile, diecimila caratteri. La colorazione deve rispondere
  // senza far morire la pagina, e niente di quello che si scrive diventa
  // parte della pagina.
  const limiti = ['', '   ', '/', '/   ', '😀🧵', '<script>window.__rotto=1</script>',
    '/\u0000help', `/${'a'.repeat(10_000)}`];
  for (const testo of limiti) {
    await input.fill(testo);
    const classe = await page.evaluate((t) => {
      const c = window.SN_DASH_COMANDI.classifyInput(t);
      return typeof c === 'string' ? c : null;
    }, testo);
    expect(classe, `classificazione di ${JSON.stringify(testo.slice(0, 40))}`).not.toBeNull();
  }
  // Invio a barra vuota e a soli spazi: non deve succedere niente di strano.
  await input.fill('');
  await input.press('Enter');
  await input.fill('   ');
  await input.press('Enter');
  await expect(input).toBeVisible();
  expect(await page.evaluate(() => window.__rotto === undefined)).toBe(true);
  expect(await page.evaluate(() => document.querySelectorAll('script[data-iniettato]').length)).toBe(0);
});

test('il blocco di attività si appende dove glielo si dice, e il testo ostile resta testo', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

  const esito = await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'contenitore-di-prova';
    document.body.appendChild(host);
    const act = window.SN_DASH_ATTIVITA.create(host);
    act.addRow('CERCA_WEB', '🔎', '<img src=x onerror="window.__rotto=1">');
    act.addCommand({ command: '<script>window.__rotto=1</script>', stdout: 'ok', executed: true });
    act.finish({ failed: false });
    return {
      dentroIlContenitore: host.querySelectorAll('.dash-activity').length,
      nelleBolle: document.getElementById('bubbles').querySelectorAll('.dash-activity').length,
      immaginiIniettate: host.querySelectorAll('img').length,
      scriptIniettati: host.querySelectorAll('script').length,
      testo: host.textContent,
      rotto: window.__rotto,
    };
  });
  // Il contratto: il blocco va nel contenitore che gli si dà, non nelle bolle.
  expect(esito.dentroIlContenitore).toBe(1);
  expect(esito.nelleBolle).toBe(0);
  // Il testo che arriva da fuori resta testo.
  expect(esito.immaginiIniettate).toBe(0);
  expect(esito.scriptIniettati).toBe(0);
  expect(esito.rotto).toBeUndefined();
  expect(esito.testo).toContain('onerror');
});

test('la home si legge in tema chiaro e in tema scuro', async ({ openTab }) => {
  const page = await openTab(NEWTAB);
  await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
  const visti = {};
  for (const tema of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.snTheme = t; }, tema);
    await expect(page.locator('#dash')).toBeVisible();
    visti[tema] = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      const inp = getComputedStyle(document.getElementById('input'));
      return { sfondo: cs.backgroundColor, testo: inp.color };
    });
    // Testo e sfondo non collassano sullo stesso colore (scritta invisibile).
    expect(visti[tema].sfondo).not.toBe(visti[tema].testo);
    await page.screenshot({ path: `tests/.shots/verifica-635-home-${tema}.png` }).catch(() => {});
  }
  // I due temi sono davvero due: se la home non reagisce al tema, qui è rossa.
  expect(visti.light.sfondo).not.toBe(visti.dark.sfondo);
});
