// #2388 — Le parole in corsivo delle risposte di Filo hanno una spiegazione al passaggio: riquadro al passaggio, clic
// che lo tiene, Esc che lo chiude, spiegazioni annidate accanto, tasto destro con «Spiegami di più» e «Copia la
// spiegazione»; il corsivo senza spiegazione e le righe di servizio della home escono dritti; un SVG non esegue niente.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { home, modelloFinto, chiedi, chiamateAlModello, ripristina } from './helpers/chatFinta.mjs';
import { paginaDellAiuto } from './helpers/riquadri.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '.shots');
const SVG = '<svg viewBox="0 0 40 20"><script>window.parent.__svgEseguito = true; window.__svgEseguito = true;</script>'
  + '<rect x="2" y="4" width="16" height="12" rx="3" fill="#c45a3b" onload="window.__svgEseguito = true"/>'
  + '<rect x="22" y="4" width="16" height="12" rx="3" fill="#6e6b63"/></svg>';
const RISPOSTA = 'Quando scrivi un indirizzo, il {{DNS|Traduce il nome di un sito nel suo {{indirizzo IP|Il numero che identifica un computer in rete.}}.}}'
  + ' risponde subito se la risposta sta nella {{cache|Una copia vicina dei dati, per non chiederli di nuovo. ' + SVG + '}}.'
  + ' Questa *enfasi* esce dritta.';

const parola = (page, testo) => page.locator('.dash-bubble-md .filo-spiega', { hasText: testo }).last();
const riquadri = (page) => page.locator('.filo-spiega-riquadro');
const stile = (loc, prop) => loc.evaluate((el, p) => getComputedStyle(el)[p], prop);

