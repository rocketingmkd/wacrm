import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const EMAIL_OTP_TYPES = [
  "recovery",
  "signup",
  "invite",
  "magiclink",
  "email_change",
  "email",
] as const;
type EmailOtpType = (typeof EMAIL_OTP_TYPES)[number];

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return !!value && (EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

// GoTrue redirects here after the user clicks the link in a recovery /
// invite / magic-link email. Two link shapes reach this handler
// depending on which flow issued the token: PKCE sends `?code=`, the
// older verify-otp shape sends `?token_hash=&type=`. Both are handled
// so the callback works regardless of which the email template used.
export async function GET(request: Request) {
  const { searchParams, origin: requestOrigin } = new URL(request.url);
  // `request.url`'s origin reflects whatever Host the Node process sees,
  // which behind this Traefik + Next.js-standalone setup resolves to the
  // container's own bind address (0.0.0.0:3000) rather than the public
  // domain. NEXT_PUBLIC_SITE_URL is the trusted value for building
  // redirect URLs; only fall back to the request origin if it's unset.
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? requestOrigin;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next") ?? "/dashboard";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  } else if (tokenHash && isEmailOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
