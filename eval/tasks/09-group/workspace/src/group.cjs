function groupBy(items,key) {
  const result={};
  for (const item of items) { const value=String(item[key]); (result[value] ||= []).push(item); }
  return result;
}
module.exports = { groupBy };
