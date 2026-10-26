/*
 * Copyright (c) 2026 Contributors to the Eclipse Foundation
 *
 * See the NOTICE file(s) distributed with this work for additional
 * information regarding copyright ownership.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0
 *
 * SPDX-License-Identifier: EPL-2.0
 */

import { describe, it, expect, afterEach } from "vitest";
import { HttpDittoClient } from "./client.js";
import { startFakeDitto } from "./fake-ditto.js";
import type { DittoOperation } from "./openapi.js";

const op = (over: Partial<DittoOperation>): DittoOperation => ({
  operationId: "op", method: "GET", path: "/x", summary: "", description: "", params: [], hasBody: false, ...over,
});
const cred = (h?: string) => ({ authHeader: async () => h });

let fake: Awaited<ReturnType<typeof startFakeDitto>>;
afterEach(async () => { await fake?.stop(); });

describe("HttpDittoClient", () => {
  it("substitutes path params, sends query, forwards auth", async () => {
    fake = await startFakeDitto((req) => ({ status: 200, body: JSON.stringify({ ok: req.url }) }));
    const client = new HttpDittoClient(fake.baseUrl);
    const res = await client.execute(
      op({ path: "/things/{thingId}", params: [
        { name: "thingId", in: "path", required: true, type: "string" },
        { name: "fields", in: "query", required: false, type: "string" }] }),
      { thingId: "ns:1", fields: "attributes" },
      cred("Basic abc"),
    );
    expect(res.status).toBe(200);
    expect(fake.requests[0].url).toBe("/things/ns:1?fields=attributes");
    expect(fake.requests[0].auth).toBe("Basic abc");
  });

  it("sends a JSON body for write ops", async () => {
    fake = await startFakeDitto(() => ({ status: 201, body: "" }));
    const client = new HttpDittoClient(fake.baseUrl);
    const res = await client.execute(
      op({ method: "PUT", path: "/things/{id}", hasBody: true,
           params: [{ name: "id", in: "path", required: true, type: "string" }] }),
      { id: "ns:1", body: { attributes: { a: 1 } } },
      cred(),
    );
    expect(res.status).toBe(201);
    expect(JSON.parse(fake.requests[0].body!)).toEqual({ attributes: { a: 1 } });
  });

  it("encodes unsafe path-param chars but keeps the Ditto namespace colon", async () => {
    fake = await startFakeDitto(() => ({ status: 200, body: "" }));
    const client = new HttpDittoClient(fake.baseUrl);
    await client.execute(
      op({ path: "/things/{thingId}", params: [{ name: "thingId", in: "path", required: true, type: "string" }] }),
      { thingId: "ns:a b/c" },
      cred(),
    );
    expect(fake.requests[0].url).toBe("/things/ns:a%20b%2Fc"); // colon kept; space+slash encoded
  });

  it("refuses dot-segment path params, which would retarget the request to another endpoint", async () => {
    fake = await startFakeDitto(() => ({ status: 204, body: "" }));
    const client = new HttpDittoClient(fake.baseUrl);
    const deleteFeature = op({ method: "DELETE", path: "/things/{thingId}/features/{featureId}", params: [
      { name: "thingId", in: "path", required: true, type: "string" },
      { name: "featureId", in: "path", required: true, type: "string" }] });
    // URL parsing resolves "features/.." away: DELETE one feature would become DELETE the whole thing.
    for (const featureId of ["..", "."]) {
      await expect(client.execute(deleteFeature, { thingId: "ns:1", featureId }, cred()))
        .rejects.toThrow(/path parameter featureId/);
    }
    expect(fake.requests).toHaveLength(0);
  });

  it("refuses an empty or missing path param, which would target the parent collection", async () => {
    fake = await startFakeDitto(() => ({ status: 204, body: "" }));
    const client = new HttpDittoClient(fake.baseUrl);
    const putAttribute = op({ method: "PUT", path: "/things/{thingId}/attributes/{attributePath}", hasBody: true,
      params: [
        { name: "thingId", in: "path", required: true, type: "string" },
        { name: "attributePath", in: "path", required: true, type: "string" }] });
    // ".../attributes/" is the attributes collection: PUT one attribute would replace them all.
    await expect(client.execute(putAttribute, { thingId: "ns:1", attributePath: "", body: 1 }, cred()))
      .rejects.toThrow(/path parameter attributePath/);
    await expect(client.execute(putAttribute, { thingId: "ns:1", body: 1 }, cred()))
      .rejects.toThrow(/path parameter attributePath/);
    expect(fake.requests).toHaveLength(0);
  });
});
