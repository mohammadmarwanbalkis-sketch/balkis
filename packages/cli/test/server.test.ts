import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { createHttpServer, loadRegistryFromModule } from "../src/index.js";

const FIXTURE = fileURLToPath(new URL("./fixture-module.mjs", import.meta.url));

async function startServer() {
  const registry = await loadRegistryFromModule(FIXTURE);
  const server = createHttpServer(registry);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  return `http://127.0.0.1:${port}`;
}

describe("balkis serve", () => {
  it("serves the catalog, health, and an OpenAPI document generated from metadata", async () => {
    const base = await startServer();

    const health = await (await fetch(`${base}/health`)).json();
    expect(health).toEqual({ ok: true });

    const catalog = (await (await fetch(`${base}/calculations`)).json()) as {
      framework: string;
    };
    expect(catalog.framework).toBe("balkis");

    type OpenApiPath = {
      post: {
        summary: string;
        requestBody: {
          content: Record<
            string,
            { schema: { properties: { inputs: { properties: Record<string, { type: string }> } } } }
          >;
        };
      };
    };
    const openapi = (await (await fetch(`${base}/openapi.json`)).json()) as {
      openapi: string;
      paths: Record<string, OpenApiPath>;
    };
    expect(openapi.openapi).toBe("3.1.0");
    expect(openapi.paths["/calculations/payroll.net/run"]?.post.summary).toBe(
      "Gross minus a flat 20% tax.",
    );
    expect(
      openapi.paths["/calculations/payroll.gross/run"]?.post.requestBody.content["application/json"]
        ?.schema.properties.inputs.properties.baseSalary?.type,
    ).toBe("number");
  });

  it("executes calculations over POST and returns the full report", async () => {
    const base = await startServer();
    const response = await fetch(`${base}/calculations/payroll.net/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inputs: { baseSalary: 90_000, bonus: 10_000 } }),
    });
    expect(response.status).toBe(200);
    const report = (await response.json()) as {
      value: unknown;
      order: string[];
      trace: unknown[];
    };
    expect(report.value).toEqual({ net: 80_000 });
    expect(report.order).toEqual(["payroll.gross", "payroll.net"]);
    expect(report.trace).toHaveLength(2);
  });

  it("maps structured errors onto HTTP status codes", async () => {
    const base = await startServer();

    const invalid = await fetch(`${base}/calculations/payroll.net/run`, {
      method: "POST",
      body: JSON.stringify({ inputs: { baseSalary: -1 } }),
    });
    expect(invalid.status).toBe(422);
    expect(((await invalid.json()) as { code: string }).code).toBe("INPUT_VALIDATION");

    const unknown = await fetch(`${base}/calculations/does.not-exist/run`, {
      method: "POST",
      body: JSON.stringify({ inputs: {} }),
    });
    expect(unknown.status).toBe(404);

    const badBody = await fetch(`${base}/calculations/payroll.net/run`, {
      method: "POST",
      body: "not json",
    });
    expect(badBody.status).toBe(400);

    const noRoute = await fetch(`${base}/nope`);
    expect(noRoute.status).toBe(404);
  });
});
