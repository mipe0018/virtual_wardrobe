// One-off: mark an account as quota owner. Usage: node scripts/set-owner.mjs you@example.com [--remove]
// Reads PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env. Never prints secrets.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value.replace(/^["']|["']$/g, "")])
);
const email = process.argv[2]?.toLowerCase();
const remove = process.argv.includes("--remove");
if (!email) throw new Error("Pass the account email as the first argument.");

const admin = createClient(env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let user = null;
for (let page = 1; !user && page <= 20; page += 1) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  user = data.users.find((candidate) => candidate.email?.toLowerCase() === email) ?? null;
  if (data.users.length < 200) break;
}
if (!user) throw new Error("No account with that email was found.");
const { error } = await admin.auth.admin.updateUserById(user.id, {
  app_metadata: { ...user.app_metadata, is_owner: remove ? false : true },
});
if (error) throw error;
console.log(remove ? "Owner flag removed." : "Owner flag set. Log out and in again to refresh the token.");
