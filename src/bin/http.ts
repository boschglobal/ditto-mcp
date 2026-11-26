#!/usr/bin/env node
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

import { loadConfig } from "../config/load.js";
import { createHttpApp } from "../server/http-app.js";
import { buildKnowledgeService } from "../knowledge/build.js";
import { registerTools } from "../tools/index.js";

/** Backstop for a request that does not end; below Docker's default 10 s stop timeout. */
const SHUTDOWN_DEADLINE_MS = 5_000;
/** How long requests in flight get to finish; leaves a second of the deadline to close the rest. */
const DRAIN_MS = 4_000;

async function main(): Promise<void> {
  const config = loadConfig(process.env.DITTO_MCP_CONFIG);
  const knowledge = await buildKnowledgeService(config);
  const registry = await registerTools(config, knowledge);
  const app = createHttpApp(config, registry);
  const server = app.listen(config.server.http.port, config.server.http.host, () => {
    process.stderr.write(
      `[ditto-mcp] http server listening on ${config.server.http.host}:${config.server.http.port}/mcp\n`,
    );
  });

  // In a container node runs as PID 1, and the kernel applies no default action to signals sent
  // to PID 1: without these handlers, `docker stop` or a Kubernetes pod termination waits out
  // the grace period and then SIGKILLs the server. Outside a container, a second Ctrl-C kills at once.
  const shutdown = (signal: NodeJS.Signals): void => {
    process.stderr.write(`[ditto-mcp] ${signal} received; finishing open requests and shutting down\n`);
    server.close(() => process.exit(0));
    // Tool calls in flight finish first: closing a session ends their response streams, so a
    // Ditto write could succeed with its response lost. Then close the sessions, since event
    // streams never end on their own and would hold close() open, and drop the keep-alive
    // connections left idle.
    void app.drain(DRAIN_MS)
      .then((open) => {
        if (open > 0) {
          process.stderr.write(`[ditto-mcp] ${open} request(s) still open after ${DRAIN_MS} ms; closing them\n`);
        }
        return app.closeSessions();
      })
      .then(() => server.closeIdleConnections());
    setTimeout(() => {
      process.stderr.write(`[ditto-mcp] requests still open after ${SHUTDOWN_DEADLINE_MS} ms; exiting\n`);
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((err) => {
  process.stderr.write(`[ditto-mcp] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
