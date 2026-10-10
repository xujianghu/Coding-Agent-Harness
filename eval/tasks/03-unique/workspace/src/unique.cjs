function unique(values) {
  const seen = new Set();
  return values.filter(value => {
    const key = String(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
module.exports = { unique };
