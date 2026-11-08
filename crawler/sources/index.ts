// Registry of crawler source adapters. One file per source in this folder.
// Order matters only for log readability; each source fails independently (run.ts).
import type { SourceAdapter } from "../types";
import { mcpRegistryAdapter } from "./mcp-registry";
import { awesomeMcp } from "./awesome-mcp";
import { claudeMarketplace } from "./claude-marketplace";
import { clawhub } from "./clawhub";
import { modelsDevAdapter } from "./models-dev";
import { openrouterAdapter } from "./openrouter";

export const ADAPTERS: SourceAdapter[] = [
  mcpRegistryAdapter,
  awesomeMcp,
  claudeMarketplace,
  clawhub,
  modelsDevAdapter,
  openrouterAdapter,
];
