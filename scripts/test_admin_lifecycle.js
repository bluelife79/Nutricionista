"use strict";

const assert = require("assert");
const { _test } = require("../api/admin");

function fakeSupabase(options = {}) {
  const state = {
    profile: options.profile
      ? { ...options.profile }
      : {
          name: "ELENA RAMÍREZ GARCÍA",
          email: "erg_ti@yahoo.es",
          active: true,
          created_at: "2026-01-01T00:00:00Z",
        },
    authUser:
      options.authUser === null
        ? null
        : {
            id: "00000000-0000-0000-0000-000000000123",
            email: "erg_ti@yahoo.es",
            app_metadata: {
              role: "member",
              ...(options.authUser?.app_metadata || {}),
            },
          },
    authUpdates: [],
    profileUpdateError: Boolean(options.profileUpdateError),
  };

  const supabase = {
    from(table) {
      assert.strictEqual(table, "users");
      let operation = "select";
      let patch = null;
      let email = null;
      const builder = {
        select() {
          return builder;
        },
        update(value) {
          operation = "update";
          patch = value;
          return builder;
        },
        eq(field, value) {
          assert.strictEqual(field, "email");
          email = value;
          return builder;
        },
        async maybeSingle() {
          return {
            data:
              state.profile && state.profile.email === email
                ? { ...state.profile }
                : null,
            error: null,
          };
        },
        async single() {
          assert.strictEqual(operation, "update");
          if (state.profileUpdateError) {
            return { data: null, error: new Error("profile update failed") };
          }
          if (!state.profile || state.profile.email !== email) {
            return { data: null, error: new Error("missing profile") };
          }
          Object.assign(state.profile, patch);
          return { data: { ...state.profile }, error: null };
        },
      };
      return builder;
    },
    auth: {
      admin: {
        async listUsers() {
          return {
            data: { users: state.authUser ? [{ ...state.authUser }] : [] },
            error: null,
          };
        },
        async updateUserById(id, changes) {
          assert(state.authUser, "No debería actualizar Auth si no existe");
          assert.strictEqual(id, state.authUser.id);
          state.authUpdates.push(changes);
          state.authUser.app_metadata = {
            ...(changes.app_metadata || {}),
          };
          return { data: { user: { ...state.authUser } }, error: null };
        },
      },
    },
  };
  return { state, supabase };
}

async function main() {
  const normal = fakeSupabase();
  const deactivated = await _test.setMemberActive(
    normal.supabase,
    "ERG_TI@YAHOO.ES",
    false,
  );
  assert.strictEqual(deactivated.changed, true);
  assert.strictEqual(deactivated.user.active, false);
  assert.strictEqual(deactivated.sessionRevoked, true);
  assert.strictEqual(normal.state.profile.active, false);
  assert.strictEqual(normal.state.authUser.app_metadata.session_version, 2);

  const repeated = await _test.setMemberActive(
    normal.supabase,
    "erg_ti@yahoo.es",
    false,
  );
  assert.strictEqual(repeated.changed, false);
  assert.strictEqual(normal.state.authUpdates.length, 1);

  const reactivated = await _test.setMemberActive(
    normal.supabase,
    "erg_ti@yahoo.es",
    true,
  );
  assert.strictEqual(reactivated.changed, true);
  assert.strictEqual(reactivated.user.active, true);
  assert.strictEqual(normal.state.authUser.app_metadata.session_version, 2);

  const legacy = fakeSupabase({ authUser: null });
  const legacyDeactivation = await _test.setMemberActive(
    legacy.supabase,
    "erg_ti@yahoo.es",
    false,
  );
  assert.strictEqual(legacyDeactivation.user.active, false);
  assert.strictEqual(legacyDeactivation.sessionRevoked, false);

  await assert.rejects(
    () =>
      _test.setMemberActive(
        legacy.supabase,
        "erg_ti@yahoo.es",
        true,
      ),
    (error) => error.status === 409,
  );

  const rollback = fakeSupabase({ profileUpdateError: true });
  await assert.rejects(
    () =>
      _test.setMemberActive(
        rollback.supabase,
        "erg_ti@yahoo.es",
        false,
      ),
    (error) => error.status === 500,
  );
  assert.strictEqual(rollback.state.profile.active, true);
  assert.strictEqual(
    rollback.state.authUser.app_metadata.session_version,
    undefined,
  );
  assert.strictEqual(rollback.state.authUpdates.length, 2);

  console.log(
    "PASS admin: bajas idempotentes, revocación de sesión, reactivación y rollback",
  );
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
