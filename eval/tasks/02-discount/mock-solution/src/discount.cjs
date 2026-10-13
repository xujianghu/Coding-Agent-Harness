function discounted(price, percent) {
  if (percent < 0 || percent > 100) throw new RangeError('invalid discount');
  return Math.round(price * (100 - percent)) / 100;
}
module.exports = { discounted };
