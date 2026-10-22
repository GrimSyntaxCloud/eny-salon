"use strict";
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const random = () => crypto.randomBytes(32).toString("hex");
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const sign = (value, secret) =>
  crypto.createHmac("sha256", secret).update(value).digest("hex");
async function hash(password) {
  const salt = random();
  const key = await scrypt(password, salt, 64, {
    N: 65536,
    r: 8,
    p: 2,
    maxmem: 80 * 1024 * 1024,
  });
  return `scrypt:${salt}:${key.toString("hex")}`;
}
async function verify(password, encoded) {
  if (typeof password !== "string" || Buffer.byteLength(password) > 128)
    return false;
  const [scheme, salt, digest] = (encoded || "").split(":");
  if (scheme !== "scrypt" || !/^[a-f0-9]{128}$/.test(digest || ""))
    return false;
  const key = await scrypt(password, salt, 64, {
    N: 65536,
    r: 8,
    p: 2,
    maxmem: 80 * 1024 * 1024,
  });
  return equal(key.toString("hex"), digest);
}
function cookies(req) {
  const result = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) result[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return result;
}
module.exports = { sha, random, equal, sign, hash, verify, cookies };
