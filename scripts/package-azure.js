const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
fs.rmSync("release", { recursive: true, force: true });
fs.mkdirSync("release/api", { recursive: true });
fs.cpSync("public", "release/site", { recursive: true });
fs.copyFileSync(
  "staticwebapp.config.json",
  "release/site/staticwebapp.config.json",
);
fs.writeFileSync(
  "release/site/index.html",
  '<!doctype html><title>Eny Salon</title><p><a href="/api/site/home">Open Eny Salon</a></p>',
);
for (const path of [
  "app.js",
  "lib",
  "views",
  "azure",
  "host.json",
  "package.json",
  "package-lock.json",
])
  fs.cpSync(path, "release/api/" + path, { recursive: true });
const pkg = JSON.parse(fs.readFileSync("release/api/package.json"));
pkg.main = "azure/functions.js";
pkg.engines = { node: "22.x" };
delete pkg.scripts;
delete pkg.devDependencies;
fs.writeFileSync("release/api/package.json", JSON.stringify(pkg, null, 2));
execFileSync(
  "npm",
  ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
  { cwd: "release/api", stdio: "inherit" },
);
execFileSync("zip", ["-qr", "../eny-salon.zip", "."], { cwd: "release" });
