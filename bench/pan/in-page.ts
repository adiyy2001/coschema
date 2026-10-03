export const IN_PAGE_PAN_SOURCE = `
window.__measurePan = (options) =>
  new Promise((resolve) => {
    const surface = document.querySelector('svg.surface');
    const bounds = surface.getBoundingClientRect();
    const frames = [];
    const longTasks = [];
    let observer;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push(entry.duration);
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch (error) {
      observer = undefined;
    }
    const start = performance.now();
    let last = start;
    let tick = 0;
    const frame = (now) => {
      if (tick > options.warmupFrames) frames.push(now - last);
      last = now;
      const direction = Math.floor(tick / options.legFrames) % 2 === 0 ? 1 : -1;
      surface.dispatchEvent(
        new WheelEvent('wheel', {
          deltaX: direction * options.stepX,
          deltaY: direction * options.stepY,
          deltaMode: 0,
          clientX: bounds.left + bounds.width / 2,
          clientY: bounds.top + bounds.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      );
      tick += 1;
      if (now - start < options.durationMs) {
        requestAnimationFrame(frame);
        return;
      }
      if (observer) observer.disconnect();
      resolve({ frames, longTasks });
    };
    requestAnimationFrame(frame);
  });
`;
