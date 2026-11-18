import test from "node:test";
import assert from "node:assert/strict";
import { computeHorizontalWheelDelta, attachHorizontalWheelScroll } from "../src/services/scrollHelpers.js";

test("computeHorizontalWheelDelta converts vertical mouse wheel into horizontal delta within bounds", () => {
  // Middle of strip: scrolls right on positive deltaY and left on negative deltaY
  assert.equal(
    computeHorizontalWheelDelta({
      deltaX: 0,
      deltaY: 100,
      deltaMode: 0,
      scrollLeft: 120,
      scrollWidth: 1600,
      clientWidth: 800
    }),
    100
  );

  assert.equal(
    computeHorizontalWheelDelta({
      deltaX: 0,
      deltaY: -100,
      deltaMode: 0,
      scrollLeft: 120,
      scrollWidth: 1600,
      clientWidth: 800
    }),
    -100
  );
});

test("computeHorizontalWheelDelta scales line (deltaMode=1) and page (deltaMode=2) units", () => {
  assert.equal(
    computeHorizontalWheelDelta({
      deltaX: 0,
      deltaY: 3,
      deltaMode: 1,
      scrollLeft: 0,
      scrollWidth: 1600,
      clientWidth: 800
    }),
    120
  );

  assert.equal(
    computeHorizontalWheelDelta({
      deltaX: 0,
      deltaY: 1,
      deltaMode: 2,
      scrollLeft: 0,
      scrollWidth: 1600,
      clientWidth: 800,
      clientHeight: 350
    }),
    350
  );
});

test("computeHorizontalWheelDelta yields control at scroll edges, when non-overflowing, or during native trackpad deltaX", () => {
  // No horizontal overflow
  assert.equal(
    computeHorizontalWheelDelta({
      deltaX: 0,
      deltaY: 120,
      deltaMode: 0,
      scrollLeft: 0,
      scrollWidth: 800,
      clientWidth: 800
    }),
    null
  );

  // At left edge (including small <=4px subpixel/snap tolerance) scrolling left -> let page scroll up
  assert.equal(
    computeHorizontalWheelDelta({
      deltaX: 0,
      deltaY: -120,
      deltaMode: 0,
      scrollLeft: 2,
      scrollWidth: 1600,
      clientWidth: 800
    }),
    null
  );

  // At right edge scrolling right -> let page scroll down
  assert.equal(
    computeHorizontalWheelDelta({
      deltaX: 0,
      deltaY: 120,
      deltaMode: 0,
      scrollLeft: 798,
      scrollWidth: 1600,
      clientWidth: 800
    }),
    null
  );

  // Trackpad already sending horizontal deltaX -> let native browser handle it
  assert.equal(
    computeHorizontalWheelDelta({
      deltaX: 80,
      deltaY: 15,
      deltaMode: 0,
      scrollLeft: 100,
      scrollWidth: 1600,
      clientWidth: 800
    }),
    null
  );
});

test("attachHorizontalWheelScroll binds passive:false wheel handler, smoothly glides via rAF, suspends scroll-snap during glide, and cleans up", () => {
  const listeners = new Map();
  let prevented = 0;
  let rafQueue = [];
  let nextId = 1;
  const canceled = [];

  const mockEl = {
    scrollLeft: 0,
    scrollWidth: 1500,
    clientWidth: 700,
    clientHeight: 320,
    style: { scrollSnapType: "" },
    addEventListener(type, fn, opts) {
      listeners.set(type, { fn, opts });
    },
    removeEventListener(type, fn) {
      if (listeners.get(type)?.fn === fn) listeners.delete(type);
    }
  };

  const cleanup = attachHorizontalWheelScroll(mockEl, {
    multiplier: 1,
    speed: 12,
    reducedMotion: false,
    requestAnimationFrameFn: (cb) => {
      const id = nextId++;
      rafQueue.push({ id, cb });
      return id;
    },
    cancelAnimationFrameFn: (id) => {
      canceled.push(id);
      rafQueue = rafQueue.filter((item) => item.id !== id);
    }
  });
  assert.equal(typeof cleanup, "function");
  assert.equal(listeners.get("wheel")?.opts?.passive, false);

  listeners.get("wheel").fn({
    deltaX: 0,
    deltaY: 120,
    deltaMode: 0,
    preventDefault() {
      prevented += 1;
    }
  });
  assert.equal(prevented, 1);
  // Does not teleport in 1 synchronous jump; suspends snap and queues rAF
  assert.equal(mockEl.scrollLeft, 0);
  assert.equal(mockEl.style.scrollSnapType, "none");
  assert.equal(rafQueue.length, 1);

  // Step through rAF timestamps smoothly toward target 120
  let ts = 1000;
  let steps = 0;
  while (rafQueue.length > 0 && steps < 60) {
    const next = rafQueue.shift();
    ts += 16;
    next.cb(ts);
    steps += 1;
  }
  assert.ok(steps > 2, `Expected multi-frame smooth glide, got ${steps} step(s)`);
  assert.equal(Math.round(mockEl.scrollLeft), 120);
  assert.equal(mockEl.style.scrollSnapType, "");

  // Pointerdown cancels an in-flight glide cleanly
  listeners.get("wheel").fn({
    deltaX: 0,
    deltaY: 120,
    deltaMode: 0,
    preventDefault() {
      prevented += 1;
    }
  });
  assert.equal(rafQueue.length, 1);
  listeners.get("pointerdown")?.fn?.();
  assert.equal(rafQueue.length, 0);
  assert.ok(canceled.length >= 1);
  assert.equal(mockEl.style.scrollSnapType, "");

  // At left edge scrolling up should not preventDefault
  mockEl.scrollLeft = 0;
  listeners.get("wheel").fn({
    deltaX: 0,
    deltaY: -120,
    deltaMode: 0,
    preventDefault() {
      prevented += 1;
    }
  });
  assert.equal(mockEl.scrollLeft, 0);
  assert.equal(prevented, 2);

  cleanup();
  assert.equal(listeners.has("wheel"), false);
  assert.equal(listeners.has("pointerdown"), false);
});

test("attachHorizontalWheelScroll respects reducedMotion without queueing animation frames", () => {
  const listeners = new Map();
  let rafCalled = 0;
  const mockEl = {
    scrollLeft: 0,
    scrollWidth: 1500,
    clientWidth: 700,
    clientHeight: 320,
    style: {},
    addEventListener(type, fn, opts) {
      listeners.set(type, { fn, opts });
    },
    removeEventListener(type, fn) {
      if (listeners.get(type)?.fn === fn) listeners.delete(type);
    }
  };

  const cleanup = attachHorizontalWheelScroll(mockEl, {
    multiplier: 1,
    reducedMotion: true,
    requestAnimationFrameFn: () => {
      rafCalled += 1;
      return 1;
    }
  });

  listeners.get("wheel").fn({
    deltaX: 0,
    deltaY: 120,
    deltaMode: 0,
    preventDefault() {}
  });
  assert.equal(mockEl.scrollLeft, 120);
  assert.equal(rafCalled, 0);
  cleanup();
});
