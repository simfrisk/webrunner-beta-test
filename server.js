const express = require("express");
const multer = require("multer");
const { Pool } = require("pg");
const Minio = require("minio");

const port = process.env.PORT || 8080;
const bucket = process.env.S3_BUCKET || "todo-files";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const s3url = new URL(process.env.S3_ENDPOINT || "http://localhost:9000");
const s3 = new Minio.Client({
  endPoint: s3url.hostname,
  port: Number(s3url.port) || (s3url.protocol === "https:" ? 443 : 80),
  useSSL: s3url.protocol === "https:",
  accessKey: process.env.S3_ACCESS_KEY,
  secretKey: process.env.S3_SECRET_KEY,
  pathStyle: true
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const app = express();
app.use(express.urlencoded({ extended: false }));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS todos (
    id SERIAL PRIMARY KEY,
    text TEXT NOT NULL,
    done BOOLEAN NOT NULL DEFAULT false,
    file_key TEXT,
    file_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  if (!(await s3.bucketExists(bucket))) await s3.makeBucket(bucket);
}

app.get("/", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT * FROM todos ORDER BY id");
    const items = rows.map((t) => `<li>
      <form method="post" action="/todos/${t.id}/toggle" style="display:inline"><button>${t.done ? "Undo" : "Done"}</button></form>
      <span style="${t.done ? "text-decoration:line-through;color:#888" : ""}">${esc(t.text)}</span>
      ${t.file_key ? `<a href="/files/${t.id}">${esc(t.file_name)}</a>` : ""}
      <form method="post" action="/todos/${t.id}/delete" style="display:inline"><button>Delete</button></form>
    </li>`).join("");
    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Beta to-do</title>
      <style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px}li{margin:8px 0}</style></head>
      <body><h1>Beta to-do</h1><p>Node ${process.version}, Postgres and MinIO on OSC.</p>
      <form method="post" action="/todos" enctype="multipart/form-data">
        <input name="text" required placeholder="What needs doing?"> <input type="file" name="file"> <button>Add</button>
      </form><ul>${items}</ul></body></html>`);
  } catch (e) { next(e); }
});

app.post("/todos", upload.single("file"), async (req, res, next) => {
  try {
    let key = null, name = null;
    if (req.file) {
      key = `${Date.now()}-${req.file.originalname.replace(/[^\w.-]/g, "_")}`;
      name = req.file.originalname;
      await s3.putObject(bucket, key, req.file.buffer, req.file.size, { "Content-Type": req.file.mimetype });
    }
    await pool.query("INSERT INTO todos (text, file_key, file_name) VALUES ($1, $2, $3)", [req.body.text, key, name]);
    res.redirect("/");
  } catch (e) { next(e); }
});

app.post("/todos/:id/toggle", async (req, res, next) => {
  try { await pool.query("UPDATE todos SET done = NOT done WHERE id = $1", [req.params.id]); res.redirect("/"); } catch (e) { next(e); }
});

app.post("/todos/:id/delete", async (req, res, next) => {
  try {
    const { rows } = await pool.query("DELETE FROM todos WHERE id = $1 RETURNING file_key", [req.params.id]);
    if (rows[0] && rows[0].file_key) await s3.removeObject(bucket, rows[0].file_key);
    res.redirect("/");
  } catch (e) { next(e); }
});

app.get("/files/:id", async (req, res, next) => {
  try {
    const { rows } = await pool.query("SELECT file_key, file_name FROM todos WHERE id = $1", [req.params.id]);
    if (!rows[0] || !rows[0].file_key) return res.sendStatus(404);
    res.attachment(rows[0].file_name);
    (await s3.getObject(bucket, rows[0].file_key)).pipe(res);
  } catch (e) { next(e); }
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    await s3.bucketExists(bucket);
    res.json({ ok: true, node: process.version });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.use((err, req, res, next) => { console.error(err); res.status(500).send("Something went wrong"); });

init()
  .then(() => app.listen(port, () => console.log(`beta to-do listening on ${port}, node ${process.version}`)))
  .catch((e) => { console.error("startup failed:", e.message); process.exit(1); });
