// Spec Playwright per la pagina di gestione (filo://manage/).
//
// Assert di COMPORTAMENTO:
//   - dashboard unificata (DB1): 8 tab, "Ricevuti" attiva di default; le tab
//     lista (Ricevuti/In coda/Risolti/Archiviati) condividono panel-list;
//     stats/models sono segnaposto; "Automazioni" raccoglie le impostazioni;
//   - lo switch "Modalità automatica" vive nella tab "Automazioni",
//     si attiva/disattiva e lo stato sopravvive al ricaricamento;
//   - il numero di tentativi del loop di correzione è editabile e persiste;
//   - con dati finti iniettati, un blocco compare in "Ricevuti" (richiede la mia
//     approvazione) e il click apre il pannello centrale con le bolle;
//   - un feedback in `clarify` mostra il box risposta dell'owner sotto Ricevuti.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

// Feedback finto con pipeline "attack" per popolare la lista
const FAKE_FB = {
  _id: 'test-fb-001',
  text: 'Questo è un feedback di test con contenuto malevolo.',
  name: 'Test attacco finto',
  seq: 99,
  subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-06-22T10:00:00Z',
  images: [],
  pipeline: {
    action: 'block_attack',
    l1Category: 'dangerous',
    l2Class: 'attack',
    stage: 'L2',
    verdicts: [
      { judge: 'A', class: 'attack', reasoning: 'Questo messaggio tenta di aggirare i filtri di sicurezza.' },
      { judge: 'B', class: 'attack', reasoning: 'Prompt injection rilevata.' },
    ],
    filoSummary: 'Il feedback contiene un tentativo di attacco tramite prompt injection.',
    decidedAt: '2026-06-22T10:01:00Z',
  },
};

test('le 8 tab esistono col testo corretto e "Ricevuti" e\' attiva di default (DB1)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  // 8 tab della dashboard unificata.
  await expect(page.locator('.mg-tab')).toHaveCount(8);
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveText('Ricevuti');
  await expect(page.locator('.mg-tab[data-tab="queue"]')).toHaveText('In coda');
  await expect(page.locator('.mg-tab[data-tab="resolved"]')).toHaveText('Risolti');
  await expect(page.locator('.mg-tab[data-tab="archived"]')).toHaveText('Archiviati');
  await expect(page.locator('.mg-tab[data-tab="stats"]')).toHaveText('Statistiche Red Team');
  await expect(page.locator('.mg-tab[data-tab="models"]')).toHaveText('Modelli di supporto');
  await expect(page.locator('.mg-tab[data-tab="automation"]')).toHaveText('Automazioni');
  await expect(page.locator('.mg-tab[data-tab="log"]')).toHaveText('Log');

  // La vecchia tab "Revisione" non esiste più (assorbita in "In coda").
  await expect(page.locator('.mg-tab[data-tab="review"]')).toHaveCount(0);

  // "Ricevuti" attiva di default → mostra il pannello lista condiviso.
  await expect(page.locator('.mg-tab[data-tab="inbox"]')).toHaveClass(/mg-tab--active/);
  await expect(page.locator('#panel-list')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('#mgListHead')).toHaveText('Ricevuti');
});

test('le tab-lista condividono panel-list; stats/models sono segnaposto "In arrivo" (DB1)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  // Le 4 tab-lista usano lo STESSO pannello (panel-list), cambia solo l'intestazione.
  for (const [tab, head] of [['queue', 'In coda'], ['resolved', 'Risolti'], ['archived', 'Archiviati'], ['inbox', 'Ricevuti']]) {
    await page.locator(`.mg-tab[data-tab="${tab}"]`).click();
    await expect(page.locator('#panel-list')).toHaveClass(/mg-panel--active/);
    await expect(page.locator('#mgListHead')).toHaveText(head);
  }

  // Statistiche Red Team → segnaposto dedicato.
  await page.locator('.mg-tab[data-tab="stats"]').click();
  await expect(page.locator('#panel-stats')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('#panel-stats .mg-coming')).toBeVisible();
  await expect(page.locator('#panel-list')).not.toHaveClass(/mg-panel--active/);

  // Modelli di supporto → pannello dedicato (DD1: non più un segnaposto).
  await page.locator('.mg-tab[data-tab="models"]').click();
  await expect(page.locator('#panel-models')).toHaveClass(/mg-panel--active/);
  await expect(page.locator('#panel-list')).not.toHaveClass(/mg-panel--active/);
});

test('lo switch "Modalità automatica" vive nella tab Automazioni ed è read-only per i non-admin', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  const sw    = page.locator('#mgAutoSwitch');
  const input = page.locator('#mgAutoToggle');

  // Lo switch non è più nella barra in alto: è dentro la tab "Automazioni".
  await expect(sw).toBeHidden();
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await expect(page.locator('#panel-automation')).toHaveClass(/mg-panel--active/);
  await expect(sw).toBeVisible();

  // Cambiando tab lo switch non è più visibile (è una sezione, non globale).
  await page.locator('.mg-tab[data-tab="queue"]').click();
  await expect(sw).toBeHidden();

  // Da non-admin (userData pulito → nessuna sessione) lo switch è disabilitato:
  // stesso contratto di sola lettura del banner.
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await expect(input).toBeDisabled();
  await expect(sw).toHaveClass(/mg-switch--disabled/);
});

test('lo switch attiva/disattiva la modalità automatica e lo stato persiste', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');

  // Lo switch vive nella tab Automazioni.
  await page.locator('.mg-tab[data-tab="automation"]').click();
  const input = page.locator('#mgAutoToggle');
  const state = page.locator('#mgAutoState');

  // Stato iniziale: spento.
  await expect(input).not.toBeChecked();
  await expect(state).toHaveText('Off');

  // DA3: a riposo la pista è un grigio marcato (`--sn-muted`), non più
  // `--sn-border` che sul tema chiaro era quasi invisibile. Confronto col valore
  // del token risolto in rgb → theme-independent, rosso se si torna a --sn-border.
  const trackOk = await page.evaluate(() => {
    // La pista DI QUESTO interruttore: la tab ne contiene altri (interruttore
    // master delle routine, mittenti, esplorazione) e "il primo della pagina"
    // dipenderebbe dall'ordine dei blocchi.
    const track = document.querySelector('#mgAutoToggle + .mg-switch-track');
    const bg = getComputedStyle(track).backgroundColor;
    const probe = document.createElement('span');
    probe.style.color = 'var(--sn-muted)';
    document.body.appendChild(probe);
    const muted = getComputedStyle(probe).color;
    probe.style.color = 'var(--sn-border)';
    const border = getComputedStyle(probe).color;
    probe.remove();
    return { isMuted: bg === muted, isBorder: bg === border };
  });
  expect(trackOk.isMuted).toBe(true);
  expect(trackOk.isBorder).toBe(false);

  // …ma il colore giusto su una scatola 0×0 non si vede. `.sn-page label` di
  // pages.css imponeva `display: block` alla label (specificità più alta di
  // `.mg-switch`), i figli tornavano `inline` e del pill restava solo la pallina,
  // che è in posizione assoluta: mezzo interruttore, per settimane. Qui si
  // asserisce la GEOMETRIA, che è ciò che era rotto.
  const geom = await page.evaluate(() => {
    const r = document.querySelector('.mg-switch-track').getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  expect(geom.w).toBeGreaterThan(20);
  expect(geom.h).toBeGreaterThan(10);

  // #446 — accendere lo switch deve arrivare alla config che il backend dei
  // giudici legge (config/automation.enabled), non solo alla cache locale: fino
  // al 2026-08-12 finiva SOLO in chrome.storage.local, che nessuno leggeva, e
  // l'automatica "attiva" non faceva niente.
  await stubAutomation(page);
  await page.evaluate(() => {
    const el = document.getElementById('mgAutoToggle');
    el.disabled = false;
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(input).toBeChecked();
  await expect(state).toHaveText('On');

  // È QUESTO l'assert che conta: il valore ha lasciato il client.
  await expect.poll(() => page.evaluate(() => window.__automationSets)).toEqual([
    { enabled: true },
  ]);
  expect(await page.evaluate(() => window.__automation.enabled)).toBe(true);

  // La cache locale resta allineata (serve a mostrare subito il valore giusto
  // alla riapertura, prima che risponda l'IPC).
  const stored = await page.evaluate(async () => {
    const d = await window.chrome.storage.local.get('filo_auto_mode');
    return d.filo_auto_mode;
  });
  expect(stored).toBe(true);
});

test("se il salvataggio fallisce lo switch NON resta acceso a vuoto", async ({ openTab }) => {
  // Uno switch che dice "On" mentre la config è rimasta spenta è peggio di un
  // errore: è la versione muta del bug #446.
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
  await page.locator('.mg-tab[data-tab="automation"]').click();

  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_set') return { ok: false, error: 'non sei admin' };
      if (msg && msg.type === 'automation_get') return { ok: false, error: 'non sei admin' };
      return orig(msg);
    };
  });

  await page.evaluate(() => {
    const el = document.getElementById('mgAutoToggle');
    el.disabled = false;
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('#mgAutoToggle')).not.toBeChecked();
  await expect(page.locator('#mgAutoState')).toHaveText('Off');
  await expect(page.locator('#mgAutoMsg')).toContainText('NON è cambiata');
});

// Stub dell'IPC dell'automatica: simula il doc Firestore config/automation
// (campi `enabled`, `autoApprove`, `proberWhenIdle`) senza rete né main.
// `__automationSets` raccoglie ciò che il client MANDA: è la prova che
// l'impostazione lascia la pagina e arriva dove il backend la legge.
async function stubAutomation(page, initial = {}) {
  await page.evaluate((init) => {
    window.__automation = Object.assign({
      enabled: false,
      autoApprove: { owner: true, filo: true, claude: true, user: true },
      proberWhenIdle: true,
      routinesEnabled: true,
    }, init);
    window.__automationSets = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_get') {
        return Object.assign({ ok: true }, window.__automation);
      }
      if (msg && msg.type === 'automation_set') {
        const sent = {};
        if (typeof msg.enabled === 'boolean') {
          window.__automation.enabled = msg.enabled;
          sent.enabled = msg.enabled;
        }
        if (msg.autoApprove && typeof msg.autoApprove === 'object') {
          Object.assign(window.__automation.autoApprove, msg.autoApprove);
          sent.autoApprove = { ...msg.autoApprove };
        }
        if (typeof msg.proberWhenIdle === 'boolean') {
          window.__automation.proberWhenIdle = msg.proberWhenIdle;
          sent.proberWhenIdle = msg.proberWhenIdle;
        }
        if (typeof msg.routinesEnabled === 'boolean') {
          window.__automation.routinesEnabled = msg.routinesEnabled;
          sent.routinesEnabled = msg.routinesEnabled;
        }
        window.__automationSets.push(sent);
        return Object.assign({ ok: true }, window.__automation);
      }
      return orig(msg);
    };
  }, initial);
}

