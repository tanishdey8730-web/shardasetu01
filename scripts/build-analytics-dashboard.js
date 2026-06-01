const esbuild = require("esbuild");
const path = require("path");

esbuild
  .build({
    entryPoints: [path.join(__dirname, "..", "analytics-dashboard-src", "index.jsx")],
    bundle: true,
    outfile: path.join(__dirname, "..", "analytics-dashboard.bundle.js"),
    format: "iife",
    globalName: "ShardaAnalyticsDashboard",
    jsx: "automatic",
    loader: { ".jsx": "jsx" },
    minify: true,
    sourcemap: false,
    define: {
      "process.env.NODE_ENV": '"production"'
    }
  })
  .then(() => {
    console.log("Built analytics-dashboard.bundle.js");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
