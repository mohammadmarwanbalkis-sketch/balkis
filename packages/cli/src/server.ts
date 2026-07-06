/**
 * `balkis serve` — a calculation catalog as an instant HTTP API.
 *
 * One POST endpoint per calculation, an OpenAPI 3.1 document generated from the
 * same `registry.describe()` metadata everything else consumes, and error codes
 * mapped onto HTTP status. Zero dependencies: node:http is plenty for a JSON API.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type BalkisError, type CalculationRegistry, Engine } from "@balkis/core";

const STATUS_BY_CODE: Record<string, number> = {
  UNKNOWN_CALCULATION: 404,
  INPUT_VALIDATION: 422,
  OUTPUT_VALIDATION: 500,
  CALCULATION_RUNTIME: 500,
  CIRCULAR_DEPENDENCY: 500,
};

export function buildOpenApi(registry: CalculationRegistry): Record<string, unknown> {
  const meta = registry.describe();
  const paths: Record<string, unknown> = {};
  for (const calculation of meta.calculations) {
    paths[`/calculations/${calculation.id}/run`] = {
      post: {
        operationId: `run_${calculation.id.replaceAll(/[.-]/g, "_")}`,
        summary: calculation.summary,
        description:
          `Executes \`${calculation.id}\` v${calculation.version} and returns the full ` +
          `execution report (value, order, audit trace).` +
          (calculation.dependencies.length > 0
            ? ` Depends on: ${calculation.dependencies.join(", ")}.`
            : ""),
        tags: calculation.tags.length > 0 ? [...calculation.tags] : ["calculations"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { inputs: calculation.inputSchema ?? { type: "object" } },
                required: ["inputs"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Execution report",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    value: calculation.outputSchema ?? { type: "object" },
                    executionId: { type: "string" },
                    order: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
          "422": { description: "Input validation failed (structured Balkis error)" },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Balkis calculation API",
      version: "1.0.0",
      description: `${meta.calculations.length} calculations, generated from registry.describe().`,
    },
    paths,
  };
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length === 0 ? {} : JSON.parse(raw);
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  response.end(json);
}

/** Build (but do not start) the HTTP server for a registry. */
export function createHttpServer(registry: CalculationRegistry): Server {
  const engine = new Engine(registry);
  const openapi = buildOpenApi(registry);
  const runRoute = /^\/calculations\/([a-z0-9.-]+)\/run$/;

  return createServer((request, response) => {
    void (async () => {
      const url = request.url ?? "/";
      if (request.method === "GET" && url === "/health") {
        return send(response, 200, { ok: true });
      }
      if (request.method === "GET" && url === "/openapi.json") {
        return send(response, 200, openapi);
      }
      if (request.method === "GET" && (url === "/" || url === "/calculations")) {
        return send(response, 200, registry.describe());
      }
      const match = request.method === "POST" ? url.match(runRoute) : null;
      if (match !== null) {
        const targetId = match[1] as string;
        let body: unknown;
        try {
          body = await readJsonBody(request);
        } catch {
          return send(response, 400, { code: "BAD_REQUEST", message: "Body must be JSON." });
        }
        const inputs =
          typeof body === "object" && body !== null && "inputs" in body
            ? (body as { inputs: unknown }).inputs
            : {};
        if (typeof inputs !== "object" || inputs === null || Array.isArray(inputs)) {
          return send(response, 400, {
            code: "BAD_REQUEST",
            message: 'Body must be { "inputs": { … } }.',
          });
        }
        const result = await engine.run(targetId, inputs as Record<string, unknown>);
        if (!result.ok) {
          const error = result.error as BalkisError;
          return send(response, STATUS_BY_CODE[error.code] ?? 500, error.toJSON());
        }
        return send(response, 200, result.value);
      }
      return send(response, 404, { code: "NOT_FOUND", message: `No route for ${url}.` });
    })().catch(() => {
      if (!response.headersSent) {
        send(response, 500, { code: "INTERNAL", message: "Unexpected server error." });
      }
    });
  });
}