test('#446 — gli interruttori per mittente scrivono nella config, uno alla volta', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
  await page.locator('.mg-tab[data-tab="automation"]').click();

  await stubAutomation(page, { enabled: true });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadAutoMode());

  // Con l'automatica accesa gli interruttori sono azionabili e partono da "tutti".
  const user = page.locator('#mgAutoApproveUser');
  await expect(user).toBeEnabled();
  await expect(user).toBeChecked();
  await expect(page.locator('#mgAutoApproveClaude')).toBeChecked();

  // L'esempio dell'owner: gli utenti NON entrano più in coda da soli.
  await page.evaluate(() => {
    const el = document.getElementById('mgAutoApproveUser');
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__automation.autoApprove)).toEqual({
    owner: true, filo: true, claude: true, user: false,
  });
  // Gli altri interruttori non sono stati toccati.
  await expect(page.locator('#mgAutoApproveClaude')).toBeChecked();
  await expect(page.locator('#mgAutoApproveOwner')).toBeChecked();
});

test('#446 — con l\'automatica spenta gli interruttori per mittente non decidono niente', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
  await page.locator('.mg-tab[data-tab="automation"]').click();

  await stubAutomation(page, { enabled: false });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadAutoMode());

  for (const id of ['mgAutoApproveOwner', 'mgAutoApproveFilo', 'mgAutoApproveClaude', 'mgAutoApproveUser']) {
    await expect(page.locator('#' + id)).toBeDisabled();
  }
  await expect(page.locator('#mgAutoApproveBlock')).toHaveClass(/mg-auto-sub--off/);

  // Accendendo il master tornano azionabili, senza ricaricare la pagina.
  await page.evaluate(() => {
    const el = document.getElementById('mgAutoToggle');
    el.disabled = false;
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#mgAutoApproveUser')).toBeEnabled();
  await expect(page.locator('#mgAutoApproveBlock')).not.toHaveClass(/mg-auto-sub--off/);
});

test('#448 — spegnere l\'esplorazione a coda vuota arriva alla config delle routine', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
  await page.locator('.mg-tab[data-tab="automation"]').click();

  // Il checkbox è visivamente nascosto (switch custom: la levetta è il fratello
  // .mg-switch-track), quindi si asserisce sul controllo reale, non sulla resa.
  const sw = page.locator('#mgProberIdle');
  await expect(page.locator('#mgProberIdle + .mg-switch-track')).toBeVisible();
  // Non-admin: sola lettura, come il resto della tab.
  await expect(sw).toBeDisabled();

  await stubAutomation(page);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadAutoMode());
  await expect(sw).toBeEnabled();
  // Acceso di default: è il comportamento che le routine hanno sempre avuto.
  await expect(sw).toBeChecked();

  await page.evaluate(() => {
    const el = document.getElementById('mgProberIdle');
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__automation.proberWhenIdle)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__automationSets)).toContainEqual({
    proberWhenIdle: false,
  });
});

test('l\'interruttore master spegne le routine e rende inerti le impostazioni che valgono solo per loro', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
  await page.locator('.mg-tab[data-tab="automation"]').click();

  const sw = page.locator('#mgRoutinesToggle');
  // La levetta si vede davvero (il checkbox è nascosto per costruzione: se si
  // asserisse su quello, un controllo largo 0 passerebbe lo stesso — PATTERNS).
  await expect(page.locator('#mgRoutinesToggle + .mg-switch-track')).toBeVisible();
  await expect(sw).toBeDisabled();          // non-admin: sola lettura

  await stubAutomation(page);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadAutoMode());
  await expect(sw).toBeEnabled();
  await expect(sw).toBeChecked();           // acceso = comportamento storico
  await expect(page.locator('#mgRoutinesState')).toHaveText('On');

  await page.evaluate(() => {
    const el = document.getElementById('mgRoutinesToggle');
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // 1. La decisione LASCIA il client: è ciò che le routine andranno a leggere.
  await expect.poll(() => page.evaluate(() => window.__automationSets)).toContainEqual({ routinesEnabled: false });
  await expect.poll(() => page.evaluate(() => window.__automation.routinesEnabled)).toBe(false);
  await expect(page.locator('#mgRoutinesState')).toHaveText('Off');

  // 2. Le due impostazioni che senza routine non decidono niente diventano
  //    inerti — e si vede, invece di restare lì a promettere un effetto.
  await expect(page.locator('#mgProberIdle')).toBeDisabled();
  await expect(page.locator('#mgLoopCap')).toBeDisabled();
  await expect(page.locator('#mgProberIdleBlock')).toHaveClass(/mg-auto-block--off/);
  await expect(page.locator('#mgLoopCapBlock')).toHaveClass(/mg-auto-block--off/);
  // Il timeout dei giudici NON dipende dalle routine: resta usabile.
  await expect(page.locator('#mgJudgeTimeout')).toBeEnabled();

  // 3. Riacceso, tutto torna manovrabile.
  await page.evaluate(() => {
    const el = document.getElementById('mgRoutinesToggle');
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#mgProberIdle')).toBeEnabled();
  await expect(page.locator('#mgLoopCap')).toBeEnabled();
});

test('se il salvataggio dell\'interruttore fallisce, le routine NON risultano spente', async ({ openTab }) => {
  // Non scritto = non cambiato: uno switch che mostra "Off" mentre le routine
  // continuano a lavorare è peggio di non averlo (è il difetto per cui la
  // modalità automatica è rimasta finta per settimane).
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await stubAutomation(page);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadAutoMode());

  await page.evaluate(() => {
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_set') return { ok: false, error: 'niente rete' };
      return orig(msg);
    };
    const el = document.getElementById('mgRoutinesToggle');
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('#mgRoutinesToggle')).toBeChecked();
  await expect(page.locator('#mgRoutinesState')).toHaveText('On');
  await expect(page.locator('#mgRoutinesMsg')).toContainText('NON');
});

// Stub dell'IPC del loop cap: simula il doc Firestore config/automation senza
// rete/main. Cattura ogni `set` per provare che il valore LASCIA il client (è la
// fonte che le routine leggono → "il cambiamento ha effetto").
async function stubLoopCap(page, initial = 3) {
  await page.evaluate((init) => {
    window.__loopCapValue = init;
    window.__loopCapSets = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'automation_loop_cap_get') {
        return { ok: true, loopCap: window.__loopCapValue };
      }
      if (msg && msg.type === 'automation_loop_cap_set') {
        const v = Math.min(10, Math.max(1, Math.round(Number(msg.loopCap))));
        window.__loopCapValue = v;
        window.__loopCapSets.push(v);
        return { ok: true, loopCap: v };
      }
      return orig(msg);
    };
  }, initial);
}

// Stub dell'IPC del timeout giudici: simula config/supportModels.judgeTimeoutMs
// (in MS) via i messaggi support_models_*. Cattura i `set` per provare che il
// valore (in ms) lascia il client verso la config che il backend giudici legge.
async function stubJudgeTimeout(page, initialMs = 60000) {
  await page.evaluate((init) => {
    window.__judgeTimeoutMs = init;
    window.__judgeTimeoutSets = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'support_models_get') {
        return { ok: true, models: { judgeTimeoutMs: window.__judgeTimeoutMs } };
      }
      if (msg && msg.type === 'support_models_update' && msg.judgeTimeoutMs != null) {
        const maxMs = (window.SN_CONST.AUTOMATION.JUDGE_TIMEOUT_MAX_S) * 1000;
        const v = Math.min(maxMs, Math.max(10000, Math.round(Number(msg.judgeTimeoutMs))));
        window.__judgeTimeoutMs = v;
        window.__judgeTimeoutSets.push(v);
        return { ok: true, models: { judgeTimeoutMs: v } };
      }
      return orig(msg);
    };
  }, initialMs);
}

test('il timeout dei giudici è editabile (in secondi) e il salvataggio lo scrive in config (ms)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);

  await page.locator('.mg-tab[data-tab="automation"]').click();
  const input = page.locator('#mgJudgeTimeout');
  await expect(input).toBeVisible();

  // Non-admin: sola lettura.
  await expect(input).toBeDisabled();
  await expect(page.locator('#mgJudgeTimeoutSave')).toBeDisabled();

  // Owner + config stubbata a 90s (90000 ms).
  await stubJudgeTimeout(page, 90000);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadJudgeTimeout());
  await expect(input).toBeEnabled();
  // La UI mostra SECONDI (90), non i ms.
  await expect(input).toHaveValue('90');

  // Cambia a 45s e salva → in config arriva 45000 ms.
  await input.fill('45');
  await page.locator('#mgJudgeTimeoutSave').click();
  await expect(page.locator('#mgJudgeTimeoutMsg')).toHaveText('Salvato.');
  await expect.poll(() => page.evaluate(() => window.__judgeTimeoutSets)).toEqual([45000]);
});

test('il timeout dei giudici viene clampato nel range consentito', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);

  await page.locator('.mg-tab[data-tab="automation"]').click();
  await stubJudgeTimeout(page, 60000);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  const input = page.locator('#mgJudgeTimeout');

  // Sopra il massimo → il tetto del registro (300s, #447), non un letterale
  // scritto qui: se il tetto si alza, questo test segue senza modifiche.
  const maxS = await page.evaluate(() => window.SN_CONST.AUTOMATION.JUDGE_TIMEOUT_MAX_S);
  await input.fill('9999');
  await page.locator('#mgJudgeTimeoutSave').click();
  await expect(input).toHaveValue(String(maxS));
  expect(await page.evaluate(() => window.__judgeTimeoutMs)).toBe(maxS * 1000);

  // Sotto il minimo → 10s.
  await input.fill('1');
  await page.locator('#mgJudgeTimeoutSave').click();
  await expect(input).toHaveValue('10');
  expect(await page.evaluate(() => window.__judgeTimeoutMs)).toBe(10000);
});

