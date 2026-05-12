#!/usr/bin/env node
// Reads <slug>/appcast.xml from the vendo-appcasts R2 bucket via the S3
// API, prepends a new <item> derived from the args, PUTs the new XML back.
// Atomic at the R2 key level: readers see either the full old or full new XML.

import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const ARGS = parseArgs(process.argv.slice(2));
const required = ["slug", "version", "build-number", "min-os-version",
  "dmg-url", "sparkle-signature", "length", "title", "pub-date"];
for (const k of required) {
  if (!ARGS[k]) { console.error(`missing --${k}`); process.exit(2); }
}

const ACCOUNT_ID = mustEnv("APPCAST_R2_ACCOUNT_ID");
const ACCESS_KEY = mustEnv("APPCAST_R2_ACCESS_KEY_ID");
const SECRET_KEY = mustEnv("APPCAST_R2_SECRET_ACCESS_KEY");
const BUCKET = "vendo-appcasts";
const HOST = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
const KEY = `${ARGS.slug}/appcast.xml`;

const releaseNotes = ARGS["release-notes-path"]
  ? readFileSync(ARGS["release-notes-path"], "utf8")
  : "";

const existing = await getObject(KEY);
const baseXml = existing ?? emptyAppcast(ARGS.title);
const newXml = prependItem(baseXml, {
  title: ARGS.version,
  version: ARGS["build-number"],
  shortVersionString: ARGS.version,
  minOsVersion: ARGS["min-os-version"],
  url: ARGS["dmg-url"],
  signature: ARGS["sparkle-signature"],
  length: ARGS.length,
  pubDate: ARGS["pub-date"],
  description: releaseNotes,
});
await putObject(KEY, newXml);
console.log(`Appcast updated: ${KEY}`);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1], i++;
  }
  return out;
}
function mustEnv(k) {
  if (!process.env[k]) { console.error(`missing env ${k}`); process.exit(2); }
  return process.env[k];
}

function emptyAppcast(title) {
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>${escapeXml(title)}</title>
  </channel>
</rss>
`;
}

function prependItem(xml, it) {
  // Any literal "]]>" inside release notes would close the CDATA early and let
  // attacker-controlled content escape into the appcast. Split it across two
  // CDATA sections using the standard recipe.
  const safeDescription = it.description.replace(/\]\]>/g, "]]]]><![CDATA[>");
  const item = `    <item>
      <title>${escapeXml(it.title)}</title>
      <pubDate>${escapeXml(it.pubDate)}</pubDate>
      <sparkle:version>${escapeXml(it.version)}</sparkle:version>
      <sparkle:shortVersionString>${escapeXml(it.shortVersionString)}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>${escapeXml(it.minOsVersion)}</sparkle:minimumSystemVersion>
      ${it.description ? `<description><![CDATA[${safeDescription}]]></description>` : ""}
      <enclosure url="${escapeXml(it.url)}" sparkle:edSignature="${escapeXml(it.signature)}" length="${escapeXml(String(it.length))}" type="application/octet-stream"/>
    </item>
`;
  const result = xml.replace(/(<channel>[\s\S]*?<\/title>\s*)/, `$1\n${item}`);
  if (result === xml) {
    throw new Error("appcast template did not match expected shape; refusing to write");
  }
  return result;
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, c => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
  }[c]));
}

async function getObject(key) {
  const res = await s3Request("GET", key);
  if (res.status === 404) return null;
  if (!res.ok) { console.error("GET failed", res.status, await res.text()); process.exit(1); }
  return await res.text();
}

async function putObject(key, body) {
  const res = await s3Request("PUT", key, body, "application/rss+xml");
  if (!res.ok) { console.error("PUT failed", res.status, await res.text()); process.exit(1); }
}

async function s3Request(method, key, body = "", contentType = "") {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const region = "auto";
  const service = "s3";

  const payloadHash = createHash("sha256").update(body).digest("hex");
  const canonicalUri = '/' + [BUCKET, ...key.split('/')].map(encodeURIComponent).join('/');
  const canonicalQuery = "";
  const headers = {
    host: HOST,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(contentType ? { "content-type": contentType } : {}),
  };
  const canonicalHeaders = Object.entries(headers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}\n`).join("");
  const signedHeaders = Object.keys(headers).sort().join(";");

  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex")].join("\n");

  let signingKey = createHmac("sha256", `AWS4${SECRET_KEY}`).update(dateStamp).digest();
  signingKey = createHmac("sha256", signingKey).update(region).digest();
  signingKey = createHmac("sha256", signingKey).update(service).digest();
  signingKey = createHmac("sha256", signingKey).update("aws4_request").digest();
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const authHeader = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return fetch(`https://${HOST}${canonicalUri}`, {
    method, headers: { ...headers, authorization: authHeader },
    body: method === "PUT" ? body : undefined,
  });
}
