import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const env = process.env as Record<string, string | undefined>;
const originalNodeEnv = env.NODE_ENV;
const originalCi = env.CI;
const originalShimFlag = env.SUPABASE_LOCAL_SHIMS_ENABLED;

afterEach(() => {
  if (originalNodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = originalNodeEnv;
  if (originalCi === undefined) delete env.CI;
  else env.CI = originalCi;
  if (originalShimFlag === undefined) delete env.SUPABASE_LOCAL_SHIMS_ENABLED;
  else env.SUPABASE_LOCAL_SHIMS_ENABLED = originalShimFlag;
});

describe("local PostgREST compatibility shim exposure", () => {
  it("is not exposed on a production origin", async () => {
    env.NODE_ENV = "production";
    delete env.CI;
    delete env.SUPABASE_LOCAL_SHIMS_ENABLED;

    const request = new NextRequest("http://localhost/rest/v1/profiles");
    const response = await GET(request, {
      params: Promise.resolve({ path: ["profiles"] }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "NOT_FOUND",
      message: "Endpoint not found",
    });
  });
});
