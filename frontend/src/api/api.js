async function request(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Shortwave-Client": "web",
    },
  });

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("API unavailable. Check backend and Vite proxy.");
  }

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

export const getLinks = () => request("/links");

export const createLink = (values) =>
  request("/links", {
    method: "POST",
    body: JSON.stringify(values),
  });

export const accessLink = (alias, password) =>
  request(`/links/${encodeURIComponent(alias)}/access`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });