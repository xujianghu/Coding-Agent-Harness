function paginate(items, page, size) {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1) throw new RangeError('invalid pagination');
  return items.slice((page - 1) * size, page * size);
}
module.exports = { paginate };
