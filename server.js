const http = require("http");
const port = process.env.PORT || 8080;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    app: "webrunner-beta-test",
    node: process.version,
    testVar: process.env.WR_TEST_VAR || null,
    startedAt: startedAt
  }, null, 2));
}).listen(port, () => console.log(`webrunner-beta-test listening on ${port}, node ${process.version}`));
const startedAt = new Date().toISOString();
