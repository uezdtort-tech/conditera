import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = mutableEnv.NODE_ENV;
const originalCi = mutableEnv.CI;
const originalShimFlag = mutableEnv.SUPABASE_LOCAL_SHIMS_ENABLED;

afterEach(() => {
  if (originalNodeEnv === undefined) delete mutableEnv.NODE_ENV;
  else mutableEnv.NODE_ENV = originalNodeEnv;

  if (originalCi === undefined) delete mutableEnv.CI;
  else mutableEnv.CI = originalCi;

  if (originalShimFlag === undefined) delete mutableEnv.SUPABASE_LOCAL_SHIMS_ENABLED;
  else mutableEnv.SUPABASE_LOCAL_SHIMS_ENABLED = originalShimFlag;
});

describe("local Storage compatibility shim exposure", () => {
  it("is not exposed on a production origin by default", async () => {
    mutableEnv.NODE_ENV = "production";
    delete mutableEnv.CI;
    delete mutableEnv.SUPABASE_LOCAL_SHIMS_ENABLED;

    const request = new NextRequest(
      "http://localhost/storage/v1/object/public/avatars/user/photo.png"
    );
    const response = await GET(request, {
      params: Promise.resolve({
        path: ["object", "public", "avatars", "user", "photo.png"],
      }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "NOT_FOUND",
      message: "Storage endpoint not found",
    });
  });

  it("can be explicitly enabled only for CI integration tests", async () => {
    mutableEnv.NODE_ENV = "production";
    mutableEnv.CI = "true";
    mutableEnv.SUPABASE_LOCAL_SHIMS_ENABLED = "true";

    const request = new NextRequest("http://localhost/storage/v1/not-supported");
    const response = await GET(request, {
      params: Promise.resolve({ path: ["not-supported"] }),
    });

    expect(response.status).toBe(501);
  });
});
