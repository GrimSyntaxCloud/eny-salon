const serverless = require("serverless-http");
const { connect } = require("./database");
let pending,
  lastCleanup = 0;
function createHandler(app) {
  const wrapped = serverless(app, {
    provider: "azure",
    request: (req) => {
      // Azure's adapter creates an own undefined `ip` property. Let Express
      // resolve its trusted final proxy hop instead, including IPv6 clients.
      delete req.ip;
      req.socket.remoteAddress = "127.0.0.1";
    },
  });
  return async (request) => {
    try {
      const rawBody = Buffer.from(await request.arrayBuffer());
      if (rawBody.length > 12288)
        return { status: 413, body: "Form too large." };
      const url = new URL(request.url);
      const path =
        request.params.path === "home" ? "" : request.params.path || "";
      const result = await wrapped(
        { log: () => {} },
        {
          method: request.method,
          url: "/" + path,
          query: Object.fromEntries(url.searchParams),
          headers: Object.fromEntries(request.headers),
          rawBody,
        },
      );
      return {
        status: result.status,
        headers: result.headers,
        body: result.isBase64Encoded
          ? Buffer.from(result.body, "base64")
          : result.body,
      };
    } catch {
      return {
        status: 503,
        headers: { "Cache-Control": "no-store" },
        body: "The demo is temporarily unavailable.",
      };
    }
  };
}
async function site(request) {
  if (process.env.DEMO_MAINTENANCE === "true")
    return {
      status: 503,
      headers: { "Retry-After": "120" },
      body: "The demo is briefly unavailable for maintenance.",
    };
  try {
    if (!pending)
      pending = (async () => {
        const { store } = await connect();
        return createHandler(
          require("../app")({
            store,
            secret: process.env.SESSION_SECRET,
            secure: true,
          }),
        );
      })().catch((e) => {
        pending = undefined;
        throw e;
      });
    const handler = await pending;
    if (Date.now() - lastCleanup > 300000) {
      await (await connect()).store.cleanup();
      lastCleanup = Date.now();
    }
    return handler(request);
  } catch {
    return { status: 503, body: "The demo is temporarily unavailable." };
  }
}
async function health() {
  try {
    const { db } = await connect();
    await db.command({ ping: 1 });
    return {
      jsonBody: {
        status: "ok",
        database: "connected",
        runtime: "Node.js",
        retentionHours: 96,
      },
    };
  } catch {
    return { status: 503, jsonBody: { status: "unavailable" } };
  }
}
module.exports = { site, health, createHandler };
