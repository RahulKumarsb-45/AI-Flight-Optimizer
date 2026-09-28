/**
 * Test-only DOM environment setup. Plain `node --test` has no browser
 * globals; this installs the minimal set React DOM / @testing-library/react
 * need (window, document, navigator, and a few globals React checks for)
 * using jsdom (dev-only dependency). Load via `node --import`, before any
 * test file that renders a component.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

const { window } = dom;

// Node 22 ships its own read-only `navigator` global getter, so a plain
// assignment throws — redefine the property instead.
function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
  });
}

setGlobal('window', window);
setGlobal('document', window.document);
setGlobal('navigator', window.navigator);
setGlobal('HTMLElement', window.HTMLElement);
setGlobal('Element', window.Element);
setGlobal('Node', window.Node);
setGlobal('getComputedStyle', window.getComputedStyle);
setGlobal('requestAnimationFrame', (cb) => setTimeout(cb, 0));
setGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
