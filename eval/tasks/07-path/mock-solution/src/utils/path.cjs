function normalizePath(value) { return value.replace(/\\/g, '/').replace(/\/+/g, '/'); }
module.exports = { normalizePath };
