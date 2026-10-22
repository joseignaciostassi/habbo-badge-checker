import { describe, expect, it } from "vitest";
import { classifyDbError } from "../src/data/setup";

describe("database setup", () => {
  it("a missing database is not a connection failure", () => {
    expect(classifyDbError({ code: "3D000", message: 'database "x" does not exist' })).toEqual({ state: "missing" });
  });

  it("connection failures get a readable reason", () => {
    expect(classifyDbError({ code: "ECONNREFUSED", message: "connect ECONNREFUSED 127.0.0.1:5432" })).toEqual({
      state: "unreachable",
      error: "PostgreSQL no responde en esa dirección.",
    });
    expect(classifyDbError({ code: "28P01" })).toMatchObject({ error: "Usuario o contraseña incorrectos." });
    expect(classifyDbError(new Error("algo raro"))).toEqual({ state: "unreachable", error: "algo raro" });
  });
});
