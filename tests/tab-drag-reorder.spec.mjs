// Riordino delle tab via drag & drop nella barra (feedback "Abilita
// trascinamento delle tab").
//
// Il test ASSERISCE il successo della feature: dopo aver trascinato la prima
// tab oltre l'ultima, l'ordine reale nello snapshot del TabManager deve essere
// cambiato (la tab trascinata finisce in coda). Senza il fix non esiste alcun
// modo di spostare una tab, quindi l'ordine resterebbe invariato e l'assert
// diventerebbe rosso.

import { test, expect } from './fixtures/electron.mjs';

// Apre alcune tab note così abbiamo almeno 3 schede e un ordine deterministico.
async function setup(openTab, shell) {
  await openTab('filo://options/options.html');
  await openTab('filo://history/history.html');
  await openTab('filo://archive/archive.html');
  // Aspetta che la barra abbia almeno 3 tab disegnate.
  await expect.poll(async () => shell.locator('.tab').count(), { timeout: 8_000 })
    .toBeGreaterThanOrEqual(3);
}

// Ordine corrente delle tab (array di id, nell'ordine della barra).
async function tabOrder(shell) {
  return shell.evaluate(async () => {
    const snap = await window.filoShell.tabs.snapshot();
    return snap.tabs.map((t) => t.id);
  });
}

test('trascinare la prima tab in fondo ne cambia l\'ordine', async ({ shell, openTab }) => {
  await setup(openTab, shell);

  const before = await tabOrder(shell);
  expect(before.length).toBeGreaterThanOrEqual(3);
  const movedId = before[0];

  // Simula un drag a pointer: mousedown sulla prima tab, alcuni mousemove
  // (window) oltre la soglia e fino a superare il centro dell'ultima, poi
  // mouseup. Gli handler del drag ascoltano mousemove/mouseup su window.
  await shell.evaluate(() => {
    const tabs = [...document.querySelectorAll('.tab')];
    const first = tabs[0];
    const last = tabs[tabs.length - 1];
    const fr = first.getBoundingClientRect();
    const lr = last.getBoundingClientRect();
    const y = Math.round(fr.top + fr.height / 2);
    const fire = (target, type, x) => target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0, clientX: Math.round(x), clientY: y,
    }));
    const startX = fr.left + fr.width / 2;
    fire(first, 'mousedown', startX);
    fire(window, 'mousemove', startX + 10);        // supera la soglia
    fire(window, 'mousemove', lr.left + lr.width * 0.9);
    fire(window, 'mousemove', lr.right + 30);        // oltre l'ultima
    fire(window, 'mouseup', lr.right + 30);
  });

  // L'ordine reale deve essere cambiato: la tab trascinata ora è l'ultima.
  await expect.poll(async () => (await tabOrder(shell)).at(-1), { timeout: 8_000 })
    .toBe(movedId);
  const after = await tabOrder(shell);
  expect(after.length).toBe(before.length);          // nessuna tab persa/creata
  expect(after[0]).not.toBe(movedId);                // non è più la prima
  expect([...after].sort()).toEqual([...before].sort()); // stesso insieme di id
});

test('un click semplice (senza trascinare) non riordina le tab', async ({ shell, openTab }) => {
  await setup(openTab, shell);
  const before = await tabOrder(shell);

  // mousedown + mouseup senza movimento oltre la soglia: deve restare un click.
  await shell.evaluate(() => {
    const first = document.querySelectorAll('.tab')[0];
    const r = first.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const fire = (target, type) => target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y,
    }));
    fire(first, 'mousedown');
    fire(window, 'mouseup');
    first.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
  });

  // Ordine invariato.
  await expect.poll(async () => tabOrder(shell), { timeout: 4_000 }).toEqual(before);
});
