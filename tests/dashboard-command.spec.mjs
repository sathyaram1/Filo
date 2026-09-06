// Suite accorpata: comandi della barra dashboard (newtab).
//
// Unisce gli ex spec dashboard-command-color / dashboard-command-display /
// dashboard-command-focus / dashboard-commands-extra in UN solo avvio di
// Electron: i test condividono un'unica app lanciata in beforeAll. Ogni test
// apre comunque la SUA newtab fresca (DOM pulito), e un beforeEach riporta la
// modalità terminale a OFF prima di ogni test — così lo stato globale che un
// test attiva (terminale) non trapela in quello successivo, esattamente come
// quando ogni test girava su un'app appena lanciata.
//
// I body dei test sono identici agli originali (stessi assert): cambia solo da
// dove arrivano `app`/`shell`/`openTab` (helper locali sull'app condivisa).

import { _electron as electron, expect, test as base } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argomentiScala } from './fixtures/electron.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');
const NEWTAB = 'filo://newtab/';

// App condivisa per tutta la suite (1 avvio di Electron, non 1 per test).
let app = null;
let shell = null;
let userData = null;

const test = base; // alias, manteniamo la stessa API expect/test

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'filo-test-'));
  app = await electron.launch({
    args: [...argomentiScala, '.'],
    cwd: APP_ROOT,
    env: { ...process.env, FILO_USER_DATA: userData, NODE_ENV: 'test' },
  });
  shell = await app.firstWindow();
  await shell.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  try { await app.close(); } catch (_) {}
  try { rmSync(userData, { recursive: true, force: true }); } catch (_) {}
  app = null; shell = null; userData = null;
});

// Apre un URL come tab e ritorna la Page del WebContentsView (replica openTab
// del fixture, ma sull'app condivisa).
async function openTab(url) {
  const target = new URL(url).hostname;
  await shell.evaluate((u) => window.filoShell.tabs.open(u), url);
  const deadline = Date.now() + 10_000;
  let page = null;
  while (Date.now() < deadline) {
    page = app.windows().find((w) => {
      try { return new URL(w.url()).hostname === target; }
      catch (_) { return false; }
    });
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error(`openTab: nessuna window per ${url}`);
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return page;
}

// Riporta la modalità terminale a OFF su tutte le webContents dashboard/newtab,
// così i test che NON la vogliono partono da uno stato pulito (come con un'app
// appena lanciata). Eseguito prima di OGNI test.
test.beforeEach(async () => {
  await app.evaluate(async ({ webContents }) => {
    for (const wc of webContents.getAllWebContents()) {
      let url = '';
      try { url = wc.getURL(); } catch (_) {}
      if (url.includes('newtab') || url.includes('dashboard')) {
        wc.send('filo:broadcast', {
          type: 'settings_updated',
          settings: { terminal: { enabled: false } },
        });
      }
    }
    // Aggiorna anche lo storage, così le newtab aperte DOPO leggono OFF.
    try {
      await globalThis.SN_STORAGE.updateSettings({ terminal: { enabled: false } });
    } catch (_) {}
    // Azzera i timer persistiti: i timer sopravvivono in storage e ricompaiono
    // in ogni newtab (e nelle dashboard già aperte via live-update). Senza app
    // fresca per test, un timer creato da un test verrebbe contato anche nel
    // successivo. Cancella ogni timer e notifica le dashboard.
    try {
      const Mem = globalThis.SN_FILO_MEMORY;
      if (Mem) {
        const list = await Mem.listTimers();
        for (const t of list) { try { await Mem.deleteTimer(t.id); } catch (_) {} }
      }
      await globalThis.SN_STORAGE.set({ filo_timers: [] });
    } catch (_) {}
    try { globalThis.SN_HANDLERS?.broadcastLiveUpdate?.(); } catch (_) {}
  });
  // Chiudi eventuali tab lasciate aperte dal test precedente e qualunque
  // finestra incognito creata da un test, così ogni test riparte con ESATTAMENTE
  // una newtab nella finestra principale (come quando ogni test girava su
  // un'app appena lanciata). Chiudendo tutte le tab, il TabManager ne riapre
  // automaticamente una newtab fresca → count torna a 1.
  await app.evaluate(({ BrowserWindow }) => {
    // Chiudi le finestre incognito effimere create dal test "/incognito".
    for (const w of BrowserWindow.getAllWindows()) {
      if (w._filoIncognito) { try { w.close(); } catch (_) {} }
    }
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    if (!w || !w._filoTabs) return;
    for (const t of [...w._filoTabs.tabs]) {
      try { w._filoTabs.closeTab(t.id); } catch (_) {}
    }
  });
  // Attendi che la finestra principale torni a una sola tab (la newtab riaperta).
  await expect.poll(async () => app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w && w._filoTabs ? w._filoTabs.tabs.length : 0;
  }), { timeout: 8_000 }).toBe(1);
});