test('una risposta con due termini spiegati: passaggio, annidati, clic, Esc, tasto destro', async ({ app }) => {
  await modelloFinto(app, [{ text: RISPOSTA }, { text: 'Il DNS è la rubrica di internet.' }]);
  const page = await home(app);
  await chiedi(page, 'come fa il browser a trovare un sito?');
  const bolla = page.locator('.dash-bubble-filo.dash-bubble-md').last();
  await expect(bolla).toContainText('Questa enfasi esce dritta.');

  // I due termini spiegati in corsivo, il resto dritto e senza asterischi.
  await expect(bolla.locator(':scope .filo-spiega')).toHaveCount(2);
  expect(await stile(parola(page, 'DNS'), 'fontStyle')).toBe('italic');
  expect(await stile(parola(page, 'cache'), 'fontStyle')).toBe('italic');
  expect(await bolla.locator('p').first().evaluate((p) => getComputedStyle(p).fontStyle)).toBe('normal');
  await expect(bolla.locator('em, i')).toHaveCount(0);
  await expect(bolla).not.toContainText('{{');

  // Passaggio: la parola cambia colore e il riquadro si apre.
  const coloreFermo = await stile(parola(page, 'DNS'), 'color');
  await parola(page, 'DNS').hover();
  await expect.poll(() => stile(parola(page, 'DNS'), 'color')).not.toBe(coloreFermo);
  await expect(riquadri(page)).toHaveCount(1);
  await expect(riquadri(page).first()).toContainText('Traduce il nome di un sito');

  // Un termine dentro il riquadro apre il secondo accanto; uscendo si chiudono tutti e due.
  await riquadri(page).first().locator('.filo-spiega', { hasText: 'indirizzo IP' }).hover();
  await expect(riquadri(page)).toHaveCount(2);
  await expect(riquadri(page).nth(1)).toContainText('Il numero che identifica un computer in rete.');
  const [primo, secondo] = await Promise.all([riquadri(page).nth(0).boundingBox(), riquadri(page).nth(1).boundingBox()]);
  expect(secondo.x >= primo.x + primo.width - 1 || secondo.x + secondo.width <= primo.x + 1).toBe(true);
  await riquadri(page).nth(1).hover();
  await expect(riquadri(page)).toHaveCount(2);
  await page.mouse.move(5, 5);
  await expect(riquadri(page)).toHaveCount(0);

  // Clic: il riquadro resta aperto anche col mouse altrove; Esc lo chiude. Il disegno è un'immagine, lo script no.
  await parola(page, 'cache').click();
  await expect(riquadri(page)).toHaveCount(1);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(700);
  await expect(riquadri(page)).toHaveCount(1);
  const img = riquadri(page).locator('img.filo-md-img');
  await expect(img).toHaveCount(1);
  expect(await img.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  await expect.poll(() => img.evaluate((i) => i.complete && i.naturalWidth)).toBeGreaterThan(0);
  await expect(riquadri(page).locator('svg, script')).toHaveCount(0);
  await expect(page.locator('.dash-bubble-md script, svg[viewBox="0 0 40 20"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__svgEseguito === true)).toBe(false);

  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, 'spiegazioni-chiaro.png') });
  await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ theme: 'dark' }));
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', 'dark');
  await expect.poll(() => stile(parola(page, 'DNS'), 'color')).toBe(await stile(bolla.locator('p').first(), 'color'));
  await page.screenshot({ path: join(SHOTS, 'spiegazioni-scuro.png') });
  await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ theme: 'light' }));

  await page.keyboard.press('Escape');
  await expect(riquadri(page)).toHaveCount(0);
  await expect(page.locator('#input')).toBeVisible();

  // Tasto destro: le due voci; «Copia la spiegazione» copia il testo della spiegazione.
  await parola(page, 'cache').click({ button: 'right' });
  // A icone come ogni menu di Filo (#2555): le stesse voci, ogni icona seguita dalle varianti del suo verbo.
  const menu = menuDi(page);
  expect(await vociSpiega(page)).toEqual(['Spiegami di più', 'Copia la spiegazione']);
  await menu.scegli('Copia la spiegazione');
  await expect(menu.pannelli).toHaveCount(0);
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Una copia vicina dei dati, per non chiederli di nuovo.');

  // «Spiegami di più» arriva in chat, nella stessa conversazione, senza toccare quello che stavi scrivendo.
  await page.locator('#input').fill('bozza che resta');
  await parola(page, 'DNS').click({ button: 'right' });
  await menuDi(page).scegli('Spiegami di più');
  await expect(page.locator('.dash-bubble-user').last()).toHaveText('Spiegami di più su «DNS».');
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Il DNS è la rubrica di internet.');
  const chiamate = await chiamateAlModello(app);
  const ultima = JSON.stringify(chiamate[chiamate.length - 1]);
  expect(ultima).toContain('Spiegami di più su «DNS».');
  expect(ultima).toContain('come fa il browser a trovare un sito?');
  await expect(page.locator('#input')).toHaveValue('bozza che resta');
  await ripristina(app);
});

test('nel riquadro di «Spiega» la parola spiegata si apre, e «Spiegami di più» prosegue quella conversazione', async ({ app, openTab }) => {
  const page = await openTab('filo://newtab/');
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__spiegaRichieste = [];
    globalThis.__origProviderSpiega = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origProviderSpiega,
      streamComplete: async ({ messages, onDelta }) => {
        globalThis.__spiegaRichieste.push((messages || []).map((m) => m.content).join('\n'));
        const t = globalThis.__spiegaRichieste.length === 1
          ? 'Un {{sinodo|Un\'assemblea di vescovi che decide su questioni della Chiesa.}} si riunisce di rado.'
          : 'Il sinodo più noto è quello dei vescovi, convocato dal Papa.';
        onDelta(t);
        return { text: t, usage: {} };
      },
    };
  });
  await page.waitForFunction(() => !!window.SN_POPUP?.openStreaming && !!window.SN_CONST, null, { timeout: 8000 });
  await page.evaluate(() => window.SN_POPUP.openStreaming({
    action: window.SN_CONST.ACTIONS.EXPLAIN_DEEP,
    payload: { selection: 'sinodo', sentence: 'Il sinodo si è chiuso ieri.' },
    anchor: { x: 120, y: 160 }, title: 'Approfondisci',
  }));
  const termine = page.locator('.sn-popup-body .filo-spiega', { hasText: 'sinodo' });
  await expect(termine).toHaveCount(1, { timeout: 15_000 });
  expect(await stile(termine, 'fontStyle')).toBe('italic');
  await termine.hover();
  await expect(riquadri(page)).toHaveCount(1);
  await expect(riquadri(page)).toContainText('Un\'assemblea di vescovi');
  await termine.click({ button: 'right' });
  await menuDi(page).scegli('Spiegami di più');
  await expect(page.locator('.sn-popup-body .sn-msg-user .sn-msg-text').last()).toHaveText('Spiegami di più su «sinodo».');
  await expect(page.locator('.sn-popup-body')).toContainText('convocato dal Papa', { timeout: 15_000 });
  const richieste = await app.evaluate(() => globalThis.__spiegaRichieste);
  expect(richieste.length).toBe(2);
  expect(richieste[1]).toContain('Spiegami di più su «sinodo».');
  expect(richieste[1]).toContain('si riunisce di rado');
  // Il riquadro è suo: la chat della home non ha ricevuto niente.
  await expect(page.locator('.dash-bubble-user')).toHaveCount(0);
  await app.evaluate(() => { globalThis.SN_PROVIDER_OPENROUTER = globalThis.__origProviderSpiega; });
});

