async function retry(fn,maxAttempts) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('invalid attempts');
  let lastError;
  for (let attempt=1;attempt<=maxAttempts;attempt++) { try { return await fn(attempt); } catch(error) { lastError=error; } }
  throw lastError;
}
module.exports = { retry };