// ───────────────────────── dashboard-command-color ─────────────────────────
test.describe('colorazione comandi', () => {
  test('dashboard: i comandi "/" non riconosciuti diventano rossi mentre si digita', async () => {
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

  // In modalità terminale, "/comando" è azzurro se il comando esiste davvero
  // nella shell, rosso se non esiste. Era il caso segnalato (uno screenshot con
  // "/gargargus" azzurro): prima in terminale TUTTO "/x" era azzurro, anche la
  // roba inesistente. Su Linux (cloud) la shell è /bin/sh: `ls` esiste,
  // `gargargus` no.
  test('dashboard (terminale): /comando inesistente è rosso, esistente è azzurro', async () => {
    // Il controllo "il comando esiste?" usa la shell del sistema: su Linux/cloud
    // (/bin/sh) `ls` esiste e `gargargus` no. Su Windows con shell 'bash' il
    // resolver passa per WSL (wsl.exe): se WSL non è installato `ls` non si
    // risolve e l'asserzione is-cmd-shell non può passare. È un controllo
    // intrinsecamente legato alla shell Linux, quindi gira solo lì (le routine
    // automatiche sulle feature girano in cloud Linux). Su Windows lo saltiamo.
    test.skip(process.platform === 'win32', 'controllo shell ls/bash è specifico Linux/cloud (su Windows richiede WSL)');
    const page = await openTab(NEWTAB);
    const input = page.locator('#input');
    await expect(input).toBeVisible({ timeout: 8_000 });

    // Attiva la modalità terminale via broadcast impostazioni.
    await app.evaluate(async ({ webContents }) => {
      for (const wc of webContents.getAllWebContents()) {
        let url = '';
        try { url = wc.getURL(); } catch (_) {}
        if (url.includes('newtab') || url.includes('dashboard')) {
          wc.send('filo:broadcast', {
            type: 'settings_updated',
            settings: { terminal: { enabled: true, shell: 'bash' } },
          });
        }
      }
    });
    // La modalità terminale è attiva quando il placeholder cita la shell.
    await expect(input).toHaveAttribute('placeholder', /comando per la shell/, { timeout: 8_000 });

    // Comando inesistente → rosso (dopo il controllo "esiste?" con debounce).
    await input.fill('/gargargus');
    await expect(input).toHaveClass(/is-cmd-unknown/, { timeout: 8_000 });
    await expect(input).not.toHaveClass(/is-cmd-shell/);

    // Comando esistente (ls) → azzurro, non rosso.
    await input.fill('/ls');
    await expect(input).toHaveClass(/is-cmd-shell/, { timeout: 8_000 });
    await expect(input).not.toHaveClass(/is-cmd-unknown/);

    // Un comando interno di Filo resta arancione anche in terminale.
    await input.fill('/help');
    await expect(input).toHaveClass(/is-cmd-filo/);
    await expect(input).not.toHaveClass(/is-cmd-unknown/);
  });

  // FEEDBACK (alpha): "/dominio.tld inventato mi porta a una pagina bianca:
  // dovrebbe diventare rosso quando il sito non esiste e non fare nulla se inviato."
  //
  // Ora un "/sito.tld" viene verificato via DNS: se il dominio non risolve, l'input
  // diventa rosso e l'invio NON naviga (resta il testo in rosso). Mockiamo il
  // controllo DNS (window.filo.siteResolves) per essere deterministici e
  // indipendenti dalla rete: "nonesiste*" non risolve, tutto il resto sì.
  //
  // Pre-condizione che senza il fix fallirebbe: prima "/sito.tld" era sempre
  // arancione e l'invio navigava (svuotando l'input) anche per domini inventati.
  test('dashboard: /sito.tld inesistente diventa rosso e non naviga all’invio', async () => {
    const page = await openTab(NEWTAB);
    const input = page.locator('#input');
    await expect(input).toBeVisible({ timeout: 8_000 });

    // Mock del controllo DNS: i domini con "nonesiste" non risolvono.
    await page.evaluate(() => {
      window.filo = window.filo || {};
      window.filo.siteResolves = async ({ host }) => ({ ok: true, resolves: !/nonesiste/i.test(String(host)) });
    });

    // Sito inesistente → ROSSO (dopo il check DNS con debounce), non arancione.
    await input.fill('/nonesiste-davvero-xyz.io');
    await expect(input).toHaveClass(/is-cmd-unknown/, { timeout: 8_000 });
    await expect(input).not.toHaveClass(/is-cmd-filo/);

    // Invio: NON deve navigare → l'input conserva il testo (e resta rosso).
    // (Senza il fix l'invio avrebbe svuotato l'input e aperto una pagina bianca.)
    await input.press('Enter');
    await expect(input).toHaveValue('/nonesiste-davvero-xyz.io');
    await expect(input).toHaveClass(/is-cmd-unknown/);

    // Sito esistente (mock → risolve) → arancione, non rosso.
    await input.fill('/example.com');
    await expect(input).toHaveClass(/is-cmd-filo/, { timeout: 8_000 });
    await expect(input).not.toHaveClass(/is-cmd-unknown/);

    // Invio di un sito valido → naviga e svuota l'input.
    await input.press('Enter');
    await expect(input).toHaveValue('');
  });
});

// ──────────────────────── dashboard-command-display ────────────────────────
test.describe('visualizzazione comandi e risposte', () => {
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

  test('dashboard: un `cd` senza output mostra "sei in <cwd>", non una scatola vuota', async () => {
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

  test('dashboard: un comando con output mostra comando + risposta leggibili', async () => {
    const page = await openTab(NEWTAB);
    await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

    const r = await renderCmd(page, { command: 'ls', stdout: 'a.txt\nb.txt', stderr: '', executed: true });
    expect(r.lineText).toBe('$ ls');
    expect(r.outText).toContain('a.txt');
    expect(r.outText).toContain('b.txt');
    expect(r.outIsEmpty).toBe(false);
  });

  test('dashboard: un comando muto non-cd mostra "(nessun output)"', async () => {
    const page = await openTab(NEWTAB);
    await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

    const r = await renderCmd(page, { command: 'clear', stdout: '', stderr: '', executed: true });
    expect(r.lineText).toBe('$ clear');
    expect(r.outText).toBe('(nessun output)');
    expect(r.outIsEmpty).toBe(true);
  });
});

// ───────────────────────── dashboard-command-focus ─────────────────────────
test.describe('focus dopo invio comando', () => {
  async function newtabPage() {
    const deadline = Date.now() + 10_000;
    let win = null;
    while (Date.now() < deadline) {
      win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
      if (win) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(win, 'newtab non trovata entro 10s').toBeTruthy();
    await win.waitForLoadState('domcontentloaded');
    return win;
  }

  async function setTerminal(page, enabled) {
    await page.evaluate((v) => new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { terminal: { enabled: v } } },
        (r) => resolve(r),
      );
    }), enabled);
  }

  // Vero quando il focus è sull'input della barra.
  function inputIsFocused(page) {
    return page.evaluate(() => document.activeElement === document.getElementById('input'));
  }

  test('dopo un comando shell il focus torna nella barra', async () => {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage();
    await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });
    await setTerminal(page, true);
    await expect(page.locator('#dashDir')).toBeVisible({ timeout: 8_000 });

    // Invio reale: clicca la barra, scrivi, premi Enter.
    await page.locator('#input').click();
    await page.locator('#input').fill('/echo filo-focus-OK');
    await page.locator('#input').press('Enter');

    // Il comando è stato eseguito davvero…
    await expect(page.locator('.dash-term-out')).toContainText('filo-focus-OK', { timeout: 12_000 });
    // …e il cursore è ancora nella barra (l'utente può scrivere subito).
    await expect.poll(() => inputIsFocused(page), { timeout: 4_000 }).toBe(true);
  });

  test('dopo un comando Filo interno (/help) il focus torna nella barra', async () => {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await newtabPage();
    await expect(page.locator('#input')).toBeVisible({ timeout: 8_000 });

    await page.locator('#input').click();
    await page.locator('#input').fill('/help');
    await page.locator('#input').press('Enter');

    // /help scrive una bolla di aiuto…
    await expect(page.locator('.dash-bubble-filo')).toContainText('lista comandi', { timeout: 8_000 });
    // …e il cursore resta nella barra.
    await expect.poll(() => inputIsFocused(page), { timeout: 4_000 }).toBe(true);
  });
});

