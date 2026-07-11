// Supabase Edge Function: unsubscribe
//
// Public GET endpoint linked from the waitlist email. Verifies the signed
// token so people can only unsubscribe their own address, marks the row as
// unsubscribed, then redirects to a branded confirmation page on the
// landing site instead of rendering HTML itself.
//
// Required secrets (must match send-waitlist-email):
//   UNSUBSCRIBE_SECRET
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

const UNSUBSCRIBE_SECRET = Deno.env.get("UNSUBSCRIBE_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CONFIRMATION_URL = "https://www.minary.app/unsubscribed.html";

async function signToken(email: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(UNSUBSCRIBE_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const email = url.searchParams.get("email");
  const token = url.searchParams.get("token");

  if (!email || !token) {
    return redirect(CONFIRMATION_URL);
  }

  const expected = await signToken(email);
  if (token !== expected) {
    return redirect(CONFIRMATION_URL);
  }

  await fetch(`${SUPABASE_URL}/rest/v1/waitlist?email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ unsubscribed: true }),
  });

  return redirect(CONFIRMATION_URL);
});
