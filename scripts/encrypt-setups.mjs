// Encrypts the Setup manager advice so the public site never holds it readable.
//
//   SETUP_KEY=<base64, 32 bytes> node scripts/encrypt-setups.mjs IN.json OUT.enc
//
// AES-GCM with a fresh IV. The key is only handed out by the staff server after
// GreMi logs in with Discord (staff/app.py in race-control-stats, /setup-login);
// the Setup manager page decrypts in the browser. Without SETUP_KEY nothing is
// written and the page says it isn't set up.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [input, output] = process.argv.slice(2);
const keyB64 = (process.env.SETUP_KEY || "").trim();
if (!keyB64) {
  console.log("SETUP_KEY not set: Setup manager data left out");
  process.exit(0);
}
const raw = Buffer.from(keyB64, "base64");
if (raw.length !== 32) {
  console.error("SETUP_KEY must be 32 bytes in base64");
  process.exit(1);
}
const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
const iv = crypto.getRandomValues(new Uint8Array(12));
const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, readFileSync(input));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({
  v: 1,
  iv: Buffer.from(iv).toString("base64"),
  data: Buffer.from(data).toString("base64"),
}));
console.log(`encrypted setup advice -> ${output}`);
