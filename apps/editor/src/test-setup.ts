for (const prototype of [Element.prototype]) {
  Object.defineProperty(prototype, 'setPointerCapture', {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(prototype, 'releasePointerCapture', {
    configurable: true,
    value: () => undefined,
  });
}