test('nella chat dei Mazzi la risposta ha le spiegazioni al passaggio, e le carte restano carte', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_SCRYFALL._setFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    globalThis.__mazziRichieste = [];
    const rispondi = async ({ attempts, messages }) => {
      // Solo le richieste dei Mazzi: quelle che la home manda intanto (i suggerimenti) non entrano nel conto.
      if (!messages.some((m) => String(m.content || '').includes('[[Nome Carta]]'))) {
        return { text: '{}', model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      }
      globalThis.__mazziRichieste.push(String(messages[messages.length - 1].content || ''));
      const reply = globalThis.__mazziRichieste.length === 1
        ? 'Con questo comandante conta il {{ramp|Le carte che ti danno mana in più nei primi turni.}}: prova **[[Sol Ring]]**.'
        : 'Il ramp accelera il mana.';
      return { text: JSON.stringify({ reply }), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.__origMazzi = { c: globalThis.SN_PROVIDERS.completeWithFallback, s: globalThis.SN_PROVIDERS.streamCompleteWithFallback };
    globalThis.SN_PROVIDERS.completeWithFallback = rispondi;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async (args) => {
      const r = await rispondi(args);
      if (args.onDelta) args.onDelta(r.text);
      return r;
    };
  });
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  await page.fill('#chatInput', 'cosa mi serve?');
  await page.press('#chatInput', 'Enter');
  const risposta = page.locator('.dk-msg-bot').last().locator('.dk-msg-text');
  await expect(risposta.locator('.filo-spiega', { hasText: 'ramp' })).toHaveCount(1);
  await expect(risposta.locator('strong .dk-prose-card[data-card-name="Sol Ring"]')).toHaveText('Sol Ring');
  await expect(risposta).not.toContainText('{{');
  await risposta.locator('.filo-spiega').hover();
  await expect(riquadri(page)).toContainText('Le carte che ti danno mana in più');
  await risposta.locator('.filo-spiega').click({ button: 'right' });
  await menuDi(page).scegli('Spiegami di più');
  await expect(page.locator('.dk-msg-user').last()).toHaveText('Spiegami di più su «ramp».');
  await expect(page.locator('.dk-msg-bot').last().locator('.dk-msg-text')).toContainText('Il ramp accelera il mana.');
  expect((await app.evaluate(() => globalThis.__mazziRichieste)).at(-1)).toContain('Spiegami di più su «ramp».');
  await app.evaluate(() => {
    globalThis.SN_PROVIDERS.completeWithFallback = globalThis.__origMazzi.c;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.__origMazzi.s;
  });
});

