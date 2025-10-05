export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Default error
  let error = {
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong'
  };

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const field = Object.keys(err.errors)[0];
    error = {
      code: 'VALIDATION_ERROR',
      field: field,
      message: err.errors[field].message
    };
    return res.status(400).json({ error });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    error = {
      code: 'DUPLICATE_FIELD',
      field: field,
      message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`
    };
    return res.status(400).json({ error });
  }

  // Mongoose cast error (invalid ObjectId)
  if (err.name === 'CastError') {
    error = {
      code: 'INVALID_ID',
      field: err.path,
      message: 'Invalid ID format'
    };
    return res.status(400).json({ error });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = {
      code: 'INVALID_TOKEN',
      message: 'Invalid token'
    };
    return res.status(401).json({ error });
  }

  if (err.name === 'TokenExpiredError') {
    error = {
      code: 'TOKEN_EXPIRED',
      message: 'Token has expired'
    };
    return res.status(401).json({ error });
  }

  // Custom application errors
  if (err.isOperational) {
    return res.status(err.statusCode || 400).json({ error: err });
  }

  // Development vs Production error response
  if (process.env.NODE_ENV === 'development') {
    error.stack = err.stack;
  }

  res.status(500).json({ error });
};