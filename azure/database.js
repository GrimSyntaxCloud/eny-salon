const { MongoClient } = require("mongodb");
const { Store } = require("../lib/store");
let pending;
async function connect() {
  if (!pending)
    pending = (async () => {
      if (!process.env.MONGODB_URI)
        throw new Error("Database configuration missing.");
      const client = new MongoClient(process.env.MONGODB_URI, {
        retryWrites: false,
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: 5,
      });
      await client.connect();
      const db = client.db(process.env.MONGODB_DATABASE || "portfolio-demos");
      return { client, db, store: new Store(db.collection("eny_demo")) };
    })().catch((e) => {
      pending = undefined;
      throw e;
    });
  return pending;
}
module.exports = { connect };