for (const url of ['filo://feedback/feedback.html', 'filo://manage/manage.html']) {
  test(`${url}: le risposte di Filo mostrate in sola lettura aprono la spiegazione, e il tasto destro la copia`, async ({ app, openTab }) => {
    const page = await openTab(url);
    await page.waitForFunction(() => !!document.body._filoSpiegazioni && !!window.SN_MARKDOWN, null, { timeout: 15_000 });
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.className = 'filo-md prova-2388';
      box.style.cssText = 'position:fixed;left:40px;top:40px;z-index:9;background:var(--sn-bg);padding:8px';
      box.innerHTML = window.SN_MARKDOWN.render('Il {{DNS|Traduce il nome di un sito nel suo indirizzo.}} risponde.');
      document.body.appendChild(box);
    });
    const termine = page.locator('.prova-2388 .filo-spiega');
    await termine.hover();
    await expect(riquadri(page)).toContainText('Traduce il nome di un sito');
    await termine.click({ button: 'right' });
    expect(await vociSpiega(page)).toEqual(['Copia la spiegazione']);
    await menuDi(page).scegli('Copia la spiegazione');
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Traduce il nome di un sito nel suo indirizzo.');
  });
}

test('nella home la risposta che sta arrivando non mostra il marcatore, e la parola si spiega già', async ({ app }) => {
  await modelloFinto(app, [{ text: 'x' }]);
  await app.evaluate(async () => {
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      const pezzi = ['Il {{DNS|Traduce il nome di un sito.}} risponde subito. '];
      for (let i = 0; i < 80; i++) pezzi.push('Parola' + i + ' ');
      let tutto = '';
      for (const p of pezzi) {
        tutto += p;
        try { onDelta && onDelta(p); } catch (_) {}
        await new Promise((r) => setTimeout(r, 100));
      }
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: tutto, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });
  const page = await home(app);
  await chiedi(page, 'come si trova un sito?');
  const bolla = page.locator('.dash-bubble-filo').last();
  await expect(bolla).toContainText('Parola3');
  await expect(bolla).not.toContainText('{{');
  await expect(bolla).not.toContainText('Traduce il nome');
  const termine = bolla.locator('.filo-spiega', { hasText: 'DNS' });
  await termine.hover();
  await expect(riquadri(page)).toHaveCount(1);
  await expect(riquadri(page)).toContainText('Traduce il nome di un sito.');
  // La risposta stava ancora arrivando, e il riquadro resta aperto mentre la bolla cresce sotto il puntatore.
  await expect(bolla).not.toContainText('Parola79');
  await page.waitForTimeout(1000);
  await expect(riquadri(page)).toHaveCount(1);
  await ripristina(app);
});

test('nella home una parola spiegata dentro un riquadro chiede di più nella stessa conversazione', async ({ app }) => {
  await modelloFinto(app, [{ text: RISPOSTA }, { text: 'Ok.' }]);
  const page = await home(app);
  await chiedi(page, 'come fa il browser a trovare un sito?');
  await parola(page, 'DNS').click();
  await expect(riquadri(page)).toHaveCount(1);
  await riquadri(page).first().locator('.filo-spiega', { hasText: 'indirizzo IP' }).click({ button: 'right' });
  expect(await vociSpiega(page)).toEqual(['Spiegami di più', 'Copia la spiegazione']);
  await menuDi(page).scegli('Spiegami di più');
  await expect(page.locator('.dash-bubble-user').last()).toHaveText('Spiegami di più su «indirizzo IP».');
  await ripristina(app);
});