// ──────────────────────── dashboard-commands-extra ─────────────────────────
test.describe('comandi extra (timer/incognito/no-flicker)', () => {
  async function submit(page, command) {
    await page.evaluate((cmd) => {
      const input = document.getElementById('input');
      const form = document.getElementById('inputForm');
      input.value = cmd;
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }, command);
  }

  test('"/set timer 1" avvia un timer e lo mostra nell\'area live', async () => {
    const page = await openTab(NEWTAB);
    const input = page.locator('#input');
    await expect(input).toBeVisible({ timeout: 8_000 });

    // "/set timer 8" è riconosciuto come comando Filo (arancione), non rosso,
    // anche con gli argomenti.
    await input.fill('/set timer 8');
    await expect(input).toHaveClass(/is-cmd-filo/);
    await expect(input).not.toHaveClass(/is-cmd-unknown/);

    // Inviando "/set timer 1" compare un timer "Timer" nell'area live con il
    // conto alla rovescia (~1:00).
    await submit(page, '/set timer 1');
    const card = page.locator('#live .dash-live-card');
    await expect(card).toHaveCount(1, { timeout: 8_000 });
    await expect(card.locator('.dash-live-text')).toContainText('Timer');
    await expect(card.locator('.dash-live-text')).toContainText(/\d:\d\d/);
  });

  test('"/set timer 5:00" interpreta minuti:secondi', async () => {
    const page = await openTab(NEWTAB);
    const input = page.locator('#input');
    await expect(input).toBeVisible({ timeout: 8_000 });

    await submit(page, '/set timer 5:00');
    const card = page.locator('#live .dash-live-card');
    await expect(card).toHaveCount(1, { timeout: 8_000 });
    // 5 minuti → il countdown parte vicino a 5:00 (4:59/5:00).
    await expect(card.locator('.dash-live-text')).toContainText(/[45]:\d\d/);
  });

  test('"/set timer" senza durata valida non crea timer e spiega l\'uso', async () => {
    const page = await openTab(NEWTAB);
    const input = page.locator('#input');
    await expect(input).toBeVisible({ timeout: 8_000 });

    await submit(page, '/set timer abc');
    // Nessun timer creato.
    await expect(page.locator('#live .dash-live-card')).toHaveCount(0);
    // Filo risponde con l'uso corretto nel thread.
    await expect(page.locator('.dash-bubble')).toContainText(/set timer/i, { timeout: 8_000 });
  });

  test('"/set timer" con durata malformata coi due punti non crea timer', async () => {
    const page = await openTab(NEWTAB);
    const input = page.locator('#input');
    await expect(input).toBeVisible({ timeout: 8_000 });

    // "5:" (secondi mancanti), ":30" (minuti mancanti) e "5: 30" (spazio
    // interno) sono durate scritte a metà: nessuna deve avviare un timer,
    // ognuna deve produrre la risposta con l'uso corretto.
    const bubbles = page.locator('.dash-bubble-filo');
    for (const bad of ['5:', ':30', '5: 30']) {
      const before = await bubbles.count();
      await submit(page, `/set timer ${bad}`);
      // Filo risponde con l'uso corretto nel thread (nuova bolla)…
      await expect.poll(() => bubbles.count(), { timeout: 8_000 }).toBeGreaterThan(before);
      await expect(bubbles.last()).toContainText(/set timer/i);
      // …e nessun timer compare nell'area live.
      await expect(page.locator('#live .dash-live-card')).toHaveCount(0);
    }
  });

  test('"/incognito" apre una finestra in incognito', async () => {
    const page = await openTab(NEWTAB);
    const input = page.locator('#input');
    await expect(input).toBeVisible({ timeout: 8_000 });

    // "/incognito" è un comando Filo riconosciuto (arancione).
    await input.fill('/incognito');
    await expect(input).toHaveClass(/is-cmd-filo/);

    await submit(page, '/incognito');

    // Il main crea una finestra incognito (TabManager effimero).
    const deadline = Date.now() + 15_000;
    let info = null;
    while (Date.now() < deadline) {
      info = await app.evaluate(({ BrowserWindow }) => {
        const incog = BrowserWindow.getAllWindows().find((w) => w._filoIncognito);
        if (!incog) return null;
        return { count: BrowserWindow.getAllWindows().length, incognito: !!(incog._filoTabs && incog._filoTabs.incognito) };
      });
      if (info) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(info, 'la finestra incognito deve aprirsi').toBeTruthy();
    expect(info.incognito).toBe(true);
  });

  test('terminale: un "/comando" in verifica è già rosso (niente flicker a neutro)', async () => {
    const page = await openTab(NEWTAB);
    const input = page.locator('#input');
    await expect(input).toBeVisible({ timeout: 8_000 });

    // Attiva la modalità terminale via broadcast impostazioni.
    await app.evaluate(async ({ webContents }) => {
      for (const wc of webContents.getAllWebContents()) {
        let url = '';
        try { url = wc.getURL(); } catch (_) {}
        if (url.includes('newtab') || url.includes('dashboard')) {
          wc.send('filo:broadcast', {
            type: 'settings_updated',
            settings: { terminal: { enabled: true, shell: 'bash' } },
          });
        }
      }
    });
    await expect(input).toHaveAttribute('placeholder', /comando per la shell/, { timeout: 8_000 });

    // Digita un comando non ancora verificato e leggi la classe SUBITO dopo il
    // gestore 'input' (sincrono), PRIMA che parta il controllo "esiste?" con
    // debounce. Senza il fix lo stato 'pending' non riceveva colore (neutro):
    // il rosso sarebbe comparso solo ~250ms dopo, da cui il flicker.
    const cls = await page.evaluate(() => {
      const i = document.getElementById('input');
      i.value = '/zzqzx';
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return i.className; // letto in modo sincrono
    });
    expect(cls).toMatch(/is-cmd-unknown/);
  });
});
