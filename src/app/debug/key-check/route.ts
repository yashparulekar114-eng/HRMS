import { NextResponse } from "next/server";

// TEMPORARY (checkpoint 3 only). Removed in checkpoint 4 with the other test objects.
// Diagnoses why Clerk rejects CLERK_SECRET_KEY. It returns only yes/no flags, the length,
// and Clerk's HTTP status and instance ID. It never returns, logs or echoes any character
// of the key.
export const dynamic = "force-dynamic";

const EXPECTED_INSTANCE = "ins_3LKyJXl8bK477FSdiR5IWYUYR61"; // Konkan People, development
const EXPECTED_FRONTEND_API = "major-goblin-73.clerk.accounts.dev";

function frontendApiFromPublishableKey(pk: string | undefined): string | null {
  if (!pk) return null;
  const encoded = pk.replace(/^pk_(test|live)_/, "");
  try {
    return Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
  } catch {
    return null;
  }
}

async function clerkStatus(path: string, key: string) {
  try {
    const res = await fetch(`https://api.clerk.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    let instanceId: string | null = null;
    let environment: string | null = null;
    let clerkErrorCode: string | null = null;
    const body = await res.json().catch(() => null);
    if (res.ok && body && path === "instance") {
      instanceId = typeof body.id === "string" ? body.id : null;
      environment = typeof body.environment_type === "string" ? body.environment_type : null;
    }
    if (!res.ok && body?.errors?.[0]?.code) clerkErrorCode = String(body.errors[0].code);
    return { httpStatus: res.status, instanceId, environment, clerkErrorCode };
  } catch {
    return { httpStatus: null, instanceId: null, environment: null, clerkErrorCode: "request_failed" };
  }
}

export async function GET() {
  const raw = process.env.CLERK_SECRET_KEY;
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const frontendApi = frontendApiFromPublishableKey(pk);

  if (!raw) {
    return NextResponse.json({ secretKeyPresent: false }, { headers: { "Cache-Control": "no-store" } });
  }

  const format = {
    secretKeyPresent: true,
    length: raw.length,
    startsWithSkTest: raw.startsWith("sk_test_"),
    startsWithSkLive: raw.startsWith("sk_live_"),
    startsWithPkInstead: raw.startsWith("pk_"),
    containsVariableName: raw.includes("CLERK_SECRET_KEY"),
    containsEqualsSign: raw.includes("="),
    containsQuotes: /["'`]/.test(raw),
    containsWhitespace: /\s/.test(raw),
    containsNonAscii: /[^\x20-\x7E]/.test(raw),
    matchesExpectedShape: /^sk_(test|live)_[A-Za-z0-9]{20,}$/.test(raw),
  };

  const jwks = await clerkStatus("jwks", raw);
  const instance = await clerkStatus("instance", raw);

  return NextResponse.json(
    {
      format,
      clerk: {
        jwksHttpStatus: jwks.httpStatus,
        jwksErrorCode: jwks.clerkErrorCode,
        instanceHttpStatus: instance.httpStatus,
        instanceErrorCode: instance.clerkErrorCode,
        instanceId: instance.instanceId,
        instanceEnvironment: instance.environment,
        matchesKonkanPeopleInstance: instance.instanceId === EXPECTED_INSTANCE,
      },
      publishableKey: {
        frontendApi,
        matchesKonkanPeople: frontendApi === EXPECTED_FRONTEND_API,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
