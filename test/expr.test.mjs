/* Plot expression parser — arithmetic, precedence, the Math whitelist, and the
 * rejection paths that keep a user-typed formula harmless. Bundled from src/. */
import test from "node:test";
import assert from "node:assert/strict";
import { bundle } from "./_bundle.mjs";

const { compileExpr } = await bundle("src/tweaks/controls/plot.ts");
const ev = (s, x = 0) => { const f = compileExpr(s); return f ? f(x) : null; };

test("arithmetic and precedence", () => {
  assert.equal(ev("2+3*4"), 14);
  assert.equal(ev("(1+2)*3"), 9);
  assert.equal(ev("2^3^2"), 512);   // ^ is right-associative
  assert.equal(ev("-2^2"), -4);     // unary minus binds looser than ^
  assert.equal(ev("x%2", 5), 1);
  assert.equal(ev("1e3"), 1000);
});

test("whitelisted functions and constants", () => {
  assert.equal(ev("sin(x)", Math.PI / 2), 1);
  assert.equal(ev("min(3,1)"), 1);
  assert.equal(ev("clamp(5,0,2)"), 2);
  assert.equal(ev("mod(7,3)"), 1);
  assert.ok(Math.abs(ev("tau") - 2 * Math.PI) < 1e-12);
});

test("rejects anything outside the whitelist", () => {
  assert.equal(compileExpr("x;alert(1)"), null);
  assert.equal(compileExpr("constructor(1)"), null);   // null-proto table — no prototype escape
  assert.equal(compileExpr("toString(1)"), null);
  assert.equal(compileExpr("y"), null);                // unknown identifier
  assert.equal(compileExpr("1 2"), null);              // leftover tokens
  assert.equal(compileExpr(""), null);
  assert.equal(compileExpr("2x"), null);               // no implicit multiplication
});

test("length cap bounds recursion; deep-but-legal nesting still parses", () => {
  assert.notEqual(compileExpr("(".repeat(200) + "x" + ")".repeat(200)), null);
  assert.equal(compileExpr("x+".repeat(300) + "x"), null); // > 512 chars → null, not a RangeError
});
