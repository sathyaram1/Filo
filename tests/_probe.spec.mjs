import { test, expect } from './fixtures/electron.mjs';

test('probe: editor with a SAVED doc (reload path)', async ({ app, shell, openTab }) => {
  const errors = [];
  const ed1 = await openTab('filo://editor/editor.html');
  ed1.on('pageerror', (e) => errors.push('[ed1 pageerror] ' + e.message));
  ed1.on('console', (m) => { if (m.type() === 'error') errors.push('[ed1 console] ' + m.text()); });
  await ed1.waitForSelector('#doc');

  // scrivi e forza il salvataggio su localStorage
  await ed1.click('#doc');
  await ed1.keyboard.type('Primo titolo');
  await ed1.keyboard.press('Enter');
  await ed1.keyboard.type('Un commento di prova nel testo.');
  // aggiungi un commento (per popolare doc.comments con anchor)
  await ed1.keyboard.down('Control'); await ed1.keyboard.press('s'); await ed1.keyboard.up('Control');
  await ed1.waitForTimeout(400);
  const saved = await ed1.evaluate(() => localStorage.getItem('filo.editor.doc'));
  console.log('SAVED DOC PRESENT:', !!saved, saved ? saved.slice(0, 200) : '');

  // RICARICA l'editor → esercita loadDoc() con doc salvato
  await ed1.reload();
  await ed1.waitForTimeout(800);
  const state = await ed1.evaluate(() => ({
    hasDoc: !!document.getElementById('doc'),
    gridChildren: document.getElementById('grid')?.children.length,
    docText: document.getElementById('doc')?.innerText?.slice(0, 80),
  })).catch((e) => ({ evalError: e.message }));
  console.log('AFTER RELOAD STATE:', JSON.stringify(state));
  console.log('RELOAD ERRORS:', JSON.stringify(errors, null, 2));
});
