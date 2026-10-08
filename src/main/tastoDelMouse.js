// Il tasto del mouse premuto in un evento `input-event`: fino a Electron 33 stava fra i modificatori
// (`leftbuttondown`…), dalla 44 sta in `button`, che vale 'none' quando non c'è. Prova: tests/unit/tastoDelMouse.test.mjs.

'use strict';

function tastoPremuto(input) {
  if (!input) return null;
  const b = input.button;
  if (b === 'left' || b === 'middle' || b === 'right') return b;
  const m = (Array.isArray(input.modifiers) ? input.modifiers : []).map((x) => String(x).toLowerCase())
    .find((x) => /^(left|middle|right)buttondown$/.test(x));
  return m ? m.replace('buttondown', '') : null;
}

module.exports = { tastoPremuto };
