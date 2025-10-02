const MAX_EVENTS_PER_COMPANY = 200;

const eventsByCompany = new Map();

function ensureBucket(companyId) {
  if (!companyId) return null;
  if (!eventsByCompany.has(companyId)) {
    eventsByCompany.set(companyId, []);
  }
  return eventsByCompany.get(companyId);
}

export function recordEvent(companyId, event) {
  if (!companyId || !event || typeof event !== 'object') {
    return;
  }

  const bucket = ensureBucket(companyId);
  if (!bucket) return;

  const payload = { ...event };
  bucket.unshift(payload);
  if (bucket.length > MAX_EVENTS_PER_COMPANY) {
    bucket.length = MAX_EVENTS_PER_COMPANY;
  }
}

export function listEvents(companyId, { type, limit } = {}) {
  if (!companyId) return [];
  const bucket = eventsByCompany.get(companyId) ?? [];
  let result = bucket;

  if (type) {
    result = result.filter((evt) => evt.type === type);
  }

  if (limit && Number.isFinite(limit)) {
    const value = Math.max(1, Math.min(limit, MAX_EVENTS_PER_COMPANY));
    result = result.slice(0, value);
  }

  return result.map((evt) => ({ ...evt }));
}

export function clearCompanyEvents(companyId) {
  if (!companyId) return;
  eventsByCompany.delete(companyId);
}

export function clearAllEvents() {
  eventsByCompany.clear();
}