test('il numero di tentativi del loop è editabile e il salvataggio lo scrive nella config delle routine', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);

  await page.locator('.mg-tab[data-tab="automation"]').click();
  const input = page.locator('#mgLoopCap');
  await expect(input).toBeVisible();

  // Da non-admin il campo è in sola lettura (stesso contratto dello switch).
  await expect(input).toBeDisabled();
  await expect(page.locator('#mgLoopCapSave')).toBeDisabled();

  // Simula l'owner: stub della config (valore corrente 7) + abilita i controlli.
  await stubLoopCap(page, 7);
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.loadLoopCap()); // rilegge dalla config stubbata
  await expect(input).toBeEnabled();
  // Il campo riflette il valore della config, non un default locale.
  await expect(input).toHaveValue('7');

  // Cambia il valore e salva.
  await input.fill('5');
  await page.locator('#mgLoopCapSave').click();
  await expect(page.locator('#mgLoopCapMsg')).toHaveText('Salvato.');

  // Il valore è stato SCRITTO nella config (l'IPC che le routine leggono): è qui
  // che "ha effetto", non solo in una cache locale.
  await expect.poll(() => page.evaluate(() => window.__loopCapSets)).toEqual([5]);
  expect(await page.evaluate(() => window.__loopCapValue)).toBe(5);

  // È anche specchiato nella cache locale (display istantaneo all'avvio).
  const cached = await page.evaluate(async () => {
    const key = window.SN_CONST.STORAGE_KEYS.AUTOMATION_LOOP_CAP;
    const d = await window.chrome.storage.local.get(key);
    return d[key];
  });
  expect(cached).toBe(5);
});

test('il numero di tentativi del loop viene clampato nel range [1, 10] al salvataggio', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_CONST && window.filo);

  await page.locator('.mg-tab[data-tab="automation"]').click();
  await stubLoopCap(page, 3);
  await page.evaluate(() => window.__mgTest.setAdmin(true));

  const input = page.locator('#mgLoopCap');

  // Sopra il massimo → riportato a 10 (e 10 è ciò che viene scritto).
  await input.fill('99');
  await page.locator('#mgLoopCapSave').click();
  await expect(input).toHaveValue('10');
  expect(await page.evaluate(() => window.__loopCapValue)).toBe(10);

  // Sotto il minimo → riportato a 1.
  await input.fill('0');
  await page.locator('#mgLoopCapSave').click();
  await expect(input).toHaveValue('1');
  expect(await page.evaluate(() => window.__loopCapValue)).toBe(1);
});

test('con dati finti: un elemento su UNA riga (#N + titolo, niente label motivo) — DA2', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  // Esercita il VERO renderList tramite l'hook di test (niente replica manuale).
  // Un blocco "attacco" non è approvato: vive nei "Ricevuti".
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK);
  await page.evaluate((fb) => { window.__mgTest.setData([fb]); window.__mgTest.setTab('inbox'); }, FAKE_FB);

  // Un elemento in lista, col numero e il titolo.
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item-title')).toHaveText('Test attacco finto');
  await expect(page.locator('.mg-item-num')).toHaveText('#99');

  // DA2: la label testuale del motivo è stata rimossa (resta solo il colore del
  // border-left). Il titolo è su una riga sola (no clamp a 2 righe).
  await expect(page.locator('.mg-item-reason')).toHaveCount(0);
  const whiteSpace = await page.locator('.mg-item-title').evaluate(
    (el) => getComputedStyle(el).whiteSpace
  );
  expect(whiteSpace).toBe('nowrap');

  // Il border-left porta ancora il colore della classe (attacco = rosso).
  const borderColor = await page.locator('.mg-item').evaluate(
    (el) => getComputedStyle(el).borderLeftColor
  );
  expect(borderColor).not.toBe('rgba(0, 0, 0, 0)'); // non trasparente
});

// Macchina a stati (FEEDBACK-STATES.md): un feedback bloccato per LOOP
// (3 verifiche fallite di fila, legacy blocked+blockReason=loop) si normalizza
// a `design` con statusReason `loop` → bordo VERDE design. Il NERO è riservato
// a `suspicious_file`.
const FAKE_FB_LOOP = {
  _id: 'test-fb-loop',
  text: 'Fix bloccato dopo tre verifiche avversariali fallite.',
  name: 'Test blocco loop',
  seq: 77,
  subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-06-27T10:00:00Z',
  images: [],
  status: 'blocked',
  blockReason: 'loop',
};

test('un blocco per LOOP (blocked + blockReason=loop) è design VERDE con reason loop', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW);

  // Verifica la logica pura: classifyBlock → reason 'loop', colore verde design.
  const cl = await page.evaluate((fb) => window.SN_MANAGE_REVIEW.classifyBlock(fb), FAKE_FB_LOOP);
  expect(cl).not.toBeNull();
  expect(cl.reason).toBe('loop');
  expect(cl.color).toBe('#2e9e5b');

  // Esercita il VERO renderList: il blocco loop non è approvato → "Ricevuti".
  await page.evaluate((fb) => { window.__mgTest.setData([fb]); window.__mgTest.setTab('inbox'); }, FAKE_FB_LOOP);

  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item-title')).toHaveText('Test blocco loop');

  // Border-left VERDE design (#2e9e5b → rgb(46, 158, 91)): il loop è una
  // decisione owner come gli altri design, NON nero (riservato a suspicious_file).
  const borderColor = await page.locator('.mg-item').evaluate(
    (el) => getComputedStyle(el).borderLeftColor
  );
  expect(borderColor).toBe('rgb(46, 158, 91)');
});

// Panel parziale "non filtrato": almeno un giudice non ha votato. Bianco, nei
// Ricevuti, col bottone di ri-valutazione che ri-prova solo i mancanti.
const FAKE_FB_UNFILTERED = {
  _id: 'test-fb-unfiltered',
  text: 'Feedback il cui panel giudici e\' rimasto parziale.',
  name: 'Test non filtrato',
  seq: 88, subSeq: 0, status: 'new',
  clientId: 'tester@example.com', createdAt: '2026-06-28T10:00:00Z', images: [],
  pipeline: {
    action: 'human_review',
    l2Class: 'aligned',
    l2Unfiltered: true,
    expectedJudges: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'],
    missingJudges: ['dynamic'],
    verdicts: [
      { judge: 'fixed_1', class: 'aligned', reasoning: 'Bug reale.' },
      { judge: 'fixed_2', class: 'aligned', reasoning: 'Allineato.' },
      { judge: 'fixed_3', class: 'aligned', reasoning: 'Ok.' },
    ],
    stage: 'L2', decidedAt: '2026-06-28T10:01:00Z',
  },
};

test('un feedback "non filtrato" è bianco, sta nei Ricevuti, mostra i giudici mancanti e il bottone ri-valuta', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW && window.filo);

  // Logica pura: classifyBlock → unfiltered/bianco; instradamento → Ricevuti.
  const cl = await page.evaluate((fb) => window.SN_MANAGE_REVIEW.classifyBlock(fb), FAKE_FB_UNFILTERED);
  expect(cl.reason).toBe('unfiltered');
  expect(cl.color).toBe('#ffffff');
  const tab = await page.evaluate((fb) => window.SN_MANAGE_REVIEW.manageTabFor(fb), FAKE_FB_UNFILTERED);
  expect(tab).toBe('inbox');

  // Stub IPC della ri-valutazione (cattura la chiamata senza rete/main).
  await page.evaluate(() => {
    window.__reeval = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_reevaluate') { window.__reeval.push(msg); return { ok: true, reevaluated: 1, results: [{ ok: true, changed: true, recovered: 1, attempted: 1 }] }; }
      return orig(msg);
    };
  });

  // Owner + dati: il bianco vive nei Ricevuti (tab di default).
  await page.evaluate((fb) => { window.__mgTest.setAdmin(true); window.__mgTest.setData([fb]); }, FAKE_FB_UNFILTERED);

  await expect(page.locator('#mgListHead')).toHaveText('Ricevuti');
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item--unfiltered')).toHaveCount(1);
  const border = await page.locator('.mg-item').evaluate((el) => getComputedStyle(el).borderLeftColor);
  expect(border).toBe('rgb(255, 255, 255)'); // bianco

  // Aprendo il dettaglio: 4 pallini (panel atteso), 3 aligned + 1 mancante
  // (tratteggiato) nella posizione corretta.
  await page.evaluate((id) => window.__mgTest.openDetail(id), FAKE_FB_UNFILTERED._id);
  await expect(page.locator('#mgJudgesRow')).toBeVisible();
  await expect(page.locator('#mgJudgesRow .mg-dot')).toHaveCount(4);
  await expect(page.locator('#mgJudgesRow .mg-dot--aligned')).toHaveCount(3);
  await expect(page.locator('#mgJudgesRow .mg-dot--empty')).toHaveCount(1);

  // La barra "Ri-valuta i non filtrati" compare col conteggio e invia il solo id bianco.
  await expect(page.locator('#mgReevalBar')).toBeVisible();
  await expect(page.locator('#mgReevalBtn')).toContainText('1');
  await page.locator('#mgReevalBtn').click();
  await expect.poll(() => page.evaluate(() => window.__reeval.length)).toBe(1);
  const sent = await page.evaluate(() => window.__reeval[0]);
  expect(sent.feedbackIds).toEqual(['test-fb-unfiltered']);
});

