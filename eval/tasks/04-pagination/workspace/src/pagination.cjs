function paginate(items, page, size) {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1) throw new RangeError('invalid pagination');
  return items.slice(page * size, (page + 1) * size);
}
module.exports = { paginate };
