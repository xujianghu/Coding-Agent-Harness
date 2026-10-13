function normalizePath(value) { return value.replace('\\', '/').replace(/\/+/, '/'); }
module.exports = { normalizePath };
