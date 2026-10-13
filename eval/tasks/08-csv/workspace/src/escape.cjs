function escapeCell(value) {
  const text=String(value);
  return text.includes(',') ? '"' + text + '"' : text;
}
module.exports = { escapeCell };
