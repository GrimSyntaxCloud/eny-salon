const { MongoMemoryServer } = require("mongodb-memory-server");
const { MongoClient } = require("mongodb");
const { Store } = require("../lib/store");
const { random } = require("../lib/security");
(async () => {
  const mongo = await MongoMemoryServer.create({
    binary: process.env.MONGOMS_SYSTEM_BINARY
      ? { systemBinary: process.env.MONGOMS_SYSTEM_BINARY }
      : undefined,
  });
  const client = await new MongoClient(mongo.getUri()).connect();
  const store = new Store(client.db("eny-local").collection("eny_demo"));
  await store.prepare();
  const port = Number(process.env.PORT || 4360);
  const server = require("../app")({ store, secret: random() }).listen(
    port,
    "127.0.0.1",
    () =>
      console.log(`Eny hosted edition local preview: http://127.0.0.1:${port}`),
  );
  const stop = async () => {
    server.close();
    await client.close();
    await mongo.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
})().catch(() => {
  console.error("Local preview failed.");
  process.exitCode = 1;
});
