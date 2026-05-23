import * as d from './driver.mjs';
const { app, shell } = await d.launchFilo();
try {
  await d.navigate(app, shell, 'https://www.youtube.com');
  await d.sleep(6000);
  const view = await d.activeView(app, shell);
  if (view) {
    const result = await view.evaluate(() => {
      let insideHandler = {};
      const testHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        SN_MENU.open({ x: e.clientX, y: e.clientY, items: [
          { type: 'item', label: 'Test item', onClick: () => {} }
        ]});
        // Check IMMEDIATELY inside handler
        const m = document.querySelector('.sn-menu');
        insideHandler = {
          menuInDOM: !!m,
          menuParent: m?.parentElement?.tagName,
          menuDisplay: m ? getComputedStyle(m).display : null,
          menuZIndex: m ? getComputedStyle(m).zIndex : null,
          menuPos: m ? m.style.cssText : null,
        };
      };
      window.addEventListener('contextmenu', testHandler, { capture: true });
      const target = document.querySelector('ytd-app') || document.body;
      target.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, view: window,
        clientX: 300, clientY: 300, button: 2,
      }));
      window.removeEventListener('contextmenu', testHandler, { capture: true });

      return new Promise(resolve => {
        setTimeout(() => {
          const m2 = document.querySelector('.sn-menu');
          resolve({
            insideHandler,
            menuAfter500ms: !!m2,
            // Check if YouTube removed it
            htmlChildren: document.documentElement.children.length,
          });
        }, 500);
      });
    });
    console.log('YT v6:', JSON.stringify(result, null, 2));
  }
} finally {
  await d.closeFilo(app);
}
