async function retry(fn,maxAttempts) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('invalid attempts');
  for (let attempt=1;attempt<=maxAttempts;attempt++) { return await fn(attempt); }
}
module.exports = { retry };
