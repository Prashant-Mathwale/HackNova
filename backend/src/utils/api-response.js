export function successResponse(res, data, message = 'Request completed', statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data });
}
