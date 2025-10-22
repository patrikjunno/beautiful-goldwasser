const { execSync } = require("child_process");
const fs = require("fs");

function run(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

const sha = run("git rev-parse --short HEAD");
const time = new Date().toISOString();

process.env.REACT_APP_COMMIT_SHA = sha;
process.env.REACT_APP_BUILD_TIME = time;

// skriv till .env.build för transparens
fs.writeFileSync(
  ".env.build",
  `REACT_APP_COMMIT_SHA=${sha}\nREACT_APP_BUILD_TIME=${time}\n`
);

console.log(`[build-env] commit=${sha} time=${time}`);
