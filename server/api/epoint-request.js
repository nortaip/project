const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// Store this securely in environment variables
const EPOINT_PRIVATE_KEY = 'your_private_key_here';

router.post('/api/epoint-request', async (req, res) => {
  try {
    const paymentData = req.body;
    
    // Convert data to JSON string and encode with base64
    const jsonString = JSON.stringify(paymentData);
    const data = Buffer.from(jsonString).toString('base64');
    
    // Create signature using SHA1 and private key
    const signatureString = EPOINT_PRIVATE_KEY + data + EPOINT_PRIVATE_KEY;
    const signature = Buffer.from(
      crypto.createHash('sha1').update(signatureString, 'binary').digest()
    ).toString('base64');
    
    // Make request to Epoint API
    const response = await fetch('https://epoint.az/api/1/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        data: data,
        signature: signature
      })
    });
    
    const result = await response.json();
    res.json(result);
  } catch (error) {
    console.error('Epoint payment error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to process payment request' 
    });
  }
});

module.exports = router; 