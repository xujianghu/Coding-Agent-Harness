const { toCents } = require('./money.cjs');
function cartTotal(lines) { return lines.reduce((sum, line) => sum + toCents(line.price) * line.quantity, 0) / 100; }
module.exports = { cartTotal };
