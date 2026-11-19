// Verifica #2346 giro 1: rispondere a passi selezionati di una risposta di Filo, con risposte formattate, passi
// ripetuti, più messaggi, chat lunga. Il modello è finto.

import { test, expect } from '../../fixtures/electron.mjs';

async function preparaModello(app, copione) {
  await app.evaluate(async (_e, copione) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_FILO_MEMORY.setOnboarding({ done: true, ticked: [], thread: [] });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__copione = copione.slice();
    globalThis.__chiamate = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {} };
      const chat = !!messages[0] && messages[0].role === 'system' && String(messages[0].content || '').startsWith(globalThis.SN_CONST.PROMPTS.filoChatStatic());
      if (!chat) return { ...base, text: '{}', toolCalls: [], finishReason: 'stop' };
      globalThis.__chiamate.push(JSON.parse(JSON.stringify(messages)));
      const r = globalThis.__copione.shift() || { text: 'ok' };
      try { onDelta && onDelta(r.text); } catch (_) {}
      return { ...base, text: r.text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  }, copione);
}

const testo = (m) => (typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n'));
const ultimaDomanda = async (app) => {
  const tutte = await app.evaluate(() => globalThis.__chiamate);
  const msgs = tutte[tutte.length - 1];
  return testo(msgs[msgs.length - 1]);
};

async function apriHome(openTab) {
  const home = await openTab('filo://newtab/');
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  return home;
}

async function scrivi(home, cosa) {
  await expect(home.locator('#input')).toBeEditable({ timeout: 15_000 });
  await home.locator('#input').fill(cosa);
  await home.locator('#input').press('Enter');
}

// Seleziona dall'inizio della n-esima occorrenza di `da` alla fine della prima occorrenza di `a` che la segue,
// sul testo che si vede (i nodi di testo in fila), come farebbe il mouse.
async function selezionaDa(el, da, a, n = 0) {
  await el.evaluate((nodo, [da, a, n]) => {
    const nodi = [];
    const w = document.createTreeWalker(nodo, NodeFilter.SHOW_TEXT);
    for (let x = w.nextNode(); x; x = w.nextNode()) nodi.push(x);
    const tutto = nodi.map((x) => x.data).join('');
    let k = -1;
    for (let i = 0; i <= n; i++) k = tutto.indexOf(da, k + 1);
    if (k < 0) throw new Error(`non c'è: ${da}`);
    const j = tutto.indexOf(a, k + da.length - a.length < k ? k : k + da.length - a.length);
    if (j < 0) throw new Error(`non c'è: ${a}`);
    const dove = (p) => {
      let f = 0;
      for (const x of nodi) { if (p <= f + x.data.length) return [x, p - f]; f += x.data.length; }
      return null;
    };
    const r = document.createRange();
    r.setStart(...dove(k));
    r.setEnd(...dove(j + a.length));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  }, [da, a, n]);
}

// Dove sta la selezione: in quale risposta di Filo (indice fra le bolle di Filo), il testo selezionato e la sua
// posizione nel testo della bolla.
const doveSelezione = (home) => home.evaluate(() => {
  const s = getSelection();
  if (!s.rangeCount || s.isCollapsed) return null;
  const r = s.getRangeAt(0);
  const el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
  const bolla = el.closest('#bubbles > .dash-bubble-filo');
  const filo = [...document.querySelectorAll('#bubbles > .dash-bubble-filo')];
  if (!bolla) return { bolla: -1, testo: s.toString() };
  const prima = document.createRange();
  prima.setStart(bolla, 0);
  prima.setEnd(r.startContainer, r.startOffset);
  return { bolla: filo.indexOf(bolla), testo: s.toString(), da: prima.toString().length };
});

async function rispondi(bolla) {
  await bolla.hover();
  await bolla.getByRole('button', { name: 'Rispondi' }).click();
}

const RISPOSTA_F = [
  'Il **blu** con testo bianco è il default. Il blu è comune ovunque.',
  '',
  'Leggi la [selezione del browser](https://example.com) e poi il `codice <b>grassetto</b>` qui.',
  '',
  '- primo punto con il blu',
  '- secondo punto senza',
  '',
  '```js',
  'const scelta = "blu";',
  '```',
].join('\n');

test('formattazione: passi dentro e attraverso grassetto, link, codice e righe di elenco si citano come si leggono e si ritrovano', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  await preparaModello(app, [{ text: RISPOSTA_F }, { text: 'Letto.' }]);
  const home = await apriHome(openTab);
  await scrivi(home, 'parlami del blu');
  const risposta = home.locator('#bubbles > .dash-bubble-filo', { hasText: 'default' });
  await expect(risposta).toHaveAttribute('data-key', /^m:/, { timeout: 20_000 });
  const input = home.locator('#input');
  const pezzi = home.locator('#citazione .dash-citazione-pezzo');

  const vedo = await risposta.evaluate((el) => {
    const nodi = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let x = w.nextNode(); x; x = w.nextNode()) nodi.push(x.data);
    return nodi.join('');
  });
  const casi = [
    { nome: 'blu ripetuto', da: 'blu è comune', a: 'blu è comune', atteso: 'blu è comune', commento: 'uno' },
    { nome: 'oltre il grassetto', da: 'blu con', a: 'testo bianco', atteso: 'blu con testo bianco', commento: 'due' },
    { nome: 'oltre il link', da: 'la selezione', a: 'e poi', atteso: 'la selezione del browser e poi', commento: 'tre' },
    { nome: 'nel codice', da: 'grassetto</b>', a: 'grassetto</b>', atteso: 'grassetto</b>', commento: 'quattro' },
    { nome: 'blocco di codice', da: 'const scelta', a: 'const scelta', atteso: 'const scelta', commento: 'cinque' },
    { nome: 'fra due righe di elenco', da: 'con il blu', a: 'secondo', atteso: null, commento: 'sei' },
  ];
  for (const c of casi) {
    await selezionaDa(risposta, c.da, c.a);
    c.selezionato = await home.evaluate(() => getSelection().toString());
    c.dove = (await doveSelezione(home)).da;
    await rispondi(risposta);
    await input.fill(c.commento);
  }
  await expect(pezzi).toHaveCount(casi.length);
  const nelCampo = await pezzi.locator('.dash-citazione-testo').allTextContents();
  await home.screenshot({ path: 'tests/.shots/v2346-formattato-campo.png' });
  for (let i = 0; i < casi.length; i++) {
    const c = casi[i];
    expect.soft(nelCampo[i].replace(/\s+/g, ' ').trim(), `nel campo: ${c.nome}`).toBe((c.atteso || c.selezionato).replace(/\s+/g, ' ').trim());
  }
  await input.press('Enter');
  const mia = home.locator('#bubbles > .dash-bubble-user', { hasText: 'sei' });
  await expect(mia.locator('.dash-citata')).toHaveCount(casi.length, { timeout: 10_000 });
  await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Letto.' })).toBeVisible({ timeout: 20_000 });
  const detta = await ultimaDomanda(app);
  test.info().annotations.push({ type: 'al modello', description: detta });
  test.info().annotations.push({ type: 'testo visibile', description: vedo });
  const nellaBolla = await mia.locator('.dash-citata').evaluateAll((l) => l.map((x) => x.dataset.testo));
  test.info().annotations.push({ type: 'bolla', description: JSON.stringify(nellaBolla) });
  for (let i = 0; i < casi.length; i++) {
    const c = casi[i];
    expect.soft(nellaBolla[i].replace(/\s+/g, ' ').trim(), `nella bolla: ${c.nome}`).toBe((c.atteso || c.selezionato).replace(/\s+/g, ' ').trim());
  }
  await home.screenshot({ path: 'tests/.shots/v2346-formattato-bolla.png' });

  // Riaperta la home, ogni citazione riporta al suo passo, nella sua posizione.
  await home.reload();
  const riletta = home.locator('#bubbles > .dash-bubble-user', { hasText: 'sei' });
  await expect(riletta.locator('.dash-citata')).toHaveCount(casi.length, { timeout: 15_000 });
  for (let i = 0; i < casi.length; i++) {
    const c = casi[i];
    await home.evaluate(() => getSelection().removeAllRanges());
    await riletta.locator('.dash-citata').nth(i).click();
    await expect.poll(async () => { const d = await doveSelezione(home); return d && d.testo.replace(/\s+/g, ' ').trim(); }, { message: `riselezionato: ${c.nome}`, timeout: 5_000 })
      .toBe((c.atteso || c.selezionato).replace(/\s+/g, ' ').trim()).catch((e) => expect.soft(String(e.message).slice(0, 400)).toBe(''));
    const d = await doveSelezione(home);
    expect.soft(d && d.da, `stessa posizione: ${c.nome}`).toBe(c.dove);
  }
});

