import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSupabaseConfig } from "../src/lib/supabase-config";

test("a deployment without environment overrides still uses the shared trip database", () => {
  const config = resolveSupabaseConfig();
  assert.equal(config.url, "https://ebbjeibnxywgyegcejzh.supabase.co");
  assert.match(config.key, /^sb_publishable_/);
  assert.deepEqual(resolveSupabaseConfig("", ""), config);
});

test("partial project overrides fail instead of mixing projects or saving locally", () => {
  assert.throws(() => resolveSupabaseConfig("https://example.supabase.co"), /together/);
  assert.throws(() => resolveSupabaseConfig(undefined, "sb_publishable_example"), /together/);
});

test("complete public configuration supports isolated databases", () => {
  assert.deepEqual(resolveSupabaseConfig("http://127.0.0.1:54321", "sb_publishable_example"), {
    url: "http://127.0.0.1:54321", key: "sb_publishable_example",
  });
  const anon = `header.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.signature`;
  assert.equal(resolveSupabaseConfig("https://example.supabase.co", anon).key, anon);
});

test("invalid URLs and privileged keys are rejected before browser bundling", () => {
  for (const url of ["invalid", "http://example.com", "https://user:password@example.com", "https://example.com/rest/v1", "https://example.com?key=value"]) {
    assert.throws(() => resolveSupabaseConfig(url, "sb_publishable_example"));
  }
  const serviceRole = `header.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
  for (const key of ["sb_secret_example", serviceRole, "your-publishable-key"]) {
    assert.throws(() => resolveSupabaseConfig("https://example.supabase.co", key), /Only a Supabase/);
  }
});
