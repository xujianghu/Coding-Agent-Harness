const { escapeCell } = require('./escape.cjs');
function csvRow(cells) { return cells.map(escapeCell).join(','); }
module.exports = { csvRow };
