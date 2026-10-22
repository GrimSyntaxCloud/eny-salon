if (process.env.ALLOW_SCHEMA_PREPARE !== "true") {
  console.error(
    "Requires explicit ALLOW_SCHEMA_PREPARE=true after backup and capacity approval.",
  );
  process.exit(1);
}
require("../azure/database")
  .connect()
  .then(async ({ store, client }) => {
    try {
      await store.prepare();
      console.log("Eny indexes and immutable fictional seed prepared.");
    } finally {
      await client.close();
    }
  })
  .catch(() => {
    console.error("Database preparation failed. No connection details logged.");
    process.exitCode = 1;
  });
