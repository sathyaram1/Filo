import { test } from './fixtures/electron.mjs';
import { createServer } from 'node:http';

test('esplora', async ({ openTab }) => {
  const srv = createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><body><p>ok</p>'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const page = await openTab(`http://127.0.0.1:${srv.address().port}/`);
  await page.waitForFunction(() => document.readyState === 'complete');
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const salva = { dp: Object.defineProperty, gopd: Object.getOwnPropertyDescriptor, sp: Object.setPrototypeOf, ra: Reflect.apply, call: Function.prototype.call, apply: Function.prototype.apply };
    const rubate = [];
    const spia = function () { rubate.push('spia:' + (typeof this === 'function' ? this.name : String(this)) + ' ' + new Error().stack.split('\n').slice(1, 4).join(' | ')); throw new Error('rubato'); };
    try {
      Object.defineProperty(Object.prototype, 'get', { get() { rubate.push('get ' + new Error().stack.split('\n').slice(1, 4).join(' | ')); return undefined; }, configurable: true });
      Object.defineProperty(Object.prototype, 'value', { get() { rubate.push('value ' + new Error().stack.split('\n').slice(1, 4).join(' | ')); return undefined; }, configurable: true });
      Object.defineProperty = spia; Object.getOwnPropertyDescriptor = spia; Object.setPrototypeOf = spia; Reflect.apply = spia;
      Function.prototype.call = spia; Function.prototype.apply = spia;
      const f = document.createElement('iframe');
      document.body.appendChild(f);
      f.contentWindow.HTMLCanvasElement.prototype.toDataURL;
    } catch (e) { rubate.push('ERR ' + e.message); } finally {
      Function.prototype.call = salva.call; Function.prototype.apply = salva.apply;
      Object.defineProperty = salva.dp; Object.getOwnPropertyDescriptor = salva.gopd; Object.setPrototypeOf = salva.sp; Reflect.apply = salva.ra;
      delete Object.prototype.get; delete Object.prototype.value;
    }
    return rubate;
  });
  console.log('RUBATE\n' + r.join('\n'));
  srv.close();
});
