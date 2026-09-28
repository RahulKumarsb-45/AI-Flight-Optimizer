class AppError extends Error {
  /**
   * @param {string} message - human readable message
   * @param {number} statusCode - HTTP status
   * @param {string} errorCode - machine readable code, e.g. 'AUTH_INVALID_CREDENTIALS'
   */
  constructor(message, statusCode = 500, errorCode = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
