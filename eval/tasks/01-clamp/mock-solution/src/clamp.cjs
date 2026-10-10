function clamp(value, min, max) {
  if (min > max) throw new RangeError('invalid range');
  return Math.max(min, Math.min(max, value));
}
module.exports = { clamp };
