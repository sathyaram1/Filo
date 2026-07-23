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

// Regressione (feedback "Trascinare una tab crea una scheda fantasma duplicata"):
// se un aggiornamento di stato (titolo/favicon/loading/audio → broadcast
// `tabs:updated`) arriva DOPO il mousedown ma PRIMA che il drag superi la soglia
// di 4px, la barra veniva ridisegnata, il nodo della tab trascinata restava
// orfano e — al primo movimento — veniva reinserito accanto al nodo rigenerato:
// due schede identiche affiancate, e il rilascio finiva in un indice sbagliato
// (la tab non si spostava dove rilasciata).
//
// Il test riproduce ESATTAMENTE quella sequenza: mousedown senza muovere → forza
// un broadcast reale (muta un'altra tab) → attende che arrivi → poi supera la
// soglia e trascina oltre l'ultima tab. Asserisce il SUCCESSO: nessun id
// duplicato nella barra e la tab trascinata finisce davvero in coda.
test('un aggiornamento di stato durante il drag non crea una tab fantasma', async ({ shell, openTab }) => {
  await setup(openTab, shell);

  const before = await tabOrder(shell);
  expect(before.length).toBeGreaterThanOrEqual(3);
  const movedId = before[0];
  const otherId = before[before.length - 1]; // tab di cui cambiare lo stato

  const idsAfterRelease = await shell.evaluate(async ({ movedId, otherId }) => {
    const bar = document.getElementById('tabs');
    const nodesById = (id) => bar.querySelector(`.tab[data-id="${id}"]`);
    const first = nodesById(movedId);
    const fr = first.getBoundingClientRect();
    const y = Math.round(fr.top + fr.height / 2);
    const startX = fr.left + fr.width / 2;
    const fire = (target, type, x) => target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0, clientX: Math.round(x), clientY: y,
    }));

    // 1. Arma il drag SENZA superare la soglia (drag.moved resta false).
    fire(first, 'mousedown', startX);

    // 2. Un aggiornamento di stato arriva proprio ora: muta un'altra tab, il main
    //    ribroadcasta `tabs:updated` e la shell (senza il fix) ridisegna la barra
    //    orfanizzando il nodo trascinato. Attendi che il broadcast arrivi e il
    //    render giri.
    await window.filoShell.tabs.setMuted(otherId);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 250));

    // 3. Ora supera la soglia e trascina oltre l'ultima tab, poi rilascia.
    const last = [...bar.querySelectorAll('.tab')].at(-1);
    const lr = last.getBoundingClientRect();
    fire(window, 'mousemove', startX + 10);        // supera la soglia
    fire(window, 'mousemove', lr.left + lr.width * 0.9);
    fire(window, 'mousemove', lr.right + 30);        // oltre l'ultima
    fire(window, 'mouseup', lr.right + 30);

    // Stato della barra SUBITO dopo il rilascio, prima del ridisegno post-move:
    // qui si vedrebbe il nodo fantasma duplicato, se presente.
    return [...bar.querySelectorAll('.tab')].map((t) => t.dataset.id);
  }, { movedId, otherId });

  // Nessun id duplicato nella barra: la scheda fantasma non deve esistere.
  expect(idsAfterRelease.filter((id) => id === movedId).length).toBe(1);
  expect(new Set(idsAfterRelease).size).toBe(idsAfterRelease.length);

  // E il riordino è quello giusto: la tab trascinata finisce in coda, nessuna
  // tab persa o creata.
  await expect.poll(async () => (await tabOrder(shell)).at(-1), { timeout: 8_000 })
    .toBe(movedId);
  const after = await tabOrder(shell);
  expect(after.length).toBe(before.length);
  expect([...after].sort()).toEqual([...before].sort());
});
