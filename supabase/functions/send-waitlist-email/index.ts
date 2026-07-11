// Supabase Edge Function: send-waitlist-email
//
// Triggered by a Database Webhook on INSERT into public.waitlist.
// Sends a "you're in" email via Resend, with a signed unsubscribe link.
//
// Required secrets (set via Dashboard > Edge Functions > send-waitlist-email > Secrets,
// or `supabase secrets set` if you ever wire up the CLI):
//   RESEND_API_KEY       - from resend.com
//   UNSUBSCRIBE_SECRET    - any long random string, used to sign unsubscribe links
//   WEBHOOK_SECRET        - any long random string, must match the header set on the
//                           Database Webhook so randoms on the internet can't trigger sends
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by Supabase,
// you do not need to set those yourself.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const UNSUBSCRIBE_SECRET = Deno.env.get("UNSUBSCRIBE_SECRET")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Where the unsubscribe Edge Function lives. Update if you put it behind a custom domain.
const UNSUBSCRIBE_BASE_URL = `${SUPABASE_URL}/functions/v1/unsubscribe`;

const FROM_ADDRESS = "Minary <contact@minary.app>"; // must be on a domain verified in Resend
const TEMPLATE_ID = "minary-waitlist"; // Resend template alias, from the Templates dashboard

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

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json();
  const record = payload.record;
  const email: string | undefined = record?.email;

  if (!email) {
    return new Response("No email in payload", { status: 400 });
  }
  if (record.unsubscribed || record.welcome_email_sent_at) {
    // Already handled (or a re-delivered webhook) — nothing to do.
    return new Response("Skipped", { status: 200 });
  }

  const token = await signToken(email);
  const unsubscribeUrl = `${UNSUBSCRIBE_BASE_URL}?email=${encodeURIComponent(email)}&token=${token}`;

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: email,
      template: {
        id: TEMPLATE_ID,
        variables: { UNSUBSCRIBE_URL: unsubscribeUrl },
      },
    }),
  });

  if (!resendRes.ok) {
    const detail = await resendRes.text();
    console.error("Resend error:", detail);
    return new Response("Failed to send email", { status: 502 });
  }

  // Mark as sent so a re-delivered webhook doesn't send a second email.
  await fetch(`${SUPABASE_URL}/rest/v1/waitlist?email=eq.${encodeURIComponent(email)}`, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ welcome_email_sent_at: new Date().toISOString() }),
  });

  return new Response("OK", { status: 200 });
});
