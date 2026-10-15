/**
 * The shared contract (backend-data.md §6). Zod schemas + inferred types, imported by the
 * AI, UI and domain code. Pure: no server-only imports.
 */
export * from "./common";
export * from "./operations";
export * from "./proposed-change";
export * from "./kitchen-state";
export * from "./apply-result";
export * from "./stream";
export * from "./settings";
export * from "./past-meals";
