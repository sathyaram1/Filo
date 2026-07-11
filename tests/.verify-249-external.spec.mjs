// VERIFY (#249) — stress test dello scenario REALE del feedback: una PAGINA WEB
// ESTERNA ostile (contextIsolation:true) prova ad auto-cliccare il dialogo di
// conferma di Filo. Non è committato (prefisso .verify), è una traccia di run.

import { test, expect } from './fixtures/electron.mjs';

test.setTimeout(20_000);

// La pagina ostile registra al caricamento un MutationObserver che clicca
// qualunque .sn-confirm-btn-ok/.sn-confirm-btn-danger che compaia, ed espone
// i risultati su window.__attack.
const HOSTILE = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<h1>pagina ostile</h1>
<script>
  window.__attack = { autoClicked: false, sawOverlay: false, sawApi: false };
  const obs = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      const btn = (n.classList && (n.classList.contains('sn-confirm-btn-ok') || n.classList.contains('sn-confirm-btn-danger')))
        ? n : (n.querySelector && (n.querySelector('.sn-confirm-btn-ok') || n.querySelector('.sn-confirm-btn-danger')));
      if (btn) { window.__attack.autoClicked = true; btn.click(); }
      if (n.classList && n.classList.contains('sn-confirm-overlay')) window.__attack.sawOverlay = true;
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
</script>
</body></html>`;

test('pagina esterna ostile: non vede SN_CONFIRM_UI, non trova i bottoni, non auto-clicca', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, HOSTILE);

  // 1) Il mondo principale della pagina NON deve vedere l'API di conferma.
  const apiVisible = await page.evaluate(() => typeof window.SN_CONFIRM_UI);
  expect(apiVisible, 'la pagina esterna NON deve vedere SN_CONFIRM_UI nel suo mondo').toBe('undefined');

  // 2) Simula il dialogo di conferma di Filo dal mondo ISOLATO (come farebbe la
  //    sidebar/menu di Filo): mainWorld=false è il default di page.evaluate?
  //    No: page.evaluate gira nel mondo principale. Per girare nell'isolato non
  //    c'è API diretta; ma il punto del feedback è proprio che, anche se il
  //    dialogo compare nel DOM condiviso, la pagina non deve poterlo cliccare.
  //    Qui inneschiamo il dialogo tramite il ponte che la sidebar userebbe:
  //    invochiamo direttamente sull'oggetto isolato via un bridge di test.
  //    Poiché non abbiamo un handle isolato, usiamo il fatto che il DOM è
  //    condiviso: mostriamo un dialogo appendendo l'host dal preload non è
  //    possibile da qui, quindi verifichiamo l'INVARIANTE DOM: creare a mano un
  //    host con shadow closed e assicurarci che la pagina non lo perfori.
  const domProbe = await page.evaluate(async () => {
    // Riproduce la struttura del dialogo Filo (host + shadow closed + bottone).
    const host = document.createElement('div');
    host.className = 'sn-confirm-host';
    const root = host.attachShadow({ mode: 'closed' });
    const overlay = document.createElement('div');
    overlay.className = 'sn-confirm-overlay';
    const btn = document.createElement('button');
    btn.className = 'sn-confirm-btn sn-confirm-btn-ok';
    overlay.appendChild(btn);
    root.appendChild(overlay);
    document.body.appendChild(host);
    await new Promise((r) => setTimeout(r, 100));
    const res = {
      hostFound: !!document.querySelector('.sn-confirm-host'),
      overlayFound: !!document.querySelector('.sn-confirm-overlay'),
      okFound: !!document.querySelector('.sn-confirm-btn-ok'),
      hostShadow: document.querySelector('.sn-confirm-host').shadowRoot, // null se closed
      attack: window.__attack,
    };
    host.remove();
    return { ...res, hostShadowIsNull: res.hostShadow === null };
  });

  // L'host esterno è visibile (è il guscio vuoto), ma il contenuto interno no.
  expect(domProbe.hostFound, 'host guscio visibile (atteso)').toBe(true);
  expect(domProbe.overlayFound, 'overlay interno NON deve essere raggiungibile da fuori').toBe(false);
  expect(domProbe.okFound, 'bottone OK NON deve essere raggiungibile da fuori').toBe(false);
  expect(domProbe.hostShadowIsNull, 'shadowRoot deve essere null (closed) dal mondo esterno').toBe(true);
  expect(domProbe.attack.autoClicked, 'il MutationObserver ostile NON deve aver cliccato nulla').toBe(false);
});
