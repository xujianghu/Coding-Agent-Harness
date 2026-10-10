function discounted(price, percent) {
  if (percent < 0 || percent > 100) throw new RangeError('invalid discount');
  return Math.round(price * percent / 100 * 100) / 100;
}
module.exports = { discounted };