// La ri-valutazione processa i non filtrati UNO ALLA VOLTA: con 3 bianchi deve
// arrivare al backend una chiamata per ciascuno (un solo id per chiamata), non
// una sola chiamata con tutti gli id. Verifica anche che la card di turno mostri
// l'animazione "giudici al lavoro" mentre la sua valutazione è in corso.
test('ri-valuta i non filtrati uno alla volta (una chiamata per feedback) con animazione sulla card di turno', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW && window.filo);

  const whites = [0, 1, 2].map((i) => ({
    _id: `white-${i}`,
    text: `Feedback bianco numero ${i}.`,
    name: `Bianco ${i}`,
    seq: 90 + i, subSeq: 0, status: 'new',
    clientId: 'tester@example.com', createdAt: `2026-06-2${8 - i}T10:00:00Z`, images: [],
    pipeline: {
      action: 'human_review', l2Class: 'aligned', l2Unfiltered: true,
      expectedJudges: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'],
      verdicts: [{ judge: 'fixed_1', class: 'aligned', reasoning: 'Ok.' }],
      stage: 'L2',
    },
  }));

  // Stub IPC: registra ogni chiamata e, MENTRE è "in volo", cattura quante card
  // mostrano l'animazione (devono essere al massimo 1 — quella di turno).
  await page.evaluate(() => {
    window.__reeval = [];
    window.__maxEvaluatingDuringCall = 0;
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_reevaluate') {
        window.__reeval.push(msg);
        // Misura le card animate nell'istante della chiamata (valutazione in corso).
        const n = document.querySelectorAll('.mg-item--evaluating').length;
        if (n > window.__maxEvaluatingDuringCall) window.__maxEvaluatingDuringCall = n;
        return { ok: true, reevaluated: 1, results: [{ ok: true, changed: true, recovered: 1, attempted: 1 }] };
      }
      return orig(msg);
    };
  });

  await page.evaluate((fbs) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(fbs); }, whites);
  await expect(page.locator('.mg-item--unfiltered')).toHaveCount(3);
  await expect(page.locator('#mgReevalBtn')).toContainText('3');

  await page.locator('#mgReevalBtn').click();

  // Una chiamata per ciascun bianco, ognuna con un solo id.
  await expect.poll(() => page.evaluate(() => window.__reeval.length)).toBe(3);
  const calls = await page.evaluate(() => window.__reeval.map((m) => m.feedbackIds));
  for (const ids of calls) expect(ids.length).toBe(1);
  const flat = calls.flat().sort();
  expect(flat).toEqual(['white-0', 'white-1', 'white-2']);

  // Durante le chiamate al massimo una card era in valutazione (uno alla volta).
  const maxDuring = await page.evaluate(() => window.__maxEvaluatingDuringCall);
  expect(maxDuring).toBe(1);
});

// Il bug riportato: l'owner clicca "Ri-valuta", i giudici continuano a NON
// rispondere (crediti spesi, pallini ancora bianchi) ma la dashboard diceva
// "Valutati N". Ora: se la ri-valutazione spende crediti senza recuperare nessun
// giudice più volte di fila, si FERMA (non brucia crediti sul resto) e lo dice
// onestamente — niente più falso "valutato" con i pallini bianchi.
test('ri-valuta: i giudici falliscono a vuoto → si ferma e segnala i crediti spesi senza risultato', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW && window.filo);

  // 8 bianchi: più della soglia di stop, così verifichiamo che NON li chiama tutti.
  const whites = Array.from({ length: 8 }, (_, i) => ({
    _id: `fail-${i}`,
    text: `Bianco che non si recupera ${i}.`,
    name: `Bianco ${i}`,
    seq: 200 + i, subSeq: 0, status: 'new',
    clientId: 'tester@example.com', createdAt: `2026-06-28T10:0${i}:00Z`, images: [],
    pipeline: {
      action: 'human_review', l2Class: 'aligned', l2Unfiltered: true,
      expectedJudges: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'],
      verdicts: [{ judge: 'fixed_1', class: 'aligned', reasoning: 'Ok.' }],
      stage: 'L2',
    },
  }));

  // Stub: ogni id ri-esegue un giudice (attempted:1) ma non ne recupera nessuno
  // (recovered:0, stillUnfiltered) — esattamente lo scenario "crediti a vuoto".
  await page.evaluate(() => {
    window.__reeval = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_reevaluate') {
        window.__reeval.push(msg);
        return { ok: true, reevaluated: 0, remaining: 0, results: [{ ok: true, changed: false, recovered: 0, attempted: 1, stillUnfiltered: true, errorKind: 'credit' }] };
      }
      return orig(msg);
    };
  });

  await page.evaluate((fbs) => { window.__mgTest.setAdmin(true); window.__mgTest.setData(fbs); }, whites);
  await expect(page.locator('#mgReevalBtn')).toContainText('8');
  await page.locator('#mgReevalBtn').click();

  // Si è fermato alla soglia (3 tentativi a vuoto), NON ha chiamato tutti gli 8.
  await expect.poll(() => page.evaluate(() => window.__reeval.length)).toBe(3);
  // Per sicurezza: anche aspettando, non parte una quarta chiamata.
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__reeval.length)).toBe(3);

  // Messaggio onesto: niente "valutati", parla di crediti spesi senza verdetti.
  const msg = await page.locator('#mgReevalMsg').textContent();
  expect(msg.toLowerCase()).toContain('credit');
  expect(msg.toLowerCase()).not.toContain('recuperati 3');
});

// Storico (pipeline vecchia): solo 2 dei 4 giudici hanno votato, niente
// expectedJudges/l2Unfiltered. Va comunque dedotto come "non filtrato" (bianco)
// e mostrare 4 pallini (2 votati + 2 mancanti tratteggiati).
const FAKE_FB_LEGACY_PARTIAL = {
  _id: 'test-fb-legacy', text: 'Feedback giudicato dalla pipeline vecchia.',
  name: 'Test storico parziale', seq: 70, subSeq: 0, status: 'new',
  clientId: 'tester@example.com', createdAt: '2026-06-26T10:00:00Z', images: [],
  pipeline: {
    action: 'human_review', l2Class: 'aligned', l1Category: 'clean',
    verdicts: [
      { judge: 'fixed_1', class: 'aligned', reasoning: 'Bug reale.' },
      { judge: 'fixed_2', class: 'aligned', reasoning: 'Ok.' },
    ],
    stage: 'L2', decidedAt: '2026-06-26T10:01:00Z',
  },
};

test('storico parziale (2 verdetti su 4, senza expectedJudges) → bianco e 4 pallini (2 votati + 2 mancanti)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW);

  const cl = await page.evaluate((fb) => window.SN_MANAGE_REVIEW.classifyBlock(fb), FAKE_FB_LEGACY_PARTIAL);
  expect(cl.reason).toBe('unfiltered');

  await page.evaluate((fb) => { window.__mgTest.setAdmin(true); window.__mgTest.setData([fb]); }, FAKE_FB_LEGACY_PARTIAL);
  await expect(page.locator('.mg-item--unfiltered')).toHaveCount(1);

  // Apri il dettaglio: 4 pallini (2 aligned + 2 mancanti tratteggiati).
  await page.evaluate((id) => window.__mgTest.openDetail(id), FAKE_FB_LEGACY_PARTIAL._id);
  await expect(page.locator('#mgJudgesRow .mg-dot')).toHaveCount(4);
  await expect(page.locator('#mgJudgesRow .mg-dot--aligned')).toHaveCount(2);
  await expect(page.locator('#mgJudgesRow .mg-dot--empty')).toHaveCount(2);
});

// Coerenza dei colori: il pallino di un giudice DEVE avere lo stesso colore del
// bordo della card per quella classe (es. "design" blu = stesso blu del bordo).
// "aligned" è l'esito buono: pallino verde, distinto dal blu di "design". Questo
// blinda lo scambio design↔aligned che mostrava i giudici col colore sbagliato.
const FAKE_FB_FULL_PANEL = {
  _id: 'test-fb-colors', text: 'Feedback con panel completo per i colori dei giudici.',
  name: 'Colori giudici', seq: 252, subSeq: 0, status: 'new',
  clientId: 'tester@example.com', createdAt: '2026-06-28T10:00:00Z', images: [],
  pipeline: {
    action: 'human_review', l2Class: 'design',
    expectedJudges: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'],
    verdicts: [
      { judge: 'fixed_1', class: 'design', reasoning: 'Fuori scope.' },
      { judge: 'fixed_2', class: 'aligned', reasoning: 'Bug reale.' },
      { judge: 'fixed_3', class: 'aligned', reasoning: 'Bug reale.' },
      { judge: 'dynamic', class: 'aligned', reasoning: 'Bug reale.' },
    ],
    stage: 'L2',
  },
};

test('colori giudici: scala rosso→giallo→verde→blu; "design" è verde e combacia col bordo della card, "aligned" è blu', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW);

  await page.evaluate((fb) => { window.__mgTest.setAdmin(true); window.__mgTest.setData([fb]); }, FAKE_FB_FULL_PANEL);
  await page.evaluate((id) => window.__mgTest.openDetail(id), FAKE_FB_FULL_PANEL._id);

  // Bordo della card per un aggregato "design" = il verde di REASONS.design.
  const itemBorder = await page.locator('.mg-item').evaluate((el) => getComputedStyle(el).borderLeftColor);
  const designDot = await page.locator('#mgJudgesRow .mg-dot--design').first().evaluate((el) => getComputedStyle(el).backgroundColor);
  const alignedDot = await page.locator('#mgJudgesRow .mg-dot--aligned').first().evaluate((el) => getComputedStyle(el).backgroundColor);

  // Il pallino "design" ha lo STESSO colore del bordo "design" della card.
  expect(designDot).toBe(itemBorder);
  // "design" (verde) e "aligned" (blu) sono distinti: nessuno scambio.
  expect(alignedDot).not.toBe(designDot);
  // "design" è verde (canale G dominante).
  const d = designDot.match(/\d+/g).map(Number);
  expect(d[1]).toBeGreaterThan(d[2]); // verde > blu
  // "aligned" è blu (canale B dominante).
  const a = alignedDot.match(/\d+/g).map(Number);
  expect(a[2]).toBeGreaterThan(a[1]); // blu > verde
});

// Caso #261: un feedback dell'automazione dell'owner (routine:) che era stato
// bloccato a L1 (identità flaggata per errore) NON deve apparire come attacco
// (rosso) ma come "da ri-giudicare" (bianco), con il panel atteso tratteggiato.
const FAKE_FB_TRUSTED_BLOCKED = {
  _id: 'test-fb-routine-blocked', text: 'Regole proxy per dominio: nessuna UI per vederle.',
  name: 'Regole proxy', seq: 261, subSeq: 0, status: 'new',
  clientId: 'routine:routine', createdAt: '2026-06-29T10:00:00Z', images: [],
  pipeline: { action: 'human_review', l1Category: 'dangerous', l1Reasons: ['linked_prior_attack'], verdicts: [], stage: 'L1' },
};

test('feedback di routine bloccato a L1 → bianco (non rosso) e panel atteso tratteggiato', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW);

  // Logica pura: mittente fidato senza verdetti → unfiltered, non attack.
  const cl = await page.evaluate((fb) => window.SN_MANAGE_REVIEW.classifyBlock(fb), FAKE_FB_TRUSTED_BLOCKED);
  expect(cl.reason).toBe('unfiltered');

  await page.evaluate((fb) => { window.__mgTest.setAdmin(true); window.__mgTest.setData([fb]); }, FAKE_FB_TRUSTED_BLOCKED);
  await expect(page.locator('.mg-item--unfiltered')).toHaveCount(1);

  // Dettaglio: 4 pallini tutti tratteggiati (nessun giudice ha votato).
  await page.evaluate((id) => window.__mgTest.openDetail(id), FAKE_FB_TRUSTED_BLOCKED._id);
  await expect(page.locator('#mgJudgesRow .mg-dot')).toHaveCount(4);
  await expect(page.locator('#mgJudgesRow .mg-dot--empty')).toHaveCount(4);
});

