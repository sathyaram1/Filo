// Verifica #2279 giro 1: la scorciatoia Markdown su un titolo svuotato, e l'Annulla dopo «# ».

import { test, expect } from '../../fixtures/electron.mjs';

async function foglioNuovo(openTab) {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');
  return page;
}
const blocchi = (page) => page.evaluate(() => Array.from(document.getElementById('doc').children)
  .map((b) => `${b.tagName}:${b.textContent.replace(/ /g, ' ')}`));
const salvato = (page) => page.evaluate(() => {
  const col = JSON.parse(localStorage.getItem('filo.editor.collection'));
  const f = col.files.find((x) => x.id === col.activeId);
  return f.content.content.map((n) => `${n.type}${n.attrs && n.attrs.level ? n.attrs.level : ''}:${(n.content || []).map((t) => t.text || '').join('')}`);
});

test('r1 svuotato un titolo con del testo sotto, «# Nuovo» cambia quel titolo: niente titolo vuoto in più, e il testo sotto resta suo', async ({ openTab }) => {
  const page = await foglioNuovo(openTab);
  await page.keyboard.type('## Vecchio');
  await page.keyboard.press('Enter');
  await page.keyboard.type('corpo');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('End');
  for (let i = 0; i < 'Vecchio'.length; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('# Nuovo');
  await expect.poll(() => blocchi(page)).toEqual(['H1:Nuovo', expect.stringMatching(/^(P|DIV):corpo$/)]);
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => salvato(page)).toEqual(['heading1:Nuovo', 'paragraph:corpo']);
});

test('r1 in un titolo svuotato in fondo al foglio, «# » non lascia sotto un titolo vuoto che si salva', async ({ openTab }) => {
  const page = await foglioNuovo(openTab);
  await page.keyboard.type('testo');
  await page.keyboard.press('Enter');
  await page.keyboard.type('## Capitolo');
  for (let i = 0; i < 'Capitolo'.length; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('# Uno');
  await expect.poll(() => blocchi(page)).toEqual([expect.stringMatching(/^(P|DIV):testo$/), 'H1:Uno']);
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => salvato(page)).toEqual(['paragraph:testo', 'heading1:Uno']);
});

test('r2 un solo Annulla dopo «# » riporta il «# » scritto, non una riga vuota', async ({ openTab }) => {
  const page = await foglioNuovo(openTab);
  await page.keyboard.type('# ');
  await expect.poll(() => blocchi(page)).toEqual(['H1:']);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => blocchi(page)).toEqual(['P:# ']);
});
