import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_PASSWORD_LENGTH,
  validateAuthForm,
  normalizeAuthError,
  signUpWithEmailPassword,
  signInWithEmailPassword,
  signInWithMagicLink,
  sendPasswordResetEmail,
  updateAccountPassword,
  updateAccountProfile
} from "../src/services/authService.js";

test("validateAuthForm enforces email format, 8+ char passwords, and matching confirmation across all modes", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);

  const badEmail = validateAuthForm({ mode: "signin", email: "not-an-email", password: "password123" });
  assert.equal(badEmail.ok, false);
  assert.ok(badEmail.fieldErrors.email);

  const shortPass = validateAuthForm({
    mode: "signup",
    email: "user@example.com",
    password: "short",
    confirmPassword: "short"
  });
  assert.equal(shortPass.ok, false);
  assert.ok(shortPass.fieldErrors.password);

  const mismatch = validateAuthForm({
    mode: "signup",
    email: "user@example.com",
    password: "strongpassword1",
    confirmPassword: "strongpassword2"
  });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.fieldErrors.confirmPassword);

  const validSignup = validateAuthForm({
    mode: "signup",
    email: "user@example.com",
    password: "strongpassword1",
    confirmPassword: "strongpassword1",
    displayName: "Khuzaima"
  });
  assert.equal(validSignup.ok, true);
  assert.deepEqual(validSignup.fieldErrors, {});

  const validMagic = validateAuthForm({ mode: "magic", email: "user@example.com" });
  assert.equal(validMagic.ok, true);

  const validForgot = validateAuthForm({ mode: "forgot", email: "user@example.com" });
  assert.equal(validForgot.ok, true);

  const badReset = validateAuthForm({ mode: "reset", password: "short", confirmPassword: "short" });
  assert.equal(badReset.ok, false);

  const validReset = validateAuthForm({
    mode: "reset",
    password: "newpassword123",
    confirmPassword: "newpassword123"
  });
  assert.equal(validReset.ok, true);
});

test("normalizeAuthError translates common Supabase Auth errors to clear user-facing copy", () => {
  assert.match(normalizeAuthError({ message: "Invalid login credentials" }), /incorrect email or password/i);
  assert.match(normalizeAuthError({ message: "Email not confirmed" }), /confirm your email/i);
  assert.match(normalizeAuthError({ message: "User already registered" }), /already exists/i);
  assert.match(normalizeAuthError({ message: "For security purposes, you can only request this after 40 seconds (over_email_send_rate_limit)" }), /too many/i);
});

test("signUpWithEmailPassword distinguishes confirmation-pending signups from obfuscated duplicate emails", async () => {
  const pendingSupabase = {
    auth: {
      signUp: async () => ({
        data: {
          user: { id: "u-new", email: "new@example.com", identities: [{ id: "id-1" }] },
          session: null
        },
        error: null
      })
    }
  };
  const pending = await signUpWithEmailPassword(pendingSupabase, {
    email: "new@example.com",
    password: "strongpassword1",
    displayName: "Alex",
    emailRedirectTo: "https://example.com/auth"
  });
  assert.equal(pending.ok, true);
  assert.equal(pending.needsEmailConfirmation, true);
  assert.equal(pending.alreadyRegistered, false);

  const duplicateSupabase = {
    auth: {
      signUp: async () => ({
        data: {
          user: { id: "u-existing", email: "dup@example.com", identities: [] },
          session: null
        },
        error: null
      })
    }
  };
  const dup = await signUpWithEmailPassword(duplicateSupabase, {
    email: "dup@example.com",
    password: "strongpassword1"
  });
  assert.equal(dup.ok, false);
  assert.equal(dup.alreadyRegistered, true);
  assert.match(dup.error, /already exists/i);
});

test("signInWithEmailPassword, signInWithMagicLink, sendPasswordResetEmail, updateAccountPassword, and updateAccountProfile call Supabase cleanly", async () => {
  const calls = [];
  const mockSupabase = {
    auth: {
      signInWithPassword: async (args) => {
        calls.push(["signInWithPassword", args]);
        return { data: { user: { id: "u1", email: args.email }, session: { access_token: "tok" } }, error: null };
      },
      signInWithOtp: async (args) => {
        calls.push(["signInWithOtp", args]);
        return { data: {}, error: null };
      },
      resetPasswordForEmail: async (email, opts) => {
        calls.push(["resetPasswordForEmail", email, opts]);
        return { data: {}, error: null };
      },
      updateUser: async (args) => {
        calls.push(["updateUser", args]);
        return { data: { user: { id: "u1" } }, error: null };
      }
    },
    from(table) {
      return {
        upsert: async (payload) => {
          calls.push(["upsert", table, payload]);
          return { error: null };
        }
      };
    }
  };

  const signInRes = await signInWithEmailPassword(mockSupabase, {
    email: "  USER@Example.com ",
    password: "strongpassword1"
  });
  assert.equal(signInRes.ok, true);
  assert.equal(signInRes.user.email, "user@example.com");

  const magicRes = await signInWithMagicLink(mockSupabase, {
    email: "user@example.com",
    emailRedirectTo: "https://example.com/"
  });
  assert.equal(magicRes.ok, true);

  const resetRes = await sendPasswordResetEmail(mockSupabase, {
    email: "user@example.com",
    redirectTo: "https://example.com/auth?mode=reset"
  });
  assert.equal(resetRes.ok, true);

  const pwRes = await updateAccountPassword(mockSupabase, { newPassword: "newstrongpassword1" });
  assert.equal(pwRes.ok, true);

  const profRes = await updateAccountProfile(mockSupabase, { userId: "u1", displayName: "  Khuzaima  " });
  assert.equal(profRes.ok, true);
  assert.equal(profRes.displayName, "Khuzaima");
  assert.equal(calls.length, 5);
});