test('il pannello centrale si apre al click e mostra bolle + giudici', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof window.SN_FEEDBACK !== 'undefined');

  // Inietta direttamente il feedback nel DOM e nell'allFeedbacks globale
  // simulando ciò che farebbe manage.js dopo loadData()
  await page.evaluate((fakeFb) => {
    const MR = window.SN_MANAGE_REVIEW;
    const FB = window.SN_FEEDBACK;

    // Ricalcola la lista con il feedback finto
    const blocked = MR.sortReview([fakeFb].filter(f => MR.classifyBlock(f) !== null));

    const mgListLoading = document.getElementById('mgListLoading');
    const mgList = document.getElementById('mgList');
    const mgListEmpty = document.getElementById('mgListEmpty');
    if (mgListLoading) mgListLoading.hidden = true;
    if (mgListEmpty)   mgListEmpty.hidden = true;
    if (!mgList) return;
    mgList.hidden = false;
    mgList.innerHTML = '';

    // Serve una reference all'allFeedbacks — la inseriamo come variabile globale
    window.__testFeedbacks__ = [fakeFb];

    for (const fb of blocked) {
      const cl = MR.classifyBlock(fb);
      const num = FB.formatNum(fb.seq, fb.subSeq);
      const title = fb.name || FB.fallbackName(fb.text) || '(senza titolo)';
      const item = document.createElement('div');
      item.className = 'mg-item';
      item.dataset.id = fb._id;
      item.style.borderLeftColor = cl ? cl.color : 'transparent';
      item.innerHTML = (num ? `<span class="mg-item-num">#${num}</span>` : '')
        + `<span class="mg-item-title">${title}</span>`;

      item.addEventListener('click', () => {
        // Simula openDetail: mostra pannello centrale
        const empty  = document.getElementById('mgDetailEmpty');
        const detail = document.getElementById('mgDetail');
        const head   = document.getElementById('mgDetailHead');
        const thread = document.getElementById('mgThread');
        const judgesRow = document.getElementById('mgJudgesRow');
        if (!detail || !empty) return;
        empty.hidden = true;
        detail.hidden = false;

        head.innerHTML = `Da <a class="mg-sender-link" href="#" data-client="${fb.clientId}">${fb.clientId}</a> il 22/06/2026`;

        // Giudici
        judgesRow.innerHTML = '<span class="mg-judge-label">Giudici:</span>';
        const verdicts = (fb.pipeline && fb.pipeline.verdicts) || [];
        const letters = ['A','B','C','D'];
        for (let i = 0; i < 4; i++) {
          const v = verdicts[i];
          const dot = document.createElement('span');
          dot.className = 'mg-dot' + (v ? ' mg-dot--clickable mg-dot--' + (v.class||'') : '');
          dot.dataset.judge = letters[i];
          judgesRow.appendChild(dot);
        }

        // Bolle
        thread.innerHTML = '';
        const b1 = document.createElement('div');
        b1.className = 'mg-bubble mg-bubble--user';
        b1.innerHTML = `<div class="mg-bubble-who">Utente</div><div class="mg-bubble-body">${fb.text}</div>`;
        thread.appendChild(b1);

        const b2 = document.createElement('div');
        b2.className = 'mg-bubble mg-bubble--model';
        const summary = fb.pipeline && fb.pipeline.filoSummary;
        b2.innerHTML = `<div class="mg-bubble-who">Filo</div><div class="mg-bubble-body">${summary || '<em>Filo non ha ancora un parere su questo feedback (giudici non attivi).</em>'}</div>`;
        thread.appendChild(b2);
      });

      mgList.appendChild(item);
    }
  }, FAKE_FB);

  // Prima del click: pannello centrale nascosto
  await expect(page.locator('#mgDetailEmpty')).toBeVisible();
  await expect(page.locator('#mgDetail')).toBeHidden();

  // Click sull'elemento
  await page.locator('.mg-item').click();

  // Dopo il click: pannello centrale visibile
  await expect(page.locator('#mgDetail')).toBeVisible();
  await expect(page.locator('#mgDetailEmpty')).toBeHidden();

  // Intestazione con il mittente
  await expect(page.locator('#mgDetailHead')).toContainText('tester@example.com');

  // 4 pallini giudici (2 pieni attack + 2 grigi)
  await expect(page.locator('#mgJudgesRow .mg-dot')).toHaveCount(4);
  await expect(page.locator('#mgJudgesRow .mg-dot--attack')).toHaveCount(2);

  // 2 bolle: utente + Filo
  await expect(page.locator('#mgThread .mg-bubble')).toHaveCount(2);
  await expect(page.locator('#mgThread .mg-bubble--user')).toBeVisible();
  await expect(page.locator('#mgThread .mg-bubble--model')).toBeVisible();

  // La bolla di Filo contiene il filoSummary
  await expect(page.locator('#mgThread .mg-bubble--model .mg-bubble-body'))
    .toContainText('prompt injection');
});

test('riassunto di Filo troncato: la bolla mostra il parere completo dai giudici, non la frase spezzata', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK);

  // filoSummary TRONCATO a metà frase (ultima parola appesa, senza punto) —
  // esattamente com'è archiviato dal backend quando supera il limite di
  // lunghezza. I verdetti dei giudici sono invece completi.
  const FB_TRUNC = {
    ...FAKE_FB,
    _id: 'fb-trunc-001',
    pipeline: {
      ...FAKE_FB.pipeline,
      verdicts: [
        { judge: 'A', class: 'aligned', reasoning: 'Segnala un bug reale di rendering che va corretto.', model: 'kimi-k2' },
        { judge: 'B', class: 'aligned', reasoning: 'Comportamento imprevisto del sistema, allineato agli obiettivi.', model: 'gemini-3.1-flash-lite' },
      ],
      filoSummary: 'Il feedback segnala un problema di visualizzazione e i giudici hanno valutato il',
    },
  };

  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fb]);
    window.__mgTest.openDetail(fb._id);
  }, FB_TRUNC);

  const filoBody = page.locator('#mgThread .mg-bubble--model .mg-bubble-body').first();
  // Il parere COMPLETO dai verdetti compare (era invisibile mostrando solo il
  // riassunto troncato): questo assert diventa rosso senza il fix.
  await expect(filoBody).toContainText('bug reale di rendering');
  await expect(filoBody).toContainText('Comportamento imprevisto del sistema');
});

test('click su un pallino giudice apre il reasoning nel pannello destro; il centro non lo contiene piu (DA1)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK);

  // Esercita il VERO codice di rendering tramite l'hook di test.
  await page.evaluate((fb) => {
    window.__mgTest.setData([fb]);
    window.__mgTest.openDetail(fb._id);
  }, FAKE_FB);

  // Il centro NON contiene più i verdetti estesi (rimossi da DA1).
  await expect(page.locator('#mgVerdicts')).toHaveCount(0);
  await expect(page.locator('#mgDetail')).not.toContainText('aggirare i filtri');

  // Il pannello destro parte chiuso (stato vuoto visibile).
  await expect(page.locator('#mgSideEmpty')).toBeVisible();
  await expect(page.locator('#mgSide')).toBeHidden();

  // Click sul PRIMO pallino con verdetto → apre quel giudice a destra col reasoning.
  await page.locator('#mgJudgesRow .mg-dot--clickable').first().click();
  await expect(page.locator('#mgSide')).toBeVisible();
  await expect(page.locator('#mgSideBody')).toContainText('aggirare i filtri');
  // Il badge della classe è presente nel pannello.
  await expect(page.locator('#mgSideBody .mg-class-badge')).toBeVisible();

  // Click sul SECONDO pallino → il pannello mostra il secondo reasoning.
  await page.locator('#mgJudgesRow .mg-dot--clickable').nth(1).click();
  await expect(page.locator('#mgSideBody')).toContainText('Prompt injection');
});

test('nome giudice nel pannello destro: anonimizzato per i non-owner, modello reale per l owner (#2, DA1)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK);

  const FB_MODEL = {
    ...FAKE_FB,
    _id: 'fb-model-001',
    pipeline: {
      ...FAKE_FB.pipeline,
      verdicts: [{ judge: 'A', class: 'attack', reasoning: 'x', model: 'gemini-3.1-flash-lite' }],
    },
  };

  // Non-owner → titolo del pannello anonimizzato "Giudice A".
  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(false);
    window.__mgTest.setData([fb]);
    window.__mgTest.openDetail(fb._id);
  }, FB_MODEL);
  await page.locator('#mgJudgesRow .mg-dot--clickable').first().click();
  await expect(page.locator('#mgSideTitle')).toHaveText('Giudice A');

  // Owner → titolo del pannello = nome del modello reale.
  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fb]);
    window.__mgTest.openDetail(fb._id);
  }, FB_MODEL);
  await page.locator('#mgJudgesRow .mg-dot--clickable').first().click();
  await expect(page.locator('#mgSideTitle')).toHaveText('gemini-3.1-flash-lite');
});

test('owner accetta e sblocca un feedback bloccato → patch corretto + esce dai bloccati (#4)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);

  // Intercetta feedback_update: cattura il patch e risponde ok, senza rete/main.
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
  });

  // Owner + dati + tab "Ricevuti" (i bloccati attendono la mia approvazione) +
  // apri dettaglio (vero codice di rendering).
  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('inbox');
    window.__mgTest.openDetail(fb._id);
  }, FAKE_FB);

  // Per l'owner le azioni di sblocco sono visibili; un elemento è in lista.
  await expect(page.locator('#mgActions')).toBeVisible();
  await expect(page.locator('.mg-item')).toHaveCount(1);
  // Il blocco "attacco" colora il border-left di rosso.
  const beforeColor = await page.locator('.mg-item').evaluate((el) => getComputedStyle(el).borderLeftColor);
  expect(beforeColor).not.toBe('rgba(0, 0, 0, 0)');

  // Scrivi un commento e accetta.
  await page.locator('#mgAcceptComment').fill('Falso positivo: richiesta legittima.');
  await page.locator('#mgAcceptBtn').click();

  // Il patch inviato contiene l'override + il ritorno in coda + il commento.
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.reviewDecision).toBe('accepted');
  expect(patch.status).toBe('todo');
  expect(patch.reviewComment).toContain('Falso positivo');

  // Approvato: il dettaglio si richiude e il feedback LASCIA i Ricevuti (ora è
  // approvato → si sposta in "In coda"), quindi la lista Ricevuti si svuota.
  await expect(page.locator('#mgDetail')).toBeHidden();
  await expect(page.locator('.mg-item')).toHaveCount(0);
});