test('nell\'Aiuto sui siti la parola spiegata apre il riquadro, e «Spiegami di più» prosegue la conversazione', async ({ app, shell, openTab, testServer }) => {
  const RISPOSTA_AIUTO = 'Il {{DNS|Traduce il nome di un sito.}} risponde subito.';
  await app.evaluate(async (_e, risposta) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__aiutoSp = { chiamate: [], orig: { c: globalThis.SN_PROVIDERS.completeWithFallback, s: globalThis.SN_PROVIDERS.streamCompleteWithFallback } };
    const f = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return { ...base, text: '{}' };
      globalThis.__aiutoSp.chiamate.push(JSON.stringify(messages.slice(-3)));
      const text = JSON.stringify({ text: globalThis.__aiutoSp.chiamate.length === 1 ? risposta : 'Il DNS è la rubrica.', status: 'done' });
      try { onDelta && onDelta(text); } catch (_) {}
      return { ...base, text };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = f;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = f;
  }, RISPOSTA_AIUTO);
  const sito = await testServer.openReady(openTab, '<!doctype html><title>Guida</title><h1>Guida</h1><p>Testo</p>');
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, sito);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await aiuto.fill('.sn-sidebar-input textarea', 'come si trova un sito?');
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
  const termine = aiuto.locator('.filo-spiega', { hasText: 'DNS' }).first();
  await expect(termine).toBeVisible({ timeout: 10_000 });
  expect(await stile(termine, 'fontStyle')).toBe('italic');
  await termine.hover();
  await expect(riquadri(aiuto)).toContainText('Traduce il nome di un sito.');
  await aiuto.keyboard.press('Escape');
  await expect(riquadri(aiuto)).toHaveCount(0);
  await termine.click();
  await aiuto.mouse.move(2, 2);
  await aiuto.waitForTimeout(600);
  await expect(riquadri(aiuto)).toHaveCount(1);
  await aiuto.keyboard.press('Escape');
  await termine.click({ button: 'right' });
  await expect(aiuto.locator('.filo-spiega-menu .filo-spiega-voce')).toHaveText(['Spiegami di più', 'Copia la spiegazione']);
  await aiuto.locator('.filo-spiega-menu [data-voce="piu"]').click();
  await expect.poll(() => app.evaluate(() => globalThis.__aiutoSp.chiamate.length)).toBe(2);
  expect(await app.evaluate(() => globalThis.__aiutoSp.chiamate[1])).toContain('Spiegami di più su «DNS».');
  await app.evaluate(() => {
    globalThis.SN_PROVIDERS.completeWithFallback = globalThis.__aiutoSp.orig.c;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.__aiutoSp.orig.s;
  });
});

test('nella spiegazione del menu del tasto destro la parola in corsivo apre la sua spiegazione', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const t = 'Un {{sinodo|Un\'assemblea di vescovi.}} che si riunisce di rado.';
    globalThis.__origMenuSpiega = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...globalThis.__origMenuSpiega,
      complete: async () => ({ text: t, usage: {} }),
      streamComplete: async ({ onDelta }) => { try { onDelta && onDelta(t); } catch (_) {} return { text: t, usage: {} }; },
    };
  });
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Prova</title>'
    + '<p id="t" style="font:18px sans-serif;margin:120px 40px">Il sinodo si è chiuso ieri.</p>');
  await page.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('#t'));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.locator('#t').click({ button: 'right' });
  const menu = menuDi(page);
  const termine = menu.locator('.sn-menu-inline-explain .filo-spiega', { hasText: 'sinodo' });
  await expect(termine).toHaveCount(1, { timeout: 15_000 });
  await termine.hover();
  await expect(menu.locator('.filo-spiega-riquadro')).toContainText('Un\'assemblea di vescovi.');
  // Esc chiude il riquadro, non il menu: un secondo Esc chiude il menu.
  await page.keyboard.press('Escape');
  await expect(menu.locator('.filo-spiega-riquadro')).toHaveCount(0);
  await expect(menu.locator('.sn-menu-inline-explain')).toBeVisible();
  await app.evaluate(() => { globalThis.SN_PROVIDER_OPENROUTER = globalThis.__origMenuSpiega; });
});

test('le righe di servizio della home escono dritte, nel loro grigio', async ({ app }) => {
  const page = await home(app);
  const stili = await page.evaluate(() => {
    const classi = ['dash-bubble dash-bubble-filo dash-bubble-pending', 'dash-activity-note', 'dash-cambio-stato',
      'dash-cerca-niente', 'dash-bubble-interrotta', 'dash-riga-app-vuoto', 'dash-cmd-output-empty', 'dash-action-step'];
    return classi.map((c) => {
      const el = document.createElement('div');
      el.className = c;
      el.textContent = 'riga';
      document.body.appendChild(el);
      const s = getComputedStyle(el).fontStyle;
      el.remove();
      return [c, s];
    });
  });
  for (const [c, s] of stili) expect(s, c).toBe('normal');
});
