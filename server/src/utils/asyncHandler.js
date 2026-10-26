// Wrap an async route handler so rejected promises flow to Express's error
// handler instead of crashing the request. Express 5 handles async natively,
// but this keeps controllers explicit and consistent.
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
