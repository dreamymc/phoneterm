const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('./config');

const router = express.Router();

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
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'Access token is required' });
  }

  if (verifyToken(token)) {
    const jwtToken = jwt.sign(
      { authenticated: true },
      config.JWT_SECRET,
      { expiresIn: config.JWT_EXPIRY }
    );
    return res.json({ token: jwtToken });
  }

  return res.status(401).json({ error: 'Invalid access token' });
});

module.exports = {
  authRouter: router
};