// ── Allineati (tutti i giudici d'accordo): bordo BLU, approva → coda ─────────
// Panel completo, 4 verdetti 'aligned', giudicato con automatica OFF (action
// human_review, niente candidate_change inciso): è un "vecchio allineato".
// Status legacy `new`: la macchina a stati lo normalizza in `aligned` (aspetta
// l'approvazione dell'owner nei Ricevuti). Con `todo` sarebbe già In coda.
const FAKE_FB_ALIGNED = {
  _id: 'test-fb-aligned',
  text: 'Suggerimento utile e allineato.',
  name: 'Test allineato',
  seq: 55, subSeq: 0, status: 'new',
  clientId: 'tester@example.com', createdAt: '2026-06-29T10:00:00Z', images: [],
  pipeline: {
    action: 'human_review', l2Class: 'aligned',
    expectedJudges: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'],
    verdicts: ['fixed_1', 'fixed_2', 'fixed_3', 'dynamic'].map((j) => ({ judge: j, class: 'aligned', reasoning: 'Bug reale.' })),
    stage: 'L2', decidedAt: '2026-06-29T10:01:00Z',
  },
};

test('un allineato ha il border-left BLU e sta nei Ricevuti finché l automatica è OFF (#1)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW);

  // Logica pura: non è un blocco (classifyBlock null) ma è allineato.
  const out = await page.evaluate((fb) => ({
    cl: window.SN_MANAGE_REVIEW.classifyBlock(fb),
    aligned: window.SN_MANAGE_REVIEW.isAligned(fb),
    tab: window.SN_MANAGE_REVIEW.manageTabFor(fb),
  }), FAKE_FB_ALIGNED);
  expect(out.cl).toBeNull();
  expect(out.aligned).toBe(true);
  expect(out.tab).toBe('inbox'); // automatica OFF → resta nei Ricevuti

  await page.evaluate((fb) => { window.__mgTest.setAdmin(true); window.__mgTest.setData([fb]); window.__mgTest.setTab('inbox'); }, FAKE_FB_ALIGNED);
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item--aligned')).toHaveCount(1);

  // Border-left BLU (#5b6ee0 → rgb(91, 110, 224)), distinto dai blocchi.
  const border = await page.locator('.mg-item').evaluate((el) => getComputedStyle(el).borderLeftColor);
  expect(border).toBe('rgb(91, 110, 224)');
});

test('un allineato nei Ricevuti mostra "Approva e metti in coda" → patch corretto + esce dai Ricevuti (#2)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);

  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
  });

  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('inbox');
    window.__mgTest.openDetail(fb._id);
  }, FAKE_FB_ALIGNED);

  // Il box azione è visibile col testo di approvazione (non "sblocca").
  await expect(page.locator('#mgActions')).toBeVisible();
  await expect(page.locator('#mgAcceptBtn')).toHaveText('Approva e metti in coda');

  await page.locator('#mgAcceptBtn').click();

  // Il patch approva e mette in coda (accepted + todo).
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.reviewDecision).toBe('accepted');
  expect(patch.status).toBe('todo');

  // Approvato → lascia i Ricevuti.
  await expect(page.locator('#mgDetail')).toBeHidden();
  await expect(page.locator('.mg-item')).toHaveCount(0);
});

test('la modalità automatica NON sposta gli allineati: restano nei Ricevuti finché non li approvo (#3)', async ({ openTab }) => {
  // Macchina a stati: l'automatica agisce UNA volta, al momento del giudizio
  // (la pipeline scrive todo o aligned). Il toggle di OGGI non è più una lente
  // sulle liste — era il bug per cui dashboard e routine vedevano code diverse.
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW);

  // Owner + dati: l'allineato (in attesa di approvazione) è nei Ricevuti.
  await page.evaluate((fb) => { window.__mgTest.setAdmin(true); window.__mgTest.setData([fb]); window.__mgTest.setTab('inbox'); }, FAKE_FB_ALIGNED);
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await page.locator('.mg-tab[data-tab="queue"]').click();
  await expect(page.locator('.mg-item')).toHaveCount(0);

  // Accendi l'automatica: NON deve cambiare nulla nelle liste.
  await page.locator('.mg-tab[data-tab="automation"]').click();
  await page.evaluate(() => {
    const el = document.getElementById('mgAutoToggle');
    el.disabled = false; el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('.mg-tab[data-tab="queue"]').click();
  await expect(page.locator('.mg-item')).toHaveCount(0);
  await page.locator('.mg-tab[data-tab="inbox"]').click();
  await expect(page.locator('.mg-item')).toHaveCount(1);

  // È l'APPROVAZIONE (che scrive lo status todo) a spostarlo in coda.
  const approved = { ...FAKE_FB_ALIGNED, status: 'todo' };
  await page.evaluate((fb) => { window.__mgTest.setData([fb]); window.__mgTest.setTab('queue'); }, approved);
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await page.locator('.mg-tab[data-tab="inbox"]').click();
  await expect(page.locator('.mg-item')).toHaveCount(0);
});

test('un feedback in `clarify` mostra il box risposta dell owner sotto Ricevuti (DB1)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);

  // Intercetta feedback_update per catturare il patch senza rete/main.
  await page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
  });

  const CLARIFY_FB = {
    _id: 'fb-clarify-001',
    text: 'Il pulsante X non funziona.',
    name: 'Pulsante X',
    seq: 42, subSeq: 0,
    status: 'clarify',
    notes: '--- Filo ---\nQuale pulsante X intendi? Non lo trovo.',
    clientId: 'tester@example.com',
    createdAt: '2026-06-22T10:00:00Z',
    images: [],
  };

  // Owner, tab Ricevuti di default: i `clarify` vivono lì.
  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fb]);
  }, CLARIFY_FB);

  // Compare in Ricevuti.
  await expect(page.locator('#mgListHead')).toHaveText('Ricevuti');
  await expect(page.locator('.mg-item')).toHaveCount(1);

  // Apri il dettaglio: il box risposta chiarimenti è visibile. Con la macchina
  // a stati `clarify` normalizza a `design` (bloccato, decide l'owner), quindi
  // ANCHE "Accetta e sblocca" è legittimamente visibile accanto al box.
  await page.evaluate((id) => window.__mgTest.openDetail(id), CLARIFY_FB._id);
  await expect(page.locator('#mgClarify')).toBeVisible();
  await expect(page.locator('#mgActions')).toBeVisible();
  await expect(page.locator('#mgAcceptBtn')).toHaveText('Accetta e sblocca');
  // Niente riga giudici per un feedback mai passato dal pipeline.
  await expect(page.locator('#mgJudgesRow')).toBeHidden();

  // Rispondi: il patch rimette in coda (todo) e appende la risposta alle note.
  await page.locator('#mgClarifyText').fill('Intendo il pulsante in alto a destra.');
  await page.locator('#mgClarifyBtn').click();

  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.status).toBe('todo');
  expect(patch.notes).toContain('Intendo il pulsante in alto a destra');
  // Risposto: il dettaglio si chiude. Macchina a stati: `todo` = già in coda
  // (le tab sono una lookup pura sullo status) → il feedback ESCE dai Ricevuti
  // e ricompare sotto "In coda".
  await expect(page.locator('#mgDetail')).toBeHidden();
  await expect(page.locator('.mg-item').filter({ hasText: 'Pulsante X' })).toHaveCount(0);
  await page.locator('.mg-tab[data-tab="queue"]').click();
  await expect(page.locator('.mg-item').filter({ hasText: 'Pulsante X' })).toHaveCount(1);
});

// ── DB2: stato `archived` + preferito ⭐ ────────────────────────────────────
const FB_ARCHIVED = {
  _id: 'fb-arch-001', text: 'Feedback archiviato.', name: 'Archiviato',
  seq: 10, subSeq: 0, status: 'archived',
  clientId: 'tester@example.com', createdAt: '2026-06-20T10:00:00Z', images: [],
};
const FB_STARRED_TODO = {
  _id: 'fb-star-001', text: 'Preferito ma in coda.', name: 'Preferito in coda',
  seq: 11, subSeq: 0, status: 'todo', starred: true,
  clientId: 'tester@example.com', createdAt: '2026-06-21T10:00:00Z', images: [],
};
// Todo APPROVATO (owner-accepted): per stare davvero in "In coda" un feedback
// dev'essere approvato; senza approvazione vivrebbe nei Ricevuti.
const FB_PLAIN_TODO = {
  _id: 'fb-plain-001', text: 'Feedback normale in coda.', name: 'Normale in coda',
  seq: 12, subSeq: 0, status: 'todo', reviewDecision: 'accepted',
  clientId: 'tester@example.com', createdAt: '2026-06-22T10:00:00Z', images: [],
};

function stubFeedbackUpdate(page) {
  return page.evaluate(() => {
    window.__updates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'feedback_update') { window.__updates.push(msg); return { ok: true }; }
      return orig(msg);
    };
  });
}

test('tab Archiviati: OFF mostra i soli archiviati, il filtro ⭐ mostra tutti i preferiti (DB2)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK);

  await page.evaluate((fbs) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(fbs);
    window.__mgTest.setTab('archived');
  }, [FB_ARCHIVED, FB_STARRED_TODO, FB_PLAIN_TODO]);

  // Il filtro ⭐ esiste solo nella tab Archiviati.
  await expect(page.locator('#mgArchiveFilter')).toBeVisible();

  // Filtro OFF: solo i feedback in stato `archived` (non i preferiti in coda).
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item-title')).toHaveText('Archiviato');

  // Filtro ⭐ ON: tutti e soli i preferiti, di qualunque stato (qui il todo ⭐).
  await page.locator('#mgStarFilter').check();
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item-title')).toHaveText('Preferito in coda');

  // Il filtro sparisce sulle altre tab.
  await page.locator('.mg-tab[data-tab="inbox"]').click();
  await expect(page.locator('#mgArchiveFilter')).toBeHidden();
});

