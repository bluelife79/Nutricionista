async function logAdminAction(supabase, admin, action, targetEmail, metadata = {}) {
  const { error } = await supabase.from('admin_audit_log').insert({
    admin_user_id: admin.id,
    admin_email: String(admin.email || '').toLowerCase(),
    action,
    target_email: String(targetEmail || '').toLowerCase(),
    metadata,
  });
  if (error) throw error;
}

module.exports = { logAdminAction };
