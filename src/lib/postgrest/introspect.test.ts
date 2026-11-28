import { describe, expect, it } from "vitest";
import { pgCastTarget, type IntrospectedColumn } from "./introspect";

function column(dataType: string, udtName: string): IntrospectedColumn {
  return { name: "value", dataType, udtName, nullable: true };
}

describe("pgCastTarget — PostgreSQL exact type names", () => {
  it('quotes Prisma CamelCase enum types instead of folding them to lowercase', () => {
    expect(pgCastTarget(column("USER-DEFINED", "TrustLevel"))).toBe('"TrustLevel"');
    expect(pgCastTarget(column("USER-DEFINED", "Tariff"))).toBe('"Tariff"');
    expect(pgCastTarget(column("USER-DEFINED", "UserRole"))).toBe('"UserRole"');
  });

  it("keeps lowercase Postgres enum and domain names compatible", () => {
    expect(pgCastTarget(column("USER-DEFINED", "user_role"))).toBe("user_role");
    expect(pgCastTarget(column("USER-DEFINED", "account_type"))).toBe("account_type");
  });

  it("quotes CamelCase enum element names in arrays", () => {
    expect(pgCastTarget(column("ARRAY", "_TrustLevel"))).toBe('"TrustLevel"[]');
    expect(pgCastTarget(column("ARRAY", "_Tariff"))).toBe('"Tariff"[]');
  });

  it("does not quote standard lowercase array element types", () => {
    expect(pgCastTarget(column("ARRAY", "_text"))).toBe("text[]");
    expect(pgCastTarget(column("ARRAY", "_uuid"))).toBe("uuid[]");
  });

  it("preserves supported built-in casts and leaves inferred scalar types alone", () => {
    expect(pgCastTarget(column("uuid", "uuid"))).toBe("uuid");
    expect(pgCastTarget(column("jsonb", "jsonb"))).toBe("jsonb");
    expect(pgCastTarget(column("text", "text"))).toBeNull();
    expect(pgCastTarget(column("integer", "int4"))).toBeNull();
  });
});
