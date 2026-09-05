/**
 * browser-compat.ts
 *
 * Thin Chromium compatibility layer. All primary targets (Chrome, Edge, Brave,
 * and other Chromium browsers) use the same `chrome.*` MV3 API surface.
 * This module provides a single namespace alias so that any future divergence
 * can be handled here without scattering changes throughout the codebase.
 *
 * No polyfills are included — they would add bundle weight with no benefit
 * across this Chromium-only target set.
 */

// Re-export the chrome namespace under a `browser` alias.
// Callers can import { browser } and use browser.runtime, browser.tabs, etc.
export const browser = globalThis.chrome;
