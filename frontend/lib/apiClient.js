const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

/**
 * Access token lives in memory only (module-level variable), never
 * localStorage — matches the backend's design (short-lived JWT returned in
 * response body, long-lived refresh token in an httpOnly cookie the browser
 * manages automatically). Losing this on a hard refresh is expected; the
 * AuthProvider calls /auth/refresh on mount to silently restore it.
 */
let accessToken = null;
let refreshPromise = null; // dedupes concurrent refresh attempts

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise; // another call is already refreshing

  refreshPromise = fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include', // sends the httpOnly refresh_token cookie
  })
    .then(async (res) => {
      if (!res.ok) {
        setAccessToken(null);
        return null;
      }
      const body = await res.json();
      const token = body?.data?.accessToken || null;
      setAccessToken(token);
      return token;
    })
    .catch(() => {
      setAccessToken(null);
      return null;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

class ApiError extends Error {
  constructor(message, status, errorCode, requestId) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
    this.requestId = requestId;
  }
}

/**
 * Core request function. Automatically attaches the access token, retries
 * once after a silent refresh if the server says the token expired, and
 * throws a typed ApiError with the backend's errorCode preserved so UI code
 * can branch on it (e.g. show "session expired" vs a generic error toast).
 */
async function request(path, { method = 'GET', body, headers = {}, skipAuthRetry = false } = {}) {
  const doFetch = () =>
    fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  let response = await doFetch();

  if (response.status === 401 && !skipAuthRetry) {
    const errorBody = await response.clone().json().catch(() => null);
    if (errorBody?.errorCode === 'AUTH_TOKEN_EXPIRED' || errorBody?.errorCode === 'AUTH_MISSING_TOKEN') {
      const newToken = await refreshAccessToken();
      if (newToken) {
        response = await doFetch();
      }
    }
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      data?.message || 'Something went wrong. Please try again.',
      response.status,
      data?.errorCode || 'UNKNOWN_ERROR',
      data?.requestId
    );
  }

  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body, opts) => request(path, { method: 'POST', body, ...opts }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  delete: (path) => request(path, { method: 'DELETE' }),
  refreshAccessToken,
};

export { ApiError };
