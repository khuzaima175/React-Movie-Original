import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchUserNotifications,
  markNotificationsRead,
  fetchAlertPreferences,
  updateAlertPreferences
} from "../src/services/notificationsService.js";

test("fetchUserNotifications and markNotificationsRead work cleanly and degrade when unconfigured", async () => {
  assert.deepEqual(await fetchUserNotifications(null, { supabaseClient: null }), []);

  const rows = [{ id: 1, title: "Arrival", provider_name: "Netflix", read_at: null }];
  let updatedIds = null;

  const fakeSupabase = {
    from(table) {
      assert.equal(table, "user_notifications");
      return {
        select() {
          return {
            eq() {
              return {
                order() {
                  return {
                    limit: async () => ({ data: rows, error: null })
                  };
                }
              };
            }
          };
        },
        update() {
          return {
            eq() {
              return {
                in: async (_col, ids) => {
                  updatedIds = ids;
                  return { error: null };
                }
              };
            }
          };
        }
      };
    }
  };

  const list = await fetchUserNotifications("u1", { supabaseClient: fakeSupabase });
  assert.equal(list.length, 1);
  assert.equal(list[0].title, "Arrival");

  const markRes = await markNotificationsRead("u1", [1], { supabaseClient: fakeSupabase });
  assert.equal(markRes.ok, true);
  assert.deepEqual(updatedIds, [1]);
});

test("fetchAlertPreferences and updateAlertPreferences update profile email digest flags", async () => {
  let savedPatch = null;
  const fakeSupabase = {
    from(table) {
      assert.equal(table, "profiles");
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({
                  data: { alert_email_enabled: true, alert_frequency: "weekly" },
                  error: null
                })
              };
            }
          };
        },
        update(patch) {
          savedPatch = patch;
          return {
            eq: async () => ({ error: null })
          };
        }
      };
    }
  };

  const prefs = await fetchAlertPreferences("u1", { supabaseClient: fakeSupabase });
  assert.equal(prefs.alertEmailEnabled, true);
  assert.equal(prefs.alertFrequency, "weekly");

  const upd = await updateAlertPreferences(
    "u1",
    { alertEmailEnabled: false, alertFrequency: "off" },
    { supabaseClient: fakeSupabase }
  );
  assert.equal(upd.ok, true);
  assert.equal(savedPatch.alert_email_enabled, false);
  assert.equal(savedPatch.alert_frequency, "off");
});
