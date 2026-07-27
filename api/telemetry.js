const { serviceClient } = require('./_supabase');
const { readSession } = require('./_session');

const ALLOWED_EVENTS = new Set([
  'search',
  'search_empty',
  'select_origin',
  'prompt_shown',
  'prompt_answered',
  'results_rendered',
  'card_expanded',
  'abandon',
]);

function normalizedTerm(value) {
  const source = String(value || '').trim();
  if (
    /@/.test(source) ||
    source.replace(/\D/g, '').length >= 8
  ) {
    return '';
  }
  return source
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
    .slice(0, 60);
}

function integer(value, min, max) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
}

function safeId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{1,80}$/.test(id) ? id : null;
}

function sanitize(event, payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  if (event === 'search' || event === 'search_empty') {
    return {
      term: normalizedTerm(source.term),
      result_count: integer(source.result_count, 0, 500),
      selected: source.selected === true,
    };
  }
  if (event === 'select_origin') {
    return {
      food_id: safeId(source.food_id),
      position: integer(source.position, 1, 500),
    };
  }
  if (event === 'prompt_shown' || event === 'prompt_answered') {
    return {
      prompt_id: safeId(source.prompt_id),
      option_id: safeId(source.option_id),
    };
  }
  if (event === 'results_rendered') {
    return {
      direct_count: integer(source.direct_count, 0, 500),
      family_count: integer(source.family_count, 0, 500),
      prepared_count: integer(source.prepared_count, 0, 500),
      duration_bucket_ms: integer(source.duration_bucket_ms, 0, 30000),
      cache_hit: source.cache_hit === true,
    };
  }
  if (event === 'card_expanded') {
    return {
      block: ['intercambios', 'familia', 'preparados'].includes(source.block)
        ? source.block
        : null,
      position: integer(source.position, 1, 500),
    };
  }
  return {};
}

async function telemetryHandler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false });
  }
  const contentLength = Number(req.headers?.['content-length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return res.status(413).json({ success: false });
  }

  let session;
  try {
    session = readSession(req);
  } catch {
    return res.status(503).json({ success: false });
  }
  if (!session) return res.status(401).json({ success: false });

  const event = String(req.body?.event || '');
  if (!ALLOWED_EVENTS.has(event)) {
    return res.status(400).json({ success: false });
  }
  const payload = sanitize(event, req.body?.payload);
  if (
    (event === 'search' || event === 'search_empty') &&
    !payload.term
  ) {
    return res.status(400).json({ success: false });
  }

  try {
    const supabase = serviceClient();
    const { error } = await supabase.from('telemetry_events_raw').insert({
      event_name: event,
      payload,
    });
    if (error) throw error;
    const aggregate = await supabase.rpc('refresh_telemetry_aggregates');
    if (aggregate.error) throw aggregate.error;
    return res.status(202).json({ success: true });
  } catch {
    return res.status(503).json({ success: false });
  }
}

telemetryHandler._test = {
  ALLOWED_EVENTS,
  normalizedTerm,
  safeId,
  sanitize,
};

module.exports = telemetryHandler;
