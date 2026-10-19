// La guardia anti-fingerprint non lascia segni sulla pagina: è accesa se un riempimento uniforme, riletto, torna con
// qualche pixel cambiato. Da passare intera a page.evaluate o page.waitForFunction.
export function guardiaAccesa() {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const x = c.getContext('2d');
  x.fillStyle = 'rgb(128,128,128)';
  x.fillRect(0, 0, 16, 16);
  const d = x.getImageData(0, 0, 16, 16).data;
  for (let i = 0; i < d.length; i += 4) if (d[i] !== 128 || d[i + 1] !== 128 || d[i + 2] !== 128) return true;
  return false;
}
