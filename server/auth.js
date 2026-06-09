const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');

const router = express.Router();

// Declare memory-based rate limiter map and revoked tokens set
const failedAttempts = new Map();
const revokedTokens = new Set();

// Pre-allocate the Secret Buffer once at module load
const secretBuffer = Buffer.from(config.AUTH_SECRET || '', 'utf-8');

/**
 * Performs a timing-safe string comparison to prevent side-channel timing attacks.
 */
function verifyToken(inputToken) {
  if (!inputToken || typeof inputToken !== 'string') return false;
  
  // Limit input token length to prevent large payload memory exhaustion (DoS mitigation)
  if (inputToken.length > 256) return false;
  
  const tokenBuffer = Buffer.from(inputToken, 'utf-8');
  
  if (secretBuffer.length !== tokenBuffer.length) {
    // Run comparison on identical buffers to make timing signature uniform
    crypto.timingSafeEqual(secretBuffer, secretBuffer);
    return false;
  }
  
  return crypto.timingSafeEqual(secretBuffer, tokenBuffer);
}

// POST /auth/login
router.post('/login', (req, res) => {
  const ipAddress = req.ip;
  const entry = failedAttempts.get(ipAddress);

  if (entry) {
    const elapsed = Date.now() - entry.firstAttemptTime;
    if (elapsed < 15 * 60 * 1000) {
      if (entry.count >= 5) {
        const remainingMinutes = Math.ceil((15 * 60 * 1000 - elapsed) / 60000);
        return res.status(429).json({ error: "Too many attempts. Try again in " + remainingMinutes + " minutes" });
      }
    } else {
      failedAttempts.delete(ipAddress);
    }
  }

  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'Access token is required' });
  }

  if (verifyToken(token)) {
    failedAttempts.delete(ipAddress);
    
    const jti = uuidv4();
    const sessionId = uuidv4();
    const jwtToken = jwt.sign(
      { authenticated: true, sessionId, jti },
      config.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: config.JWT_EXPIRY }
    );
    return res.json({ token: jwtToken });
  }

  // Update failedAttempts for the IP
  const currentEntry = failedAttempts.get(ipAddress);
  if (!currentEntry) {
    failedAttempts.set(ipAddress, { count: 1, firstAttemptTime: Date.now() });
  } else {
    currentEntry.count += 1;
  }

  return res.status(401).json({ error: 'Invalid access token' });
});

module.exports = {
  authRouter: router,
  revokedTokens
};
