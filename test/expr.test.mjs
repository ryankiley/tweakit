/* Plot expression parser — arithmetic, precedence, the Math whitelist, and the
 * rejection paths that keep a user-typed formula harmless. Bundled from src/. */
import test from "node:test";
import assert from "node:assert/strict";
import { bundle } from "./_bundle.mjs";

const { compileExpr, parseExpr } = await bundle("src/tweaks/controls/plot.ts");
const ev = (s, x = 0) => {
  const f = compileExpr(s);
  return f ? f(x) : null;
};

test("arithmetic and precedence", () => {
  assert.equal(ev("2+3*4"), 14);
  assert.equal(ev("(1+2)*3"), 9);
  assert.equal(ev("2^3^2"), 512); // ^ is right-associative
  assert.equal(ev("-2^2"), -4); // unary minus binds looser than ^
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
  assert.equal(compileExpr("constructor(1)"), null); // null-proto table — no prototype escape
  assert.equal(compileExpr("toString(1)"), null);
  assert.equal(compileExpr("y"), null); // unknown identifier
  assert.equal(compileExpr("1 2"), null); // leftover tokens
  assert.equal(compileExpr(""), null);
  // The implicit product and the bare-argument call reach no further than the same tables.
  for (const s of ["2constructor", "2toString", "sin constructor", "sin __proto__", "2constructor(1)"])
    assert.equal(compileExpr(s), null, s);
});

test("length cap bounds recursion; deep-but-legal nesting still parses", () => {
  assert.notEqual(compileExpr("(".repeat(200) + "x" + ")".repeat(200)), null);
  assert.equal(ev("2(".repeat(170) + "x" + ")".repeat(170), 1), 2 ** 170); // implied products nest as parentheses do
  assert.equal(compileExpr("x+".repeat(300) + "x"), null); // > 512 chars → null, not a RangeError
  assert.equal(parseExpr("x+".repeat(300) + "x"), "too long: 512 characters at most");
});

test("a number before a name or a parenthesis multiplies; names never split", () => {
  assert.equal(ev("2x", 3), 6);
  assert.equal(ev("3(x+1)", 1), 6);
  assert.equal(ev("2pi"), 2 * Math.PI);
  assert.equal(ev("2x^2", 3), 18); // binds as * does: 2·x², not (2x)²
  assert.equal(ev("-2x", 3), -6);
  assert.equal(ev("1/2x", 4), 2); // left to right, as with *
  assert.equal(ev("2e3x", 1), 2000); // the exponent stays part of the number
  assert.equal(parseExpr("xy"), 'unknown name "xy"');
  assert.equal(ev("x(2)", 3), 6); // x is never a function, so this is a product
  assert.equal(parseExpr("y(2)"), 'unknown function "y"');
  assert.equal(compileExpr("(x)2"), null); // a number after an operand asks for an operator
  assert.equal(compileExpr("2 3"), null);
});

// These read only "not a valid expression", against the parser's promise to say why, and 3x(x) as an unknown function
// x.
test('x, a constant or a closing parenthesis before a name or "(" multiplies too, and what\'s left says why', () => {
  const x = 1.7;
  for (const [s, want] of [
    ["pi x", Math.PI * x],
    ["e x", Math.E * x],
    ["2 pi x", 2 * Math.PI * x],
    ["(x)(x)", x * x],
    ["sin(x)cos(x)", Math.sin(x) * Math.cos(x)],
    ["3x(x)", 3 * x * x],
    ["x pi", x * Math.PI],
    ["(x+1)x", (x + 1) * x],
    ["2x sin(x)", 2 * x * Math.sin(x)],
    ["pi(x+1)", Math.PI * (x + 1)],
    ["x^2(x)", x * x * x],
  ])
    assert.ok(Math.abs(ev(s, x) - want) < 1e-12, `${s}: ${ev(s, x)} vs ${want}`);
  // An e is an exponent only with a digit right after it: 2e+1 is 20, 2e+x the constant, 2·e + x.
  assert.equal(ev("2e+1"), 20);
  assert.equal(ev("2e+x", 1), 2 * Math.E + 1);
  assert.equal(ev("2e-x", 1), 2 * Math.E - 1);
  for (const [s, why] of [
    ["2 3", "missing an operator before 3"],
    ["(x)2", "missing an operator before 2"],
    ["x 2", "missing an operator before 2"],
    ["2+", '"+" needs a value on each side'],
    ["*x", '"*" needs a value on each side'],
    ["(x", 'missing ")"'],
    ["sin(x", 'missing ")"'],
    ["x)", 'unmatched ")"'],
    ["()", "nothing inside the parentheses"],
    ["x,2", '"," outside a function\'s parentheses'],
  ])
    assert.equal(parseExpr(s), why, s);
  // The whitelist holds on every new path.
  for (const s of [
    "pi constructor",
    "x __proto__",
    "(x)toString",
    "sin(x)constructor(1)",
    "x constructor(1)",
    "e __proto__(x)",
  ])
    assert.equal(compileExpr(s), null, s);
});

test("a one-argument function takes a bare term; anything longer asks for parentheses", () => {
  assert.equal(ev("sin x", 2), Math.sin(2));
  assert.equal(ev("cos 2x", 1), Math.cos(2));
  assert.equal(ev("SIN X", 2), Math.sin(2));
  assert.equal(ev("sin x * 2 + 1", 2), Math.sin(2) * 2 + 1);
  assert.equal(ev("2sin x", 2), 2 * Math.sin(2));
  assert.equal(ev("max(sin x, 0)", 2), Math.sin(2));
  for (const s of ["sin x^2", "sin -x", "sin", "sin 2 cos x", "sin sin x", "sin 2(x)"])
    assert.equal(parseExpr(s), "write sin(…)", s);
  assert.equal(parseExpr("atan2 x"), "write atan2(…)"); // two arguments: no bare form
  assert.equal(parseExpr("sin y"), 'unknown name "y"'); // the inner reason wins
});

test("a trailing-dot number reads as the number", () => {
  assert.equal(ev("5."), 5);
  assert.equal(ev("5.*x", 2), 10);
  assert.equal(parseExpr("5.5."), 'unexpected "."');
});

test("a variadic function called empty is rejected, not Infinity", () => {
  for (const f of ["min", "max", "hypot"]) assert.equal(parseExpr(`${f}()`), `${f}() needs at least one value`);
  assert.equal(ev("min(x)", 4), 4);
  assert.equal(ev("max(1,x,3)", 5), 5);
});

test("forms that parsed before evaluate as before", () => {
  assert.equal(ev("2*x^2-3*x+1", 2), 3);
  assert.equal(ev(".5*x", 4), 2);
  assert.equal(ev("2e-1"), 0.2); // an exponent, not 2·e − 1
  assert.equal(ev("e"), Math.E);
  assert.ok(Number.isNaN(ev("sin()"))); // fixed arity: still NaN, as before
  assert.ok(Number.isNaN(ev("atan2(x)", 1)));
});
