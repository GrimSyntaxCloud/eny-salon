const { connect } = require("./azure/database");
connect()
  .then(({ store }) =>
    require("./app")({
      store,
      secret: process.env.SESSION_SECRET,
      secure: process.env.NODE_ENV === "production",
    }).listen(Number(process.env.PORT || 4360), "127.0.0.1", () =>
      console.log("Eny local preview ready."),
    ),
  )
  .catch(() => {
    console.error("Unable to start. Check local environment configuration.");
    process.exitCode = 1;
  });
