const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const { test } = require("node:test");

test("editor IDs work over HTTP without crypto.randomUUID", async () => {
  const { createId } = await import("../addons/pipecat_assist/ui-src/src/id.mjs");
  const insecureCrypto = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) };
  const ids = Array.from({ length: 10 }, () => createId(insecureCrypto));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});
