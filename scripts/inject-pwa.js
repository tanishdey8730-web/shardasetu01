/**
 * Inject PWA meta tags and scripts into all root HTML pages.
 * Run: node scripts/inject-pwa.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MARKER = "pwa.css";
const SNIPPET = `
  <meta name="theme-color" content="#1a237e" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta name="apple-mobile-web-app-title" content="Sharda Setu" />
  <link rel="manifest" href="manifest.webmanifest" />
  <link rel="apple-touch-icon" href="assets/icons/icon-192.svg" />
  <link rel="stylesheet" href="pwa.css" />
`;

const SCRIPT = `  <script src="pwa.js" defer></script>\n`;

const SKIP = new Set(["pwa-offline.html"]);

const files = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && !SKIP.has(f));

let updated = 0;
for (const file of files) {
  const fp = path.join(ROOT, file);
  let html = fs.readFileSync(fp, "utf8");
  if (html.includes(MARKER)) continue;

  if (html.includes("</head>")) {
    html = html.replace("</head>", `${SNIPPET}</head>`);
  }
  if (html.includes("</body>") && !html.includes('src="pwa.js"')) {
    html = html.replace("</body>", `${SCRIPT}</body>`);
  }
  fs.writeFileSync(fp, html, "utf8");
  updated += 1;
  console.log("Updated", file);
}

console.log(`Done. ${updated} file(s) updated.`);
