// La chat dell'editor può MODIFICARE la formattazione del documento su comando
// (feedback alpha: «un comando tipo "scrivi in grassetto tutti i titoli"»).
//
// La risposta del modello LLM è stubbata: questi test verificano il flusso reale
// dell'utente (scrivo il comando in chat → il documento cambia davvero) e la
// logica di parsing/applicazione delle azioni. Asseriscono il SUCCESSO della
// formattazione, non la presenza di un messaggio.

import { test, expect } from './fixtures/electron.mjs';

// Porta l'editor sulla pagina che contiene il modulo chat (pagina 1, "Revisione").
async function openEditorWithChat(openTab) {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-module[data-type="switch"]');
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('.ed-module[data-type="chat"]');
  return page;
}

// Sostituisce la risposta del modello con un testo fisso, così possiamo
// pilotare l'output dell'LLM senza chiavi/rete.
async function stubLlmReply(page, replyText) {
  await page.evaluate((text) => {
    window.chrome.runtime.sendMessage = (msg, cb) => {
      const resp = { ok: true, text };
      if (typeof cb === 'function') { Promise.resolve().then(() => cb(resp)); return undefined; }
      return Promise.resolve(resp);
    };
  }, replyText);
}

async function setDocHtml(page, html) {
  await page.evaluate((h) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = h;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, html);
}

async function sendChat(page, command) {
  const input = page.locator('.ed-module[data-type="chat"] [data-chat="input"]');
  await input.click();
  await input.fill(command);
  await input.press('Enter');
}

test('«scrivi in grassetto tutti i titoli» mette in grassetto i titoli del documento', async ({ openTab }) => {
  const page = await openEditorWithChat(openTab);
  await setDocHtml(page, '<h1>Primo titolo</h1><p>testo normale</p><h2>Secondo titolo</h2>');

  // Il modello risponde con le azioni di formattazione (blocco JSON).
  await stubLlmReply(page, '```json\n{"actions":[{"op":"format","target":"headings","style":"bold","value":true}],"reply":"Ho messo in grassetto tutti i titoli."}\n```');
  await sendChat(page, 'scrivi in grassetto tutti i titoli');

  // I titoli diventano grassetto, il paragrafo no.
  await expect.poll(() => page.evaluate(() => {
    const h1 = document.querySelector('#doc h1');
    const h2 = document.querySelector('#doc h2');
    const p = document.querySelector('#doc p');
    return {
      h1: !!(h1 && h1.querySelector('strong, b')),
      h2: !!(h2 && h2.querySelector('strong, b')),
      p: !!(p && p.querySelector('strong, b')),
    };
  })).toEqual({ h1: true, h2: true, p: false });

  // La chat mostra la conferma del modello.
  await expect(page.locator('.ed-chat-msg.assistant').last()).toHaveText('Ho messo in grassetto tutti i titoli.');

  // Il grassetto sopravvive al salvataggio (marca bold nel JSON dei titoli).
  await page.keyboard.press('Control+s');
  const headingBold = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('filo.editor.doc'));
    const headings = (raw.content.content || []).filter((b) => b.type === 'heading');
    return headings.length > 0 && headings.every((h) => (h.content || []).some((n) => (n.marks || []).some((mk) => mk.type === 'bold')));
  });
  expect(headingBold).toBe(true);
});

test('una risposta SENZA azioni resta testo normale (non modifica il documento)', async ({ openTab }) => {
  const page = await openEditorWithChat(openTab);
  await setDocHtml(page, '<h1>Titolo</h1><p>contenuto</p>');

  await stubLlmReply(page, 'Il documento parla di un titolo e di un contenuto.');
  await sendChat(page, 'di cosa parla il documento?');

  await expect(page.locator('.ed-chat-msg.assistant').last())
    .toHaveText('Il documento parla di un titolo e di un contenuto.');

  // Nessuna formattazione applicata.
  const hasFormat = await page.evaluate(() => !!document.querySelector('#doc strong, #doc b, #doc em, #doc i'));
  expect(hasFormat).toBe(false);
});

test('le azioni di formattazione applicano corsivo, allineamento e font ai target giusti', async ({ openTab }) => {
  const page = await openEditorWithChat(openTab);
  await setDocHtml(page, '<h1>Titolo</h1><p>paragrafo uno</p><p>paragrafo due</p>');

  // Esercita direttamente il motore di applicazione con più operazioni insieme.
  const touched = await page.evaluate(() => window.__filoEditorFormat.applyFormatActions([
    { op: 'format', target: 'paragraphs', style: 'italic', value: true },
    { op: 'align', target: 'headings', value: 'center' },
    { op: 'format', target: 'h1', style: 'fontFamily', value: 'Georgia' },
  ]));
  expect(touched).toBeGreaterThan(0);

  const state = await page.evaluate(() => {
    const h1 = document.querySelector('#doc h1');
    const ps = Array.from(document.querySelectorAll('#doc p'));
    return {
      paragraphsItalic: ps.length === 2 && ps.every((p) => !!p.querySelector('em, i')),
      headingCentered: !!(h1 && h1.style.textAlign === 'center'),
      headingFont: !!(h1 && /georgia/i.test(h1.innerHTML)),
    };
  });
  expect(state).toEqual({ paragraphsItalic: true, headingCentered: true, headingFont: true });
});

test('il parser riconosce le azioni e ignora il testo normale', async ({ openTab }) => {
  const page = await openEditorWithChat(openTab);
  const r = await page.evaluate(() => {
    const f = window.__filoEditorFormat;
    return {
      fenced: f.parseFormatActions('Ecco:\n```json\n{"actions":[{"op":"format","target":"all","style":"bold","value":true}],"reply":"ok"}\n```'),
      bare: f.parseFormatActions('{"actions":[{"style":"italic","target":"headings"}],"reply":"x"}'),
      plain: f.parseFormatActions('Questa è solo una risposta testuale, senza JSON.'),
    };
  });
  expect(r.fenced && r.fenced.actions.length).toBe(1);
  expect(r.bare && r.bare.actions.length).toBe(1);
  expect(r.plain).toBeNull();
});
