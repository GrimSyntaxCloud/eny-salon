if (process.env.DEMO_MAINTENANCE === "true") process.exit(0);
require("../azure/database")
  .connect()
  .then(async ({ store, client }) => {
    try {
      console.log(JSON.stringify(await store.cleanup()));
    } finally {
      await client.close();
    }
  })
  .catch(() => {
    console.error("Cleanup failed. No private details logged.");
    process.exitCode = 1;
  });
