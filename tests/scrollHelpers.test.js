import test from "node:test";
import assert from "node:assert/strict";
import { computeHorizontalWheelDelta, attachHorizontalWheelScroll } from "../src/services/scrollHelpers.js";

test("computeHorizontalWheelDelta does not hijack plain vertical scroll unless row is engaged or Shift is held", () => {
  // Plain scroll without engaged or shiftKey -> null (vertical page scroll preserved!)
  assert.equal(
    computeHorizontalWheelDelta({
      deltaX: 0,
      deltaY: 120,
      deltaMode: 0,
      scrollLeft: 120,
      scrollWidth: 1600,
      clientWidth: 800
    }),
    null
  );

  // Engaged row -> converts vertical mouse wheel into horizontal delta
  assert.equal(
    computeHorizontalWheelDelta({
      deltaX: 0,
      deltaY: 100,
      deltaMode: 0,
      scrollLeft: 120,
      scrollWidth: 1600,
      clientWidth: 800,
      engaged: true
    }),
    100
  );

  // Shift+Wheel -> converts immediately without clicking
  assert.equal(
    computeHorizontalWheelDelta({
      deltaX: 0,
      deltaY: -100,
      deltaMode: 0,
      scrollLeft: 120,
      scrollWidth: 1600,
      clientWidth: 800,
      shiftKey: true
    }),
    -100
  );
});

test("computeHorizontalWheelDelta scales line (deltaMode=1) and page (deltaMode=2) units when engaged", () => {
  assert.equal(
    computeHorizontalWheelDelta({
      deltaX: 0,
      deltaY: 3,
      deltaMode: 1,
      scrollLeft: 0,
      scrollWidth: 1600,
      clientWidth: 800,
      engaged: true
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
      clientHeight: 350,
      engaged: true
    }),
    350
  );
});

test("computeHorizontalWheelDelta yields control at scroll edges, when non-overflowing, or during native trackpad deltaX", () => {
  assert.equal(
    computeHorizontalWheelDelta({
      deltaX: 0,
      deltaY: 120,
      deltaMode: 0,
      scrollLeft: 0,
      scrollWidth: 800,
      clientWidth: 800,
      engaged: true
    }),
    null
  );

  assert.equal(
    computeHorizontalWheelDelta({
      deltaX: 0,
      deltaY: -120,
      deltaMode: 0,
      scrollLeft: 2,
      scrollWidth: 1600,
      clientWidth: 800,
      engaged: true
    }),
    null
  );

  assert.equal(
    computeHorizontalWheelDelta({
      deltaX: 0,
      deltaY: 120,
      deltaMode: 0,
      scrollLeft: 798,
      scrollWidth: 1600,
      clientWidth: 800,
      engaged: true
    }),
    null
  );

  assert.equal(
    computeHorizontalWheelDelta({
      deltaX: 80,
      deltaY: 15,
      deltaMode: 0,
      scrollLeft: 100,
      scrollWidth: 1600,
      clientWidth: 800,
      engaged: true
    }),
    null
  );
});

test("attachHorizontalWheelScroll ignores plain wheel while disengaged, glides smoothly when engaged or Shift+Wheel, and cleans up", () => {
  const listeners = new Map();
  let prevented = 0;
  let rafQueue = [];
  let nextId = 1;
  let active = false;
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
    isEngagedFn: () => active,
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
  assert.equal(listeners.get("wheel")?.opts?.passive, false);

  // 1. Disengaged plain wheel -> NOT prevented, vertical page scroll intact
  listeners.get("wheel").fn({
    deltaX: 0,
    deltaY: 120,
    deltaMode: 0,
    shiftKey: false,
    preventDefault() {
      prevented += 1;
    }
  });
  assert.equal(prevented, 0);
  assert.equal(rafQueue.length, 0);

  // 2. Engaged wheel -> intercepts, suspends snap, glides via rAF
  active = true;
  listeners.get("wheel").fn({
    deltaX: 0,
    deltaY: 120,
    deltaMode: 0,
    shiftKey: false,
    preventDefault() {
      prevented += 1;
    }
  });
  assert.equal(prevented, 1);
  assert.equal(mockEl.style.scrollSnapType, "none");
  assert.equal(rafQueue.length, 1);

  let ts = 1000;
  let steps = 0;
  while (rafQueue.length > 0 && steps < 60) {
    const next = rafQueue.shift();
    ts += 16;
    next.cb(ts);
    steps += 1;
  }
  assert.ok(steps > 2);
  assert.equal(Math.round(mockEl.scrollLeft), 120);
  assert.equal(mockEl.style.scrollSnapType, "");

  // 3. Disengaged + Shift+Wheel -> intercepts immediately
  active = false;
  listeners.get("wheel").fn({
    deltaX: 0,
    deltaY: 120,
    deltaMode: 0,
    shiftKey: true,
    preventDefault() {
      prevented += 1;
    }
  });
  assert.equal(prevented, 2);
  assert.equal(rafQueue.length, 1);

  // Pointerdown cancels active glide
  listeners.get("pointerdown")?.fn?.();
  assert.equal(rafQueue.length, 0);
  assert.ok(canceled.length >= 1);
  assert.equal(mockEl.style.scrollSnapType, "");

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
    isEngagedFn: () => true,
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
