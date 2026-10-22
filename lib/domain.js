"use strict";
const { random } = require("./security");
const RETENTION_MS = 96 * 60 * 60 * 1000;
const SERVICES = Object.freeze({
  Haircut: 14.99,
  "Child & senior haircut": 9.99,
  Shampoo: 5.99,
  Style: 24.99,
  "Bangs, neck & beard trim": 6.99,
});
const EXTRAS = ["Shampoo", "Style", "Bangs, neck & beard trim"];
class ValidationError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}
function dateParts(now = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
function slots(now = new Date()) {
  const day = dateParts(now).slice(0, 10);
  const result = [];
  for (let n = 1; n <= 14; n++) {
    const d = new Date(day + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    if (d.getUTCDay() === 0) continue;
    for (const time of ["09:00", "11:00", "14:00", "16:00"])
      result.push(d.toISOString().slice(0, 10) + " " + time);
  }
  return result;
}
function formatSlot(slot) {
  const [date, time] = slot.split(" ");
  const d = new Date(date + "T12:00:00Z");
  const [hh, mm] = time.split(":");
  return `${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(d)} · ${+hh % 12 || 12}:${mm} ${+hh >= 12 ? "pm" : "am"} ET`;
}
function text(value, max, label) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new ValidationError(
      `Please enter ${label} (up to ${max} characters).`,
    );
  return value.trim();
}
function customer(p) {
  const d = {};
  for (const [key, max, label] of [
    ["name", 100, "a name"],
    ["email", 200, "an email"],
    ["address", 200, "an address"],
    ["city", 100, "a city"],
    ["state", 2, "a state"],
    ["zip", 10, "a ZIP code"],
  ])
    d[key] = text(p[key], max, label);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email))
    throw new ValidationError("Please enter a valid email address.");
  d.state = d.state.toUpperCase();
  if (!/^[A-Z]{2}$/.test(d.state) || !/^\d{5}(-\d{4})?$/.test(d.zip))
    throw new ValidationError(
      "Use a two-letter state and a valid US ZIP code.",
    );
  if (!Object.hasOwn(SERVICES, p.service))
    throw new ValidationError("Choose a valid service.");
  d.service = p.service;
  const extras =
    p.extras === undefined
      ? []
      : Array.isArray(p.extras)
        ? p.extras
        : [p.extras];
  if (extras.length > 3 || extras.some((x) => !EXTRAS.includes(x)))
    throw new ValidationError("Choose valid extras.");
  d.extras = [...new Set(extras)];
  return d;
}
function seedWorkspace(now) {
  const times = slots(now);
  return {
    slots: times,
    blocked: [],
    appointments: [
      {
        id: random().slice(0, 16),
        slot: times[0],
        name: "Alex Rowan",
        email: "alex@example.test",
        address: "100 Demo Lane",
        city: "Sample City",
        state: "IL",
        zip: "60000",
        service: "Haircut",
        extras: ["Shampoo"],
        isSample: true,
        createdAt: now,
      },
    ],
    messages: [],
    outbox: [],
  };
}
function available(workspace, now = new Date()) {
  return workspace.slots.filter(
    (s) =>
      s > dateParts(now) &&
      !workspace.blocked.includes(s) &&
      !workspace.appointments.some((a) => a.slot === s),
  );
}
module.exports = {
  RETENTION_MS,
  SERVICES,
  EXTRAS,
  ValidationError,
  dateParts,
  slots,
  formatSlot,
  text,
  customer,
  seedWorkspace,
  available,
};
