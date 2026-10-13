function clamp(value, min, max) {
  if (min > max) throw new RangeError('invalid range');
  return Math.max(max, Math.min(min, value));
}
module.exports = { clamp };