test('owner archivia un feedback dalla coda → patch status:archived + lascia la coda (DB2)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await stubFeedbackUpdate(page);

  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('queue');
    window.__mgTest.openDetail(fb._id);
  }, FB_PLAIN_TODO);

  // I controlli di gestione sono visibili per l'owner; bottone "Archivia".
  await expect(page.locator('#mgManage')).toBeVisible();
  await expect(page.locator('#mgArchiveBtn')).toHaveText('Archivia');
  await expect(page.locator('.mg-item')).toHaveCount(1);

  await page.locator('#mgArchiveBtn').click();

  // Patch corretto: status → archived.
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.status).toBe('archived');

  // Esce dalla coda: il dettaglio si richiude e la lista "In coda" si svuota.
  await expect(page.locator('#mgDetail')).toBeHidden();
  await expect(page.locator('.mg-item')).toHaveCount(0);
});

test('owner mette/leva il preferito ⭐ → patch starred + il bottone riflette lo stato (DB2)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await stubFeedbackUpdate(page);

  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('queue');
    window.__mgTest.openDetail(fb._id);
  }, FB_PLAIN_TODO);

  const star = page.locator('#mgStarBtn');
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await expect(star).toContainText('☆');

  await star.click();

  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.starred).toBe(true);

  // Il bottone riflette lo stato acceso (★, aria-pressed true).
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  await expect(star).toContainText('★');
});

test('owner ripristina un feedback archiviato → bottone "Ripristina" + patch status:todo (DB2)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await stubFeedbackUpdate(page);

  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('archived');
    window.__mgTest.openDetail(fb._id);
  }, FB_ARCHIVED);

  // Su un feedback già archiviato il bottone ripristina.
  await expect(page.locator('#mgArchiveBtn')).toHaveText('Ripristina');
  await page.locator('#mgArchiveBtn').click();

  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.status).toBe('todo');

  // Lascia gli Archiviati.
  await expect(page.locator('.mg-item')).toHaveCount(0);
});

// ── Priorità visibile + modificabile dalla coda ─────────────────────────────
// I feedback "In coda" mostrano i pallini priorità; per l'owner il click li
// modifica (patch priority + priorityManual) e la coda si riordina (priorità
// più alta prima).
const FB_QUEUE_A = {
  _id: 'fb-prio-a', text: 'Feedback A in coda.', name: 'Coda A',
  seq: 30, subSeq: 0, status: 'todo', reviewDecision: 'accepted', priority: 0,
  clientId: 'tester@example.com', createdAt: '2026-06-22T10:00:00Z', images: [],
};
const FB_QUEUE_B = {
  _id: 'fb-prio-b', text: 'Feedback B in coda.', name: 'Coda B',
  seq: 31, subSeq: 0, status: 'todo', reviewDecision: 'accepted', priority: 0,
  clientId: 'tester@example.com', createdAt: '2026-06-21T10:00:00Z', images: [],
};

test('In coda: i pallini priorità sono visibili e il click li imposta (patch + riordino)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await stubFeedbackUpdate(page);

  await page.evaluate((fbs) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData(fbs);
    window.__mgTest.setTab('queue');
  }, [FB_QUEUE_A, FB_QUEUE_B]);

  // Due card in coda, ciascuna con 3 pallini priorità (owner → bottoni cliccabili).
  await expect(page.locator('.mg-item')).toHaveCount(2);
  await expect(page.locator('.mg-item .mg-priority')).toHaveCount(2);
  await expect(page.locator('.mg-item').first().locator('.mg-dot')).toHaveCount(3);

  // Ordine iniziale: priorità 0 ovunque → per recenza, A (22) prima di B (21).
  await expect(page.locator('.mg-item-title').first()).toHaveText('Coda A');

  // Alza B a priorità 3 cliccando il terzo pallino della sua card.
  const cardB = page.locator('.mg-item', { hasText: 'Coda B' });
  await cardB.locator('.mg-dot').nth(2).click();

  // Patch inviato: priority=3 + priorityManual=true (scelta manuale dell'owner).
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.id).toBe('fb-prio-b');
  expect(patch.priority).toBe(3);
  expect(patch.priorityManual).toBe(true);

  // La coda si riordina: B (priorità 3) sale in cima, sopra A (priorità 0).
  await expect(page.locator('.mg-item-title').first()).toHaveText('Coda B');
  // I tre pallini di B sono ora accesi.
  await expect(page.locator('.mg-item', { hasText: 'Coda B' }).locator('.mg-dot--on')).toHaveCount(3);

  // REGRESSIONE: il pallino acceso deve essere VISIVAMENTE pieno, non solo
  // avere la classe. La classe .mg-dot è riusata dalla riga giudici del
  // dettaglio, il cui `background: transparent` (dichiarato dopo nel CSS)
  // vinceva sulla .mg-dot--on → cerchietti sempre vuoti anche con priorità.
  const bg = await page.locator('.mg-item .mg-dot--on').first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(bg).not.toBe('transparent');

  // Il click sul pallino NON deve aprire il dettaglio (è un'azione a parte).
  await expect(page.locator('#mgDetail')).toBeHidden();
});

test('Priorità: ri-clic sul pallino attivo azzera; per i non-admin i pallini sono in sola lettura', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK && window.filo);
  await stubFeedbackUpdate(page);

  // Owner: parte da priorità 2, ri-clic sul 2° pallino → azzera (priority 0).
  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(true);
    window.__mgTest.setData([{ ...fb, priority: 2 }]);
    window.__mgTest.setTab('queue');
  }, FB_QUEUE_A);

  await expect(page.locator('.mg-item .mg-dot--on')).toHaveCount(2);
  await page.locator('.mg-item .mg-dot').nth(1).click();
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const patch = await page.evaluate(() => window.__updates[0]);
  expect(patch.priority).toBe(0);

  // Non-admin: i pallini ci sono ma sono in sola lettura (nessun bottone cliccabile).
  await page.evaluate((fb) => {
    window.__mgTest.setAdmin(false);
    window.__mgTest.setData([{ ...fb, priority: 1 }]);
    window.__mgTest.setTab('queue');
  }, FB_QUEUE_A);
  await expect(page.locator('.mg-item .mg-priority')).toHaveCount(1);
  await expect(page.locator('.mg-item .mg-dot--readonly')).toHaveCount(3);
  await expect(page.locator('.mg-item button.mg-dot')).toHaveCount(0);
});

test('la pagina carica senza errori JavaScript', async ({ openTab }) => {
  const errors = [];
  const page = await openTab(URL);
  page.on('pageerror', (err) => errors.push(err.message));
  await page.waitForLoadState('domcontentloaded');
  // Attendi un po' per errori asincroni (fetch Firestore ecc. → ignorabili)
  await page.waitForTimeout(800);
  // Filtra errori di rete (fetch falliti in test senza Firestore): quelli sono attesi
  const jsErrors = errors.filter(
    (e) => !e.includes('fetch') && !e.includes('Failed to fetch') &&
            !e.includes('firestore') && !e.includes('network') &&
            !e.includes('canale main')
  );
  expect(jsErrors).toHaveLength(0);
});

// ── DB3: "In produzione" = fix uscito in una versione rilasciata ─────────────
// Un `done` con resolvedInVersion ≤ versione rilasciata appare in "Risolti";
// un `done` con versione futura (non ancora spedito) resta in "In coda".
// Esercita il VERO renderList via l'hook di test (niente replica manuale della
// logica): inietta i feedback, fissa la versione rilasciata e cambia tab.
test('DB3: solo i fix rilasciati appaiono in Risolti; i non-spediti restano In coda', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW);

  const shipped = {
    _id: 'db3-shipped', name: 'Fix gia rilasciato', seq: 201, subSeq: 0,
    status: 'done', resolvedInVersion: '0.2.70',
    clientId: 'tester@example.com', createdAt: '2026-06-20T10:00:00Z', images: [],
  };
  const pending = {
    _id: 'db3-pending', name: 'Fix non ancora spedito', seq: 202, subSeq: 0,
    status: 'done', resolvedInVersion: '0.2.99',
    clientId: 'tester@example.com', createdAt: '2026-06-21T10:00:00Z', images: [],
  };

  await page.evaluate(({ a, b }) => {
    window.__mgTest.setData([a, b]);
    window.__mgTest.setReleasedVersion('0.2.74');
  }, { a: shipped, b: pending });

  // Tab "Risolti": solo il fix spedito.
  await page.evaluate(() => window.__mgTest.setTab('resolved'));
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item-title')).toHaveText('Fix gia rilasciato');

  // Tab "In coda": il done non ancora spedito è qui (visibile finché non esce).
  await page.evaluate(() => window.__mgTest.setTab('queue'));
  await expect(page.locator('.mg-item')).toHaveCount(1);
  await expect(page.locator('.mg-item-title')).toHaveText('Fix non ancora spedito');

  // Quando la versione rilasciata raggiunge quella del fix, passa a "Risolti".
  await page.evaluate(() => window.__mgTest.setReleasedVersion('0.2.99'));
  await page.evaluate(() => window.__mgTest.setTab('resolved'));
  await expect(page.locator('.mg-item')).toHaveCount(2);
});

// ── DD1: Sezione "Modelli di supporto" ──────────────────────────────────────

// Modelli finti restituiti dal mock di support_models_get.
const FAKE_SUPPORT_MODELS = {
  sanitizer:    'flash',
  judge1:       'flash, flash-or',
  judge2:       'flash',
  judge3:       'flash',
  judgeDynamic: 'flash',
  judgeRedTeam: 'flash',
  judgePriority: '',
};

// Stub IPC: intercetta support_models_get e support_models_update senza rete.
async function stubSupportModels(page, initialModels, isAdmin = true) {
  await page.evaluate(({ models, admin }) => {
    window.__smUpdates = [];
    const orig = window.filo.message.bind(window.filo);
    window.filo.message = async (msg) => {
      if (msg && msg.type === 'auth_status') return { isAdmin: admin };
      if (msg && msg.type === 'support_models_get') {
        if (!admin) return { ok: false, error: 'non admin' };
        return { ok: true, models };
      }
      if (msg && msg.type === 'support_models_update') {
        window.__smUpdates.push(msg.models);
        return { ok: true, models: msg.models };
      }
      return orig(msg);
    };
  }, { models: initialModels, admin: isAdmin });
}

