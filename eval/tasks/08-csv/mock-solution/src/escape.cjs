function escapeCell(value) {
  const text=String(value);
  return /[,"\r\n]/.test(text) ? '"' + text.replace(/"/g,'""') + '"' : text;
}
module.exports = { escapeCell };
