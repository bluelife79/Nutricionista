const { serviceClient } = require('./_supabase');
const { safeEqual } = require('./_session');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false });
  }

  const expected = `Bearer ${String(process.env.CRON_SECRET || '')}`;
  const received = String(req.headers.authorization || '');
  if (expected === 'Bearer ' || !safeEqual(received, expected)) {
    return res.status(401).json({ success: false });
  }

  try {
    const supabase = serviceClient();
    const { error } = await supabase.rpc('refresh_telemetry_aggregates');
    if (error) throw error;
    return res.status(200).json({ success: true });
  } catch {
    return res.status(503).json({ success: false });
  }
};
