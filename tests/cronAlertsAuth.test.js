import test from "node:test";
import assert from "node:assert/strict";
import cronAlertsHandler from "../api/cron-watchlist-alerts.js";
import cronDigestHandler from "../api/cron-weekly-digest.js";
import unsubscribeHandler from "../api/unsubscribe-digest.js";

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(k, v) {
      res.headers[k] = v;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
    send(payload) {
      res.body = payload;
      return res;
    }
  };
  return res;
}

test("cron handlers enforce CRON_SECRET bearer auth and reject unauthorized requests with 401", async () => {
  const prevSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "super-secret-cron-token";

  try {
    const res1 = createMockRes();
    await cronAlertsHandler({ method: "GET", headers: {} }, res1);
    assert.equal(res1.statusCode, 401);

    const res2 = createMockRes();
    await cronDigestHandler(
      { method: "GET", headers: { authorization: "Bearer wrong-token" } },
      res2
    );
    assert.equal(res2.statusCode, 401);
  } finally {
    if (prevSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevSecret;
  }
});

test("unsubscribe-digest rejects missing or invalid HMAC tokens with 400", async () => {
  const prevSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "super-secret-cron-token";

  try {
    const res = createMockRes();
    await unsubscribeHandler({ method: "GET", query: { token: "invalid.token" } }, res);
    assert.equal(res.statusCode, 400);
  } finally {
    if (prevSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prevSecret;
  }
});
