import { describe, expect, it } from "vitest";
import { sniffFormat, uploadProblem } from "../src/core/uploadRules";

const bytes = (...b: (number | string)[]) =>
  Uint8Array.from(b.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])));

describe("upload rules", () => {
  it("sniffs GIF and PNG from content, nothing else", () => {
    expect(sniffFormat(bytes("GIF89a", 0, 0))).toBe("gif");
    expect(sniffFormat(bytes("GIF87a"))).toBe("gif");
    expect(sniffFormat(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))).toBe("png");
    expect(sniffFormat(bytes(0xff, 0xd8, 0xff, 0xe0))).toBeNull(); // JPEG
    expect(sniffFormat(bytes("RIFF", 0, 0))).toBeNull(); // WebP
  });

  it("accepts a normal badge, including a PNG named .gif", () => {
    expect(uploadProblem({ name: "UK235.gif", size: 1500, format: "png", width: 40, height: 40 })).toBeNull();
    expect(uploadProblem({ name: "X.PNG", size: 200 * 1024, format: "png", width: 50, height: 50 })).toBeNull();
  });

  it("rejects other extensions, heavy files, other formats and big images", () => {
    expect(uploadProblem({ name: "a.jpg", size: 10 })).toMatch(/\.gif o \.png/);
    expect(uploadProblem({ name: "noext", size: 10 })).toMatch(/\.gif o \.png/);
    expect(uploadProblem({ name: "a.gif", size: 200 * 1024 + 1 })).toMatch(/máximo es 200 KB/);
    expect(uploadProblem({ name: "a.gif", size: 10, format: null })).toMatch(/no es un GIF ni un PNG/);
    expect(uploadProblem({ name: "a.png", size: 10, format: "png", width: 51, height: 40 })).toMatch(/51x40/);
    expect(uploadProblem({ name: "a.png", size: 10, format: "png", width: 40, height: 64 })).toMatch(/máximo es 50x50/);
  });
});
