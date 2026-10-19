// Lo strato del menu del tasto destro sopra la scheda (#1053): tiene il punto dove si apre il menu e dice al main
// quando l'utente tocca fuori. Il menu ci entra al passo 3; da qui non si legge né si tocca la pagina sotto.
(() => {
  'use strict';
  const api = window.strato;
  const ancora = document.getElementById('ancora');
  if (!api || !ancora) return;
  let seq = 0;

  api.onMostra((d) => {
    if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return;
    seq = Number(d.seq) || 0;
    ancora.style.left = `${d.x}px`;
    ancora.style.top = `${d.y}px`;
    ancora.hidden = false;
  });

  api.onVia(() => {
    seq = 0;
    ancora.hidden = true;
  });

  const fuori = (e) => {
    if (!seq || ancora.contains(e.target)) return;
    e.preventDefault();
    api.fuori(seq);
  };
  document.addEventListener('pointerdown', fuori, true);
  document.addEventListener('wheel', fuori, { capture: true, passive: false });
  document.addEventListener('contextmenu', (e) => e.preventDefault(), true);
})();
