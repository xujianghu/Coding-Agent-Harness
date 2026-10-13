function formatDuration(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0) throw new RangeError('invalid minutes');
  return Math.floor(minutes / 60) + ':' + String(minutes % 60).padStart(2,'0');
}
module.exports = { formatDuration };
