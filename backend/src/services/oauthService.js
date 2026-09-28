const axios = require('axios');
const config = require('../config/env');
const AppError = require('../utils/AppError');
const { generateOAuthState, verifyOAuthState } = require('../utils/tokens');

// ------------------------------------------------------------------
// Google
// ------------------------------------------------------------------
function buildGoogleAuthUrl() {
  if (!config.oauth.google.clientId) {
    throw new AppError(
      'Google OAuth is not configured. Set GOOGLE_CLIENT_ID/SECRET in .env.',
      500,
      'OAUTH_NOT_CONFIGURED'
    );
  }
  const state = generateOAuthState();
  const params = new URLSearchParams({
    client_id: config.oauth.google.clientId,
    redirect_uri: config.oauth.google.callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeGoogleCode(code) {
  const response = await axios.post('https://oauth2.googleapis.com/token', {
    code,
    client_id: config.oauth.google.clientId,
    client_secret: config.oauth.google.clientSecret,
    redirect_uri: config.oauth.google.callbackUrl,
    grant_type: 'authorization_code',
  });
  return response.data.access_token;
}

async function fetchGoogleProfile(accessToken) {
  const response = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const { sub, email, name, picture, email_verified } = response.data;
  return {
    providerId: sub,
    email,
    name: name || email.split('@')[0],
    avatarUrl: picture || null,
    emailVerified: !!email_verified,
  };
}

module.exports = {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  fetchGoogleProfile,
  verifyOAuthState,
};
