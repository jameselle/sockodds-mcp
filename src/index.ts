#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readSettings } from "./config.js";
import { createServer } from "./server.js";

const settings = readSettings();
const server = createServer(settings);
await server.connect(new StdioServerTransport());
// stdout carries the protocol, so status goes to stderr.
console.error(
  settings.apiKey
    ? "sockodds-mcp ready (live SockOdds API)."
    : settings.demo
      ? "sockodds-mcp ready in DEMO mode (invented sample data)."
      : "sockodds-mcp ready, but SOCKODDS_API_KEY is not set: odds tools will explain how to get a free key.",
);