test('due risposte con le stesse parole: la citazione riporta alla risposta da cui viene', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  const R1 = 'Per stasera: Risotto ai funghi oppure pasta.';
  const R2 = 'Domani invece: Risotto ai funghi con zafferano.';
  await preparaModello(app, [{ text: R1 }, { text: R2 }, { text: 'Bene.' }]);
  const home = await apriHome(openTab);
  await scrivi(home, 'cena?');
  const prima = home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Per stasera' });
  await expect(prima).toHaveAttribute('data-key', /^m:/, { timeout: 20_000 });
  await scrivi(home, 'e domani?');
  const seconda = home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Domani invece' });
  await expect(seconda).toHaveAttribute('data-key', /^m:/, { timeout: 20_000 });

  await selezionaDa(prima, 'Risotto ai funghi', 'Risotto ai funghi');
  await rispondi(prima);
  await home.locator('#input').fill('questo sì');
  await selezionaDa(seconda, 'Risotto ai funghi', 'Risotto ai funghi');
  await rispondi(seconda);
  await home.locator('#input').fill('questo no');
  // Anche dal campo, prima di mandare, la citazione riporta al passo.
  await home.evaluate(() => getSelection().removeAllRanges());
  const vai = home.locator('#citazione .dash-citazione-pezzo').first().locator('.dash-citazione-vai, .dash-citazione-testo').first();
  await vai.click();
  await expect.poll(async () => (await doveSelezione(home))?.bolla, { message: 'dal campo, prima risposta' }).toBe(0);
  await home.locator('#input').press('Enter');
  const mia = home.locator('#bubbles > .dash-bubble-user', { hasText: 'questo no' });
  await expect(mia.locator('.dash-citata')).toHaveCount(2, { timeout: 10_000 });
  await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Bene.' })).toBeVisible({ timeout: 20_000 });
  const detta = await ultimaDomanda(app);
  test.info().annotations.push({ type: 'al modello', description: detta });

  await home.reload();
  const riletta = home.locator('#bubbles > .dash-bubble-user', { hasText: 'questo no' });
  await expect(riletta.locator('.dash-citata')).toHaveCount(2, { timeout: 15_000 });
  await riletta.locator('.dash-citata').nth(0).click();
  await expect.poll(async () => (await doveSelezione(home))?.bolla).toBe(0);
  await home.evaluate(() => getSelection().removeAllRanges());
  await riletta.locator('.dash-citata').nth(1).click();
  await expect.poll(async () => (await doveSelezione(home))?.bolla).toBe(1);
});

