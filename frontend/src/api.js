const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api').replace(/\/$/, '');

async function request(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error?.message || `Request failed (${response.status})`);
  }
  return payload.data;
}

export function registerUser(name, email, password) {
  return request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password })
  });
}

export function loginUser(email, password) {
  return request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
}

export function uploadCsv(file) {
  const body = new FormData();
  body.append('file', file);
  return request('/uploads', { method: 'POST', body });
}

export function getAnalysis(analysisId) {
  return request(`/analyses/${analysisId}`);
}

export async function waitForAnalysis(analysisId, onStatus) {
  const deadline = Date.now() + 130_000;
  while (Date.now() < deadline) {
    const analysis = await getAnalysis(analysisId);
    onStatus?.(analysis);
    if (analysis.status !== 'processing') return analysis;
    await new Promise((resolve) => window.setTimeout(resolve, 1800));
  }
  throw new Error('Analysis is taking longer than expected. Check the analysis again in a moment.');
}

async function getReadingsPage(analysisId, page) {
  return request(`/analyses/${analysisId}/consumption?page=${page}&pageSize=1000`);
}

export async function getConsumptionSample(analysisId) {
  const firstPage = await getReadingsPage(analysisId, 1);
  const totalPages = firstPage.pagination?.totalPages || 1;
  const pagesToFetch = Math.min(totalPages, 20);
  const pageNumbers = Array.from({ length: pagesToFetch }, (_, index) => {
    return pagesToFetch === 1 ? 1 : Math.round(index * (totalPages - 1) / (pagesToFetch - 1)) + 1;
  }).filter((page, index, pages) => pages.indexOf(page) === index && page !== 1);
  const remainingPages = await Promise.all(pageNumbers.map((page) => getReadingsPage(analysisId, page)));
  return [firstPage, ...remainingPages].flatMap((page) => page.items || []).sort((a, b) => {
    return new Date(a.timestamp) - new Date(b.timestamp);
  });
}

export function getForecast(analysisId) {
  return request(`/analyses/${analysisId}/forecast`);
}

export function getAnomalies(analysisId) {
  return request(`/analyses/${analysisId}/anomalies?page=1&pageSize=100`);
}