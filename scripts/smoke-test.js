const fs = require("fs");
const path = require("path");

async function run() {
  const root = process.cwd();
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const controller = fs.readFileSync(path.join(root, "controller.html"), "utf8");
  const bridge = fs.readFileSync(path.join(root, "phone-bridge.js"), "utf8");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

  if (!index.includes('src="./config.js"')) throw new Error("index.html missing runtime config script.");
  if (!app.includes("window.__ROUTE_REHEARSAL_CONFIG__")) throw new Error("app.js missing runtime config usage.");
  if (!server.includes('requestPath === "/config.js"')) throw new Error("server.js missing /config.js endpoint.");
  if (!controller.includes("location.protocol === \"https:\" ? \"wss\" : \"ws\"")) throw new Error("controller.html missing ws/wss protocol logic.");
  if (!bridge.includes("location.protocol === \"https:\" ? \"wss\" : \"ws\"")) throw new Error("phone-bridge.js missing ws/wss protocol logic.");

  console.log("Smoke test passed.");
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