test('chat lunga: la citazione di una risposta lontana, riaperta la home, la riporta a vista e la seleziona', async ({ app, openTab }) => {
  test.setTimeout(240_000);
  const lunga = (i) => `Risposta numero ${i}. ` + 'Questa è una frase lunga che serve solo a riempire lo schermo di testo. '.repeat(12) + `Fine della ${i}.`;
  const N = 14;
  const copione = Array.from({ length: N }, (_, i) => ({ text: lunga(i) }));
  copione.push({ text: 'Ricevuto.' });
  await preparaModello(app, copione);
  const home = await apriHome(openTab);
  for (let i = 0; i < N; i++) {
    await scrivi(home, `domanda ${i}`);
    await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: `Fine della ${i}.` })).toHaveAttribute('data-key', /^m:/, { timeout: 20_000 });
  }
  const primaRisposta = home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Fine della 0.' });
  await primaRisposta.scrollIntoViewIfNeeded();
  await selezionaDa(primaRisposta, 'Risposta numero 0', 'Risposta numero 0');
  await rispondi(primaRisposta);
  await scrivi(home, 'torniamo alla prima');
  await expect(home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Ricevuto.' })).toBeVisible({ timeout: 20_000 });

  await home.reload();
  const mia = home.locator('#bubbles > .dash-bubble-user', { hasText: 'torniamo alla prima' });
  await expect(mia.locator('.dash-citata')).toHaveCount(1, { timeout: 15_000 });
  await mia.scrollIntoViewIfNeeded();
  await mia.locator('.dash-citata').click();
  await expect.poll(async () => (await doveSelezione(home))?.testo).toBe('Risposta numero 0');
  const aVista = await home.evaluate(() => {
    const r = getSelection().getRangeAt(0).getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && r.height > 0;
  });
  expect(aVista).toBe(true);
  await home.screenshot({ path: 'tests/.shots/v2346-lunga-trovata.png' });
});

