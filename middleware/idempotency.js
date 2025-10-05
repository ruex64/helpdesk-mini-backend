const idempotencyStore = new Map();

// Clean up old entries every 24 hours
setInterval(() => {
  const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
  for (const [key, value] of idempotencyStore.entries()) {
    if (value.timestamp < oneDayAgo) {
      idempotencyStore.delete(key);
    }
  }
}, 60 * 60 * 1000); // Run every hour

export const idempotencyMiddleware = (req, res, next) => {
  // Only apply to POST requests
  if (req.method !== 'POST') {
    return next();
  }

  const idempotencyKey = req.headers['idempotency-key'];
  
  if (!idempotencyKey) {
    return next();
  }

  // Create a unique key combining user ID and idempotency key
  const userKey = req.user ? req.user._id.toString() : 'anonymous';
  const storeKey = `${userKey}:${idempotencyKey}`;

  // Check if we've seen this request before
  if (idempotencyStore.has(storeKey)) {
    const cached = idempotencyStore.get(storeKey);
    return res.status(cached.statusCode).json(cached.body);
  }

  // Store the original res.json and res.status methods
  const originalJson = res.json;
  const originalStatus = res.status;
  let statusCode = 200;

  // Override res.status to capture the status code
  res.status = function(code) {
    statusCode = code;
    return originalStatus.call(this, code);
  };

  // Override res.json to store the response
  res.json = function(body) {
    // Store the response for future identical requests
    idempotencyStore.set(storeKey, {
      statusCode,
      body,
      timestamp: Date.now()
    });
    
    return originalJson.call(this, body);
  };

  next();
};