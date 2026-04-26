const API_BASE  = "/api";
const TOKEN_KEY = "beacon_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = t => t
  ? localStorage.setItem(TOKEN_KEY, t)
  : localStorage.removeItem(TOKEN_KEY);

/**
 * Typed fetch wrapper. Throws on non-2xx with the server error message attached.
 */
export async function api(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    throw Object.assign(new Error(data.error || "Request failed"), {
      status: res.status,
      data,
    });
  }
  return data;
}

/**
 * Build a multi-metric query string from an array of metric keys.
 * e.g. metricsQS(["a","b"]) → "metrics[]=a&metrics[]=b"
 */
export const metricsQS = keys => keys.map(k => `metrics[]=${k}`).join("&");