test('esplorazione: selezione a cavallo di due messaggi, solo spazi, e Cita sul proprio messaggio con un passo', async ({ app, openTab }) => {
  test.setTimeout(150_000);
  await preparaModello(app, [{ text: 'Prima riga della risposta.\n\nSeconda riga della risposta.' }, { text: 'Ok.' }]);
  const home = await apriHome(openTab);
  await scrivi(home, 'domanda con parole mie lunghe');
  const risposta = home.locator('#bubbles > .dash-bubble-filo', { hasText: 'Prima riga' });
  await expect(risposta).toHaveAttribute('data-key', /^m:/, { timeout: 20_000 });
  const mia = home.locator('#bubbles > .dash-bubble-user', { hasText: 'domanda con parole' });
  const pezzi = home.locator('#citazione .dash-citazione-pezzo');

  // A cavallo: dalla mia domanda dentro la risposta.
  await home.evaluate(() => {
    const u = [...document.querySelectorAll('#bubbles > .dash-bubble-user')].pop();
    const f = [...document.querySelectorAll('#bubbles > .dash-bubble-filo')].pop();
    const tu = document.createTreeWalker(u, NodeFilter.SHOW_TEXT).nextNode();
    const tf = document.createTreeWalker(f, NodeFilter.SHOW_TEXT).nextNode();
    const r = document.createRange();
    r.setStart(tu, 8); r.setEnd(tf, 5);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  });
  await rispondi(risposta);
  const cavallo = await pezzi.locator('.dash-citazione-testo').allTextContents();
  test.info().annotations.push({ type: 'a cavallo', description: JSON.stringify(cavallo) });
  await home.locator('#input').press('Escape');
  await expect(pezzi).toHaveCount(0);

  // Solo spazi: fra i due paragrafi.
  await home.evaluate(() => {
    const f = [...document.querySelectorAll('#bubbles > .dash-bubble-filo')].pop();
    const ps = f.querySelectorAll('p');
    const r = document.createRange();
    r.setStartAfter(ps[0].lastChild); r.setEndBefore(ps[1].firstChild);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  });
  await rispondi(risposta);
  const spazi = await pezzi.locator('.dash-citazione-testo').allTextContents();
  test.info().annotations.push({ type: 'solo spazi', description: JSON.stringify(spazi) });
  await home.screenshot({ path: 'tests/.shots/v2346-spazi.png' });
  for (const t of spazi) expect.soft(t.trim().length, 'citazione vuota').toBeGreaterThan(0);
  await home.locator('#input').press('Escape');

  // Cita sul mio messaggio con un passo selezionato.
  await selezionaDa(mia, 'parole mie', 'parole mie');
  await mia.hover();
  await mia.getByRole('button', { name: 'Cita' }).click();
  const proprio = await pezzi.locator('.dash-citazione-testo').allTextContents();
  test.info().annotations.push({ type: 'cita proprio', description: JSON.stringify(proprio) });
  await home.screenshot({ path: 'tests/.shots/v2346-cita-proprio.png' });
  expect.soft(proprio.map((x) => x.trim())).toEqual(['parole mie']);
});