test('DD1: la tab Modelli di supporto renderizza tutti gli slot col modelChainEditor', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);

  await stubSupportModels(page, FAKE_SUPPORT_MODELS);

  // Clicca la tab: innesca il caricamento lazy.
  await page.locator('.mg-tab[data-tab="models"]').click();

  // Attendi che l'editor sia visibile (caricamento IPC completato).
  await expect(page.locator('#mgSmEditor')).toBeVisible({ timeout: 5000 });

  // 7 slot presenti nel DOM (sanitizer + 3 giudici fissi + dinamico + red-team + priorità).
  await expect(page.locator('.mg-sm-slot')).toHaveCount(7);
  await expect(page.locator('[data-slot="sanitizer"]')).toBeVisible();
  await expect(page.locator('[data-slot="judge1"]')).toBeVisible();
  await expect(page.locator('[data-slot="judge2"]')).toBeVisible();
  await expect(page.locator('[data-slot="judge3"]')).toBeVisible();
  await expect(page.locator('[data-slot="judgeDynamic"]')).toBeVisible();
  await expect(page.locator('[data-slot="judgeRedTeam"]')).toBeVisible();
  await expect(page.locator('[data-slot="judgePriority"]')).toBeVisible();
  // Il vecchio slot unico non deve più esistere.
  await expect(page.locator('[data-slot="judgeL2"]')).toHaveCount(0);

  // I 4 giudici del panel mostrano etichette amichevoli (non l'id grezzo).
  await expect(page.locator('[data-slot="judge1"] label')).toHaveText('Giudice 1');
  await expect(page.locator('[data-slot="judge2"] label')).toHaveText('Giudice 2');
  await expect(page.locator('[data-slot="judge3"] label')).toHaveText('Giudice 3');
  await expect(page.locator('[data-slot="judgeDynamic"] label')).toHaveText('Giudice dinamico');

  // Ogni slot ha almeno un input (modelChainEditor crea .sn-chain-input per ogni segmento).
  const chainInputs = page.locator('.mg-sm-chain-host .sn-chain-input');
  const count = await chainInputs.count();
  expect(count).toBeGreaterThanOrEqual(7);

  // Il bottone "Salva" è visibile.
  await expect(page.locator('#mgSmSaveBtn')).toBeVisible();
});

test('DD1: i valori caricati popolano i campi (slot con catena ha più segmenti)', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);

  await stubSupportModels(page, FAKE_SUPPORT_MODELS);
  await page.locator('.mg-tab[data-tab="models"]').click();
  await expect(page.locator('#mgSmEditor')).toBeVisible({ timeout: 5000 });

  // Lo slot "sanitizer" ha valore "flash" → un solo input con "flash".
  const sanitizerHost = page.locator('#mgSmChain-sanitizer');
  const sanitizerInput = sanitizerHost.locator('.sn-chain-input').first();
  await expect(sanitizerInput).toHaveValue('flash');

  // Lo slot "judge1" ha valore "flash, flash-or" → due segmenti (due input).
  const judge1Inputs = page.locator('#mgSmChain-judge1 .sn-chain-input');
  await expect(judge1Inputs).toHaveCount(2);
  await expect(judge1Inputs.nth(0)).toHaveValue('flash');
  await expect(judge1Inputs.nth(1)).toHaveValue('flash-or');

  // judge2/judge3/judgeDynamic hanno valori indipendenti (un solo segmento "flash").
  await expect(page.locator('#mgSmChain-judge2 .sn-chain-input')).toHaveValue('flash');
  await expect(page.locator('#mgSmChain-judge3 .sn-chain-input')).toHaveValue('flash');
  await expect(page.locator('#mgSmChain-judgeDynamic .sn-chain-input')).toHaveValue('flash');
});

test('DD1: il bottone Salva invia support_models_update con i valori corretti', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);

  await stubSupportModels(page, FAKE_SUPPORT_MODELS);
  await page.locator('.mg-tab[data-tab="models"]').click();
  await expect(page.locator('#mgSmEditor')).toBeVisible({ timeout: 5000 });

  // Salva senza modifiche.
  await page.locator('#mgSmSaveBtn').click();

  // La IPC support_models_update è stata chiamata una volta.
  await expect.poll(() => page.evaluate(() => window.__smUpdates.length)).toBe(1);
  const sent = await page.evaluate(() => window.__smUpdates[0]);

  // Tutti gli slot sono presenti nel payload, con uno slot per giudice del panel.
  expect(sent).toHaveProperty('sanitizer');
  expect(sent).toHaveProperty('judge1');
  expect(sent).toHaveProperty('judge2');
  expect(sent).toHaveProperty('judge3');
  expect(sent).toHaveProperty('judgeDynamic');
  expect(sent).toHaveProperty('judgeRedTeam');
  expect(sent).toHaveProperty('judgePriority');
  // Il vecchio slot unico non viene più inviato.
  expect(sent).not.toHaveProperty('judgeL2');

  // I 4 giudici persistono in modo indipendente: i valori distinti del mock
  // arrivano ognuno nel proprio slot (judge1 catena, gli altri "flash").
  expect(sent.judge1).toBe('flash, flash-or');
  expect(sent.judge2).toBe('flash');
  expect(sent.judge3).toBe('flash');
  expect(sent.judgeDynamic).toBe('flash');

  // I valori tornati dal mock vengono confermati (status "Salvato.").
  await expect(page.locator('#mgSmStatus')).toHaveText('Salvato.');
});

test('DD1: per i non-admin la sezione mostra il messaggio di accesso negato', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.filo);

  // Stub con admin=false.
  await stubSupportModels(page, {}, false);
  await page.locator('.mg-tab[data-tab="models"]').click();

  // Aspetta che il caricamento finisca (il denied appare subito dopo la risposta).
  await expect(page.locator('#mgSmDenied')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('#mgSmEditor')).toBeHidden();
});

// ── Conversazione completa del feedback + iter di lavorazione ──────────────
// Il dettaglio deve mostrare TUTTI i commenti: la segnalazione, il commento
// dell'owner alla revisione, i report delle istanze che hanno lavorato e gli
// esiti del controllo funzionalità (prima erano invisibili in dashboard).

const FAKE_FB_WORKED = {
  _id: 'test-fb-worked',
  text: 'Il copia-incolla delle immagini non funziona.',
  name: 'Copia-incolla immagini',
  seq: 120, subSeq: 0,
  clientId: 'tester@example.com',
  createdAt: '2026-07-01T10:00:00Z',
  images: [],
  status: 'revision_capability',
  branch: 'worker/test-fb-worked',
  reviewComment: 'Approvo, ma occhio al tema scuro.',
  reviewedAt: '2026-07-02T09:00:00Z',
  pipeline: { filoSummary: 'Richiesta legittima di fix.', verdicts: [] },
  notes: [
    'Ho sistemato l\'incolla delle immagini: ora arrivano al destinatario. Decisione presa: le immagini troppo grandi vengono ridotte.',
    '',
    '--- La tua risposta del 05/07/2026, 10:00 ---',
    'Sul tema scuro ancora non si vede.',
    '',
    "--- Aggiornamento dell'agente del 06/07/2026, 11:00 ---",
    'Controllo funzionalità NON superato: sul tema scuro l\'anteprima resta invisibile.',
  ].join('\n'),
};

test('il dettaglio mostra la conversazione completa: report, esito verifica e commento owner', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_FEEDBACK_THREAD);

  await page.evaluate((fb) => {
    window.__mgTest.setData([fb]);
    window.__mgTest.setTab('queue');
    window.__mgTest.openDetail(fb._id);
  }, FAKE_FB_WORKED);

  const bubbles = page.locator('#mgThread .mg-bubble');
  // 6 bolle: segnalazione, parere Filo, commento owner, report istanza,
  // risposta owner, esito verifier.
  await expect(bubbles).toHaveCount(6);

  // La segnalazione originale.
  await expect(bubbles.nth(0)).toContainText('copia-incolla delle immagini');
  // Il commento dell'owner alla revisione (prima non compariva da nessuna parte).
  await expect(bubbles.nth(2)).toContainText('Approvo, ma occhio al tema scuro.');
  await expect(bubbles.nth(2).locator('.mg-bubble-who')).toContainText('Tu');
  // Il report dell'istanza che ha implementato, con le decisioni prese.
  await expect(bubbles.nth(3)).toContainText('Decisione presa');
  // La risposta dell'owner è un turno utente separato.
  await expect(bubbles.nth(4)).toContainText('tema scuro ancora non si vede');
  await expect(bubbles.nth(4).locator('.mg-bubble-who')).toContainText('Tu');
  // L'esito del verifier è visibile nella conversazione.
  await expect(bubbles.nth(5)).toContainText('Controllo funzionalità NON superato');

  // La striscia di avanzamento del dettaglio: implementazione fatta, controllo
  // funzionalità in corso, nessuna istanza al lavoro (nessun claim vivo).
  await expect(page.locator('#mgWorkState')).toBeVisible();
  await expect(page.locator('#mgWorkState')).toContainText('Controllo funzionalità');
  await expect(page.locator('#mgWorkState')).toContainText('Nessuna istanza al lavoro');
});

test('in "In coda" il feedback in lavorazione è pinnato in cima con lo stato dell\'iter', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.SN_MANAGE_REVIEW);

  await page.evaluate(() => {
    const fbs = [
      // todo ad alta priorità: senza pinning starebbe primo.
      { _id: 'q-todo', text: 'todo prioritario', name: 'Todo', seq: 1, subSeq: 0,
        status: 'todo', priority: 3, createdAt: '2026-07-08T10:00:00Z' },
      // working con istanza ATTIVA (workingSince fresco + claim vivo).
      { _id: 'q-working', text: 'in lavorazione', name: 'Working', seq: 2, subSeq: 0,
        status: 'working', priority: 0,
        workingSince: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        claimedBy: 'vm-test', claimExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        createdAt: '2026-07-01T10:00:00Z' },
    ];
    window.__mgTest.setData(fbs);
    window.__mgTest.setTab('queue');
  });

  const items = page.locator('#mgList .mg-item');
  await expect(items).toHaveCount(2);
  // Il working è PRIMO nonostante la priorità più bassa del todo.
  await expect(items.nth(0)).toHaveAttribute('data-id', 'q-working');
  // La card pinnata mostra i tre passaggi dell'iter e l'istanza attiva.
  const state = items.nth(0).locator('.mg-item-state');
  await expect(state).toContainText('Implementazione');
  await expect(state).toContainText('Controllo funzionalità');
  await expect(state).toContainText('Controllo sicurezza');
  await expect(state).toContainText("Un'istanza ci sta lavorando ora");
  // Il todo normale non ha la riga di stato.
  await expect(items.nth(1).locator('.mg-item-state')).toHaveCount(0);
});
