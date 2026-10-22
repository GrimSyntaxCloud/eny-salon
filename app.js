"use strict";
const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const sec = require("./lib/security");
const d = require("./lib/domain");
function createApp({ store, secret, secure = false }) {
  if (typeof secret !== "string" || secret.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
        },
      },
    }),
  );
  app.use("/assets", express.static(path.join(__dirname, "public/assets")));
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: 90,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      validate: { trustProxy: false },
    }),
  );
  app.use(
    express.urlencoded({ extended: false, limit: "12kb", parameterLimit: 25 }),
  );
  app.use(async (req, res, next) => {
    try {
      res.set("Cache-Control", "no-store");
      const cookies = sec.cookies(req);
      let csrf = (cookies.eny_csrf || "").split(".");
      if (
        csrf.length !== 2 ||
        !/^[a-f0-9]{64}$/.test(csrf[0]) ||
        !sec.equal(csrf[1], sec.sign(csrf[0], secret))
      ) {
        const nonce = sec.random();
        csrf = [nonce, sec.sign(nonce, secret)];
        res.cookie("eny_csrf", csrf.join("."), {
          httpOnly: true,
          sameSite: "strict",
          secure,
          path: "/",
          maxAge: 96 * 3600000,
        });
      }
      req.csrf = csrf[0];
      req.token = cookies.eny_session;
      const session = await store.session(req.token);
      req.workspace = session
        ? await store.workspace(session.workspaceId, session.generation)
        : null;
      res.locals = {
        csrf: req.csrf,
        workspace: req.workspace,
        page: req.query.page || "home",
        error: "",
        notice: "",
        values: {},
        SERVICES: d.SERVICES,
        EXTRAS: d.EXTRAS,
        formatSlot: d.formatSlot,
        available: d.available,
      };
      next();
    } catch (e) {
      next(e);
    }
  });
  async function attach(req, res, workspace) {
    const token = await store.createSession(workspace);
    res.cookie("eny_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure,
      path: "/",
      maxAge: 8 * 3600000,
    });
    req.workspace = workspace;
    res.locals.workspace = workspace;
    return workspace;
  }
  async function ensureWorkspace(req, res) {
    if (req.workspace) return req.workspace;
    await store.throttle("new:" + req.ip, 5, 3600000);
    return attach(req, res, await store.createWorkspace());
  }
  function requireWorkspace(req) {
    if (!req.workspace)
      throw new d.ValidationError("Open a private demo workspace first.", 401);
    return req.workspace;
  }
  app.post("/", async (req, res, next) => {
    try {
      if (
        req.headers["sec-fetch-site"] === "cross-site" ||
        !sec.equal(req.csrf, req.body.csrf)
      )
        throw new d.ValidationError(
          "Your form expired. Refresh and try again.",
          403,
        );
      await store.throttle("writes:" + req.ip, 60, 60000);
      const action = req.body.action;
      if (action === "start") {
        await ensureWorkspace(req, res);
        return res.redirect(303, "/?page=admin");
      }
      if (action === "logout") {
        await store.logout(req.token);
        res.clearCookie("eny_session", {
          httpOnly: true,
          sameSite: "strict",
          secure,
          path: "/",
        });
        return res.redirect(303, "/");
      }
      if (action === "login") {
        await store.throttle("login:" + req.ip, 10, 15 * 60000);
        const name =
          typeof req.body.username === "string"
            ? req.body.username.toLowerCase().trim()
            : "";
        const workspace = await store.findUsername(name);
        if (
          !workspace ||
          !(await sec.verify(req.body.password, workspace.passwordHash))
        )
          throw new d.ValidationError(
            "Workspace name or password not recognized.",
          );
        await attach(req, res, workspace);
        return res.redirect(303, "/?page=admin");
      }
      if (action === "save-access") {
        const ws = requireWorkspace(req);
        if (ws.username)
          throw new d.ValidationError(
            "This workspace already has a sign-in name.",
          );
        const name =
          typeof req.body.username === "string"
            ? req.body.username.toLowerCase().trim()
            : "";
        const password = req.body.password;
        if (!/^[a-z0-9_-]{3,40}$/.test(name))
          throw new d.ValidationError(
            "Use a workspace name with 3–40 letters, numbers, hyphens or underscores.",
          );
        if (
          typeof password !== "string" ||
          password.length < 12 ||
          Buffer.byteLength(password) > 128
        )
          throw new d.ValidationError(
            "Use a password of 12–128 characters (maximum 128 bytes).",
          );
        await store.throttle("password:" + req.ip, 5, 15 * 60000);
        const passwordHash = await sec.hash(password);
        await store.mutate(ws, (data) => {
          if (data.username)
            throw new d.ValidationError(
              "This workspace already has a sign-in name.",
            );
          data.username = name;
          data.passwordHash = passwordHash;
        });
        try {
          await store.claimUsername(ws, name);
        } catch (error) {
          await store.mutate(ws, (data) => {
            if (data.username === name) {
              delete data.username;
              delete data.passwordHash;
            }
          });
          throw error;
        }
        return res.redirect(303, "/?page=admin&saved=1");
      }
      if (action === "book") {
        if (req.body.website)
          throw new d.ValidationError("Unable to accept this submission.");
        const customer = d.customer(req.body);
        const slot = d.text(req.body.slot, 30, "an appointment");
        const ws = await ensureWorkspace(req, res);
        const id = sec.random().slice(0, 16);
        await store.mutate(ws, (data) => {
          if (data.appointments.length >= 50)
            throw new d.ValidationError(
              "This demo workspace has reached its 50-appointment limit.",
              429,
            );
          if (!d.available(data, store.now()).includes(slot))
            throw new d.ValidationError(
              "That appointment is no longer available. Please choose another time.",
            );
          const now = store.now();
          data.appointments.push({
            ...customer,
            id,
            slot,
            createdAt: now,
            isSample: false,
          });
          data.outbox.push({
            id: sec.random().slice(0, 16),
            recipient: customer.email,
            subject: "Your Eny appointment confirmation",
            body: `Booking ${id} · ${customer.service} · ${d.formatSlot(slot)}`,
            createdAt: now,
          });
          data.outbox = data.outbox.slice(-100);
        });
        return res.redirect(303, "/?page=confirmation&id=" + id);
      }
      if (action === "contact") {
        const name = d.text(req.body.name, 100, "a name");
        const email = d.text(req.body.email, 200, "an email");
        const body = d.text(req.body.message, 2000, "a message");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          throw new d.ValidationError("Please enter a valid email address.");
        const ws = await ensureWorkspace(req, res);
        await store.mutate(ws, (data) => {
          if (data.messages.length >= 100)
            throw new d.ValidationError("This workspace inbox is full.", 429);
          data.messages.push({
            id: sec.random().slice(0, 16),
            name,
            email,
            body,
            createdAt: store.now(),
          });
        });
        return res.redirect(303, "/?page=contact&saved=1");
      }
      if (action === "availability") {
        const ws = requireWorkspace(req);
        const slot = d.text(req.body.slot, 30, "a time");
        await store.mutate(ws, (data) => {
          if (!data.slots.includes(slot) || slot <= d.dateParts(store.now()))
            throw new d.ValidationError(
              "Choose a future time in the calendar.",
            );
          if (data.appointments.some((a) => a.slot === slot))
            throw new d.ValidationError(
              "Booked appointments remain reserved. Edit the booking to move it.",
            );
          data.blocked = data.blocked.includes(slot)
            ? data.blocked.filter((s) => s !== slot)
            : [...data.blocked, slot];
        });
        return res.redirect(303, "/?page=availability");
      }
      if (action === "edit") {
        const ws = requireWorkspace(req);
        const customer = d.customer(req.body);
        const id = d.text(req.body.id, 16, "an appointment identifier");
        const slot = d.text(req.body.slot, 30, "an appointment");
        await store.mutate(ws, (data) => {
          const item = data.appointments.find((a) => a.id === id);
          if (!item) throw new d.ValidationError("Appointment not found.", 404);
          if (
            slot !== item.slot &&
            !d.available(data, store.now()).includes(slot)
          )
            throw new d.ValidationError(
              "Choose an available appointment time.",
            );
          Object.assign(item, customer, { slot });
        });
        return res.redirect(303, "/?page=admin");
      }
      throw new d.ValidationError("Unknown action.", 400);
    } catch (e) {
      if (e instanceof d.ValidationError) {
        res.status(e.status);
        res.locals.error = e.message;
        res.locals.values = { ...req.body, password: undefined };
        return render(req, res);
      }
      next(e);
    }
  });
  function render(req, res) {
    const page = String(req.query.page || "home");
    const allowed = [
      "home",
      "services",
      "about",
      "book",
      "confirmation",
      "contact",
      "login",
      "admin",
      "edit",
      "availability",
      "inbox",
    ];
    if (!allowed.includes(page)) return res.status(404).send("Page not found.");
    if (
      ["admin", "edit", "availability", "inbox"].includes(page) &&
      !req.workspace
    )
      return res.redirect(303, "/?page=login");
    const ws = req.workspace || {
      ...d.seedWorkspace(store.now()),
      expiresAt: null,
    };
    const id = String(req.query.id || req.body?.id || "");
    const appointment = ws.appointments.find((a) => a.id === id);
    if (["edit", "confirmation"].includes(page) && !appointment)
      return res.status(404).send("Appointment not found.");
    return res.render("layout", {
      page,
      ws,
      appointment,
      notice: req.query.saved ? "Your changes are saved." : res.locals.notice,
    });
  }
  app.get("/", render);
  app.use((req, res) => res.status(404).send("Not found."));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = [413, 429].includes(err.status) ? err.status : 503;
    res
      .status(status)
      .type("text")
      .send(
        status === 413
          ? "Form too large."
          : "The demo is temporarily unavailable. Please try again.",
      );
  });
  return app;
}
module.exports = createApp;
