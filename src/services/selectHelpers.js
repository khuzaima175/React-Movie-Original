/**
 * Pure keyboard-navigation helpers for the custom editorial <Select> primitive.
 */

export function getNextSelectIndex(options, currentIndex, key) {
  if (!Array.isArray(options) || options.length === 0) return -1;

  const isEnabled = (idx) => idx >= 0 && idx < options.length && !options[idx]?.disabled;
  const enabledIndices = [];
  for (let i = 0; i < options.length; i += 1) {
    if (isEnabled(i)) enabledIndices.push(i);
  }
  if (enabledIndices.length === 0) return -1;

  if (key === "Home") {
    return enabledIndices[0];
  }
  if (key === "End") {
    return enabledIndices[enabledIndices.length - 1];
  }

  if (key === "ArrowDown") {
    if (currentIndex < 0 || currentIndex >= options.length) {
      return enabledIndices[0];
    }
    const len = options.length;
    for (let step = 1; step <= len; step += 1) {
      const candidate = (currentIndex + step) % len;
      if (isEnabled(candidate)) return candidate;
    }
    return enabledIndices[0];
  }

  if (key === "ArrowUp") {
    if (currentIndex < 0 || currentIndex >= options.length) {
      return enabledIndices[enabledIndices.length - 1];
    }
    const len = options.length;
    for (let step = 1; step <= len; step += 1) {
      const candidate = (currentIndex - step + len) % len;
      if (isEnabled(candidate)) return candidate;
    }
    return enabledIndices[enabledIndices.length - 1];
  }

  return isEnabled(currentIndex) ? currentIndex : enabledIndices[0];
}
