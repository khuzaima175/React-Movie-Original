import test from "node:test";
import assert from "node:assert/strict";
import { mapChatErrorToMessage } from "../src/services/geminiChatService.js";

const EMOJI_RE = /\p{Extended_Pictographic}/u;

test("mapChatErrorToMessage maps capacity/quota errors cleanly without emoji", () => {
  const cases = [
    new Error("RESOURCE_EXHAUSTED"),
    new Error("User exceeded quota"),
    { message: "All chat models failed" },
    { errorCode: "PROXY_RATE_LIMIT" },
    { message: "Gemini proxy rate limit", errorCode: "PROXY_RATE_LIMIT" }
  ];

  for (const err of cases) {
    const msg = mapChatErrorToMessage(err);
    assert.equal(
      msg,
      "Shared AI companion is at capacity right now. Try again in a few minutes, or use your own free Gemini key."
    );
    assert.equal(EMOJI_RE.test(msg), false);
  }
});

test("mapChatErrorToMessage maps auth, network, and generic errors cleanly without emoji", () => {
  const authMsg = mapChatErrorToMessage(new Error("Gemini API Key missing"));
  assert.equal(authMsg, "The AI service is not configured on this deployment.");
  assert.equal(EMOJI_RE.test(authMsg), false);

  const err401 = mapChatErrorToMessage({ message: "HTTP 401 unauthorized" });
  assert.equal(err401, "The AI service is not configured on this deployment.");

  const netMsg = mapChatErrorToMessage(new Error("Failed to fetch resource"));
  assert.equal(netMsg, "Connection issue. Check your internet and try again.");
  assert.equal(EMOJI_RE.test(netMsg), false);

  const genericMsg = mapChatErrorToMessage(new Error("Unexpected parser error"));
  assert.equal(genericMsg, "Something went wrong. Please try again in a moment.");
  assert.equal(EMOJI_RE.test(genericMsg), false);
});
