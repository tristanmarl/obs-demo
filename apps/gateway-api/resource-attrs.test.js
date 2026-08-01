import assert from "node:assert/strict";
import test from "node:test";
import { parseResourceAttrs } from "./resource-attrs.js";

test("accepts bounded allowlisted resource attributes", () => {
  assert.deepEqual(parseResourceAttrs(" team=platform, release.version=1 ").entries, ["team=platform", "release.version=1"]);
});

test("rejects unsafe and duplicate attributes", () => {
  for (const attrs of ["service.name=bad", "service.instance.id=bad", "team=one,team=two", "bad key=value", "team="]) {
    assert.throws(() => parseResourceAttrs(attrs), /./);
  }
});

test("rejects oversized and overlong attribute sets", () => {
  assert.throws(() => parseResourceAttrs("x=" + "a".repeat(2048)), /2048/);
  assert.throws(() => parseResourceAttrs(Array.from({ length: 33 }, (_, index) => `key${index}=value`).join(",")), /32/);
});
