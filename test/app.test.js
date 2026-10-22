const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { MongoClient } = require("mongodb");
const request = require("supertest");
const createApp = require("../app");
const { Store } = require("../lib/store");
const { random, sha } = require("../lib/security");
const { RETENTION_MS, available } = require("../lib/domain");
let mongo, client, collection, store, app, clock;
before(async () => {
  mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY, version: "8.2.6" }
      : undefined,
  });
  client = await new MongoClient(mongo.getUri()).connect();
  collection = client.db("eny-tests").collection("eny_demo");
});
after(async () => {
  await client?.close();
  await mongo?.stop();
});
beforeEach(async () => {
  await collection.deleteMany({});
  clock = new Date();
  store = new Store(collection, { now: () => clock });
  await store.prepare();
  app = createApp({ store, secret: random() });
});
const csrf = (html) => /name="csrf" value="([a-f0-9]+)"/.exec(html)[1];
async function start(agent) {
  const page = await agent.get("/?page=login");
  await agent
    .post("/?page=login")
    .type("form")
    .send({ csrf: csrf(page.text), action: "start" })
    .expect(303);
  return agent.get("/?page=admin").expect(200);
}
const details = {
  name: "O'Neil <script>bad</script>",
  email: "guest@example.test",
  address: "1 Fictional Way",
  city: "Sample City",
  state: "IL",
  zip: "60000",
  service: "Haircut",
  extras: "Shampoo",
};
async function book(agent, patch = {}) {
  const page = await agent.get("/?page=book");
  const slot = /option value="(\d{4}-[^\"]+)"/.exec(page.text)[1];
  return agent
    .post("/?page=book")
    .type("form")
    .send({
      csrf: csrf(page.text),
      action: "book",
      slot,
      ...details,
      ...patch,
    });
}
test("all public views render with security headers and private storage paths return404", async () => {
  for (const page of [
    "home",
    "about",
    "services",
    "book",
    "contact",
    "login",
  ]) {
    const r = await request(app)
      .get("/?page=" + page)
      .expect(200);
    assert.match(
      r.headers["content-security-policy"],
      /frame-ancestors 'none'/,
    );
    assert.equal(r.headers["cache-control"], "no-store");
  }
  await request(app).get("/storage/salon.sqlite").expect(404);
  await request(app).get("/?page=missing").expect(404);
});
test("CSRF and cross-site writes are rejected before creating records", async () => {
  const a = request.agent(app);
  const page = await a.get("/?page=login");
  await a
    .post("/")
    .type("form")
    .send({ action: "start", csrf: "bad" })
    .expect(403);
  await a
    .post("/")
    .set("Sec-Fetch-Site", "cross-site")
    .type("form")
    .send({ action: "start", csrf: csrf(page.text) })
    .expect(403);
  assert.equal(await collection.countDocuments({ kind: "workspace" }), 0);
});
test("private workspace button uses durable hashed session, no global public password", async () => {
  const a = request.agent(app);
  const page = await start(a);
  assert.match(page.text, /PRIVATE DEMO/);
  const session = await collection.findOne({ kind: "session" });
  assert.match(session._id, /^session:[a-f0-9]{64}$/);
  assert.ok(session.expiresAt > clock);
  assert.equal(await collection.countDocuments({ kind: "workspace" }), 1);
});
test("booking persists, confirmation escapes text, message stays unsent in outbox", async () => {
  const a = request.agent(app);
  const result = await book(a);
  assert.equal(result.status, 303);
  const page = await a.get(result.headers.location).expect(200);
  assert.match(page.text, /You’re booked/);
  assert.match(page.text, /&lt;script&gt;/);
  const ws = await collection.findOne({ kind: "workspace" });
  assert.equal(ws.appointments.length, 2);
  assert.equal(ws.outbox.length, 1);
  assert.equal(ws.appointments[1].service, "Haircut");
  assert.match(page.text, /No email was sent/);
});
test("invalid customer values and extras never create workspace", async () => {
  const a = request.agent(app);
  await book(a, { email: "invalid" }).then((r) => assert.equal(r.status, 422));
  await book(a, { service: "Unpriced service" }).then((r) =>
    assert.equal(r.status, 422),
  );
  await book(a, { extras: "<script>" }).then((r) =>
    assert.equal(r.status, 422),
  );
  assert.equal(await collection.countDocuments({ kind: "workspace" }), 0);
});
test("concurrent booking of one slot has one winner", async () => {
  const a = request.agent(app);
  const html = await start(a);
  const ws = await collection.findOne({ kind: "workspace" });
  const slot = available(ws)[0];
  const body = { csrf: csrf(html.text), action: "book", slot, ...details };
  const results = await Promise.all([
    a.post("/?page=book").type("form").send(body),
    a.post("/?page=book").type("form").send(body),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [303, 422]);
  assert.equal(
    (await collection.findOne({ _id: ws._id })).appointments.filter(
      (x) => x.slot === slot,
    ).length,
    1,
  );
});
test("two visitors cannot read, edit or block each other’s records", async () => {
  const a = request.agent(app),
    b = request.agent(app);
  const result = await book(a);
  const id = new URL("http://local" + result.headers.location).searchParams.get(
    "id",
  );
  const page = await start(b);
  await b.get("/?page=confirmation&id=" + id).expect(404);
  const ws = await collection.findOne({
    kind: "workspace",
    "appointments.id": id,
  });
  await b
    .post("/?page=admin")
    .type("form")
    .send({
      csrf: csrf(page.text),
      action: "edit",
      id,
      slot: ws.appointments[1].slot,
      ...details,
      name: "Attacker",
    })
    .expect(404);
  assert.notEqual(
    (await collection.findOne({ _id: ws._id })).appointments[1].name,
    "Attacker",
  );
});
test("appointment edit/reschedule atomically frees old time; expiry never extends", async () => {
  const a = request.agent(app);
  const result = await book(a);
  const id = new URL("http://local" + result.headers.location).searchParams.get(
    "id",
  );
  const original = await collection.findOne({ kind: "workspace" });
  const old = original.appointments.find((x) => x.id === id).slot;
  const slot = available(original).at(-1);
  const page = await a.get("/?page=edit&id=" + id);
  clock = new Date(+clock + 3600000);
  await a
    .post("/?page=edit&id=" + id)
    .type("form")
    .send({
      csrf: csrf(page.text),
      action: "edit",
      id,
      slot,
      ...details,
      name: "Jamie Demo",
    })
    .expect(303);
  const updated = await collection.findOne({ _id: original._id });
  assert.equal(+updated.expiresAt, +original.expiresAt);
  assert.ok(available(updated, clock).includes(old));
  assert.equal(
    updated.appointments.find((x) => x.id === id).name,
    "Jamie Demo",
  );
});
test("availability blocks/reopens free slots, cannot reopen reserved ones", async () => {
  const a = request.agent(app);
  const page = await start(a);
  const ws = await collection.findOne({ kind: "workspace" });
  const slot = available(ws)[0];
  const body = { csrf: csrf(page.text), action: "availability", slot };
  await a.post("/?page=availability").type("form").send(body).expect(303);
  assert.ok((await collection.findOne({ _id: ws._id })).blocked.includes(slot));
  await a.post("/?page=availability").type("form").send(body).expect(303);
  await a
    .post("/?page=availability")
    .type("form")
    .send({ ...body, slot: ws.appointments[0].slot })
    .expect(422);
});
test("contact inbox is scoped, validated and escaped", async () => {
  const a = request.agent(app);
  const page = await a.get("/?page=contact");
  await a
    .post("/?page=contact")
    .type("form")
    .send({
      csrf: csrf(page.text),
      action: "contact",
      name: "Demo",
      email: "sample@example.test",
      message: "<img src=x onerror=bad>",
    })
    .expect(303);
  const inbox = await a.get("/?page=inbox").expect(200);
  assert.match(inbox.text, /&lt;img/);
  await request(app).get("/?page=inbox").expect(303);
});
test("private optional sign-in uses scrypt, survives logout without renewing expiry", async () => {
  const a = request.agent(app);
  const page = await start(a);
  await a
    .post("/?page=admin")
    .type("form")
    .send({
      csrf: csrf(page.text),
      action: "save-access",
      username: "my-demo",
      password: "UniqueDemoPassword123!",
    })
    .expect(303);
  const ws = await collection.findOne({ kind: "workspace" });
  assert.match(ws.passwordHash, /^scrypt:/);
  assert.notEqual(ws.passwordHash, "UniqueDemoPassword123!");
  await a
    .post("/")
    .type("form")
    .send({ csrf: csrf(page.text), action: "logout" })
    .expect(303);
  await a.get("/?page=admin").expect(303);
  const login = await a.get("/?page=login");
  await a
    .post("/?page=login")
    .type("form")
    .send({
      csrf: csrf(login.text),
      action: "login",
      username: "my-demo",
      password: "incorrect",
    })
    .expect(422);
  await a
    .post("/?page=login")
    .type("form")
    .send({
      csrf: csrf(login.text),
      action: "login",
      username: "my-demo",
      password: "UniqueDemoPassword123!",
    })
    .expect(303);
  assert.equal(
    +(await collection.findOne({ _id: ws._id })).expiresAt,
    +ws.expiresAt,
  );
});
test("username collision cannot take another workspace", async () => {
  const a = request.agent(app),
    b = request.agent(app);
  const pa = await start(a),
    pb = await start(b);
  for (const [agent, page, status] of [
    [a, pa, 303],
    [b, pb, 422],
  ])
    await agent
      .post("/?page=admin")
      .type("form")
      .send({
        csrf: csrf(page.text),
        action: "save-access",
        username: "same-name",
        password: "UniqueDemoPassword123!",
      })
      .expect(status);
  assert.equal(await collection.countDocuments({ kind: "username" }), 1);
  assert.equal(
    await collection.countDocuments({
      kind: "workspace",
      username: "same-name",
    }),
    1,
  );
});
test("96h expiry denies access immediately, sweep removes user records but preserves seed", async () => {
  const a = request.agent(app);
  await book(a);
  const ws = await collection.findOne({ kind: "workspace" });
  clock = new Date(+ws.expiresAt + 1);
  await a.get("/?page=admin").expect(303);
  assert.equal(await store.workspace(ws._id, ws.generation), null);
  await store.cleanup();
  assert.equal(await collection.countDocuments({ isDemo: false }), 0);
  assert.ok(await collection.findOne({ _id: "seed:salon:v1", isDemo: true }));
});
test("fixed workspace slots enforce capacity under concurrent creation", async () => {
  store.maxWorkspaces = 2;
  const result = await Promise.allSettled([
    store.createWorkspace(),
    store.createWorkspace(),
    store.createWorkspace(),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 2);
  assert.equal(await collection.countDocuments({ kind: "workspace" }), 2);
  clock = new Date(+clock + RETENTION_MS + 1);
  const ws = await store.createWorkspace();
  assert.ok(ws);
  assert.equal(await collection.countDocuments({ kind: "workspace" }), 2);
});
test("recycled slot cannot be accessed using an older generation", async () => {
  store.maxWorkspaces = 1;
  const old = await store.createWorkspace();
  clock = new Date(+clock + RETENTION_MS + 1);
  const next = await store.createWorkspace();
  assert.equal(old._id, next._id);
  assert.notEqual(old.generation, next.generation);
  assert.equal(await store.workspace(old._id, old.generation), null);
});
test("caps cannot be bypassed by posting client-controlled limits or expiry", async () => {
  const a = request.agent(app);
  const page = await start(a);
  const ws = await collection.findOne({ kind: "workspace" });
  await store.mutate(ws, (data) => {
    data.appointments = Array.from({ length: 50 }, (_, i) => ({
      ...data.appointments[0],
      id: String(i),
      slot: "2030-01-01 00:" + String(i).padStart(2, "0"),
    }));
  });
  const result = await book(a, {
    expiresAt: "2099-01-01",
    maxAppointments: 9999,
  });
  assert.equal(result.status, 429);
  assert.equal(
    +(await collection.findOne({ _id: ws._id })).expiresAt,
    +ws.expiresAt,
  );
});
test("hourly cleanup predicate protects unclassified and seeded records", async () => {
  await collection.insertMany([
    { _id: "legacy", expiresAt: new Date(0) },
    { _id: "sample", isDemo: true, expiresAt: new Date(0) },
    { _id: "expired", isDemo: false, expiresAt: new Date(0) },
  ]);
  await store.cleanup();
  assert.ok(await collection.findOne({ _id: "legacy" }));
  assert.ok(await collection.findOne({ _id: "sample" }));
  assert.equal(await collection.findOne({ _id: "expired" }), null);
});
test("oversized and unknown form actions are rejected", async () => {
  const a = request.agent(app);
  const page = await a.get("/?page=login");
  await a
    .post("/")
    .type("form")
    .send({ csrf: csrf(page.text), action: "erase-seeds" })
    .expect(400);
  await a
    .post("/")
    .type("form")
    .send({ body: "x".repeat(13000) })
    .expect(413);
});
test("password hashing refuses more than two concurrent jobs", async () => {
  const { hash } = require("../lib/security");
  const result = await Promise.allSettled([
    hash("AUniqueDemoPassword12!"),
    hash("AUniqueDemoPassword13!"),
    hash("AUniqueDemoPassword14!"),
  ]);
  assert.equal(result.filter((x) => x.status === "fulfilled").length, 2);
  assert.equal(result.find((x) => x.status === "rejected").reason.status, 429);
});
test("seed-only prepare does not need database DDL privilege", async () => {
  let writes = 0;
  const noDDL = {
    createIndex: () => {
      throw new Error("DDL forbidden");
    },
    updateOne: async () => {
      writes++;
    },
  };
  await new Store(noDDL).prepare({ indexes: false });
  assert.equal(writes, 1);
});

test("Azure adapter preserves query routes, CSRF cookies, form bodies and sessions", async () => {
  const handler = require("../azure/handler").createHandler(app);
  const call = async (method, query, body, cookie) => {
    const data = body ? new URLSearchParams(body).toString() : "";
    return handler({
      url: "https://demo.example/api/site/home" + query,
      params: { path: "home" },
      method,
      headers: new Headers({
        "x-forwarded-for": "192.0.2.1",
        ...(body
          ? {
              "content-type": "application/x-www-form-urlencoded",
              "content-length": String(Buffer.byteLength(data)),
            }
          : {}),
        ...(cookie ? { cookie } : {}),
      }),
      arrayBuffer: async () => Buffer.from(data),
    });
  };
  const page = await call("GET", "?page=login");
  assert.equal(page.status, 200);
  const cookie = String(page.headers["set-cookie"]).split(";")[0];
  assert.match(cookie, /eny_csrf=/);
  const result = await call(
    "POST",
    "?page=login",
    { csrf: csrf(page.body), action: "start" },
    cookie,
  );
  assert.equal(result.status, 303);
  const session = String(result.headers["set-cookie"]).split(";")[0];
  assert.match(session, /eny_session=/);
  const admin = await call("GET", "?page=admin", null, cookie + "; " + session);
  assert.equal(admin.status, 200);
  assert.match(admin.body, /Alex Rowan/);
});
