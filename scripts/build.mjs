// Wraps artifact.html (the page source, also published on Claude) into public/index.html
// with the head tags a standalone site and iPhone home-screen app need.
// Run: node scripts/build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(new URL("../artifact.html", import.meta.url), "utf8");
const cut = src.indexOf("</style>") + "</style>".length;
const head = src.slice(0, cut);
const body = src.slice(cut).trimStart();

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Apt Hunt">
<meta name="format-detection" content="telephone=no">
<meta name="theme-color" content="#EDEFEA" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#101512" media="(prefers-color-scheme: dark)">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" href="/icon-192.png">
<link rel="manifest" href="/manifest.webmanifest">
<style>html,body{margin:0}[hidden]{display:none!important}</style>
${head}
</head>
<body>
${body}
</body>
</html>
`;
writeFileSync(new URL("../public/index.html", import.meta.url), html);
console.log("Wrote public/index.html");
