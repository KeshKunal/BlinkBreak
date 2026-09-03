import { describe, expect, it } from "vitest";
import { classifyUrl, isInjectable } from "../shared/page-access";

describe("page-access", () => {
  describe("classifyUrl", () => {
    it("classifies normal http pages as injectable", () => {
      expect(classifyUrl("http://example.com")).toBe("injectable");
      expect(classifyUrl("https://github.com/user/repo")).toBe("injectable");
    });

    it("classifies chrome:// as restricted_scheme", () => {
      expect(classifyUrl("chrome://settings")).toBe("restricted_scheme");
      expect(classifyUrl("chrome://newtab")).toBe("restricted_scheme");
      expect(classifyUrl("chrome://extensions")).toBe("restricted_scheme");
    });

    it("classifies edge:// as restricted_scheme", () => {
      expect(classifyUrl("edge://settings")).toBe("restricted_scheme");
      expect(classifyUrl("edge://newtab")).toBe("restricted_scheme");
    });

    it("classifies brave:// as restricted_scheme", () => {
      expect(classifyUrl("brave://settings")).toBe("restricted_scheme");
    });

    it("classifies about: pages as restricted_scheme", () => {
      expect(classifyUrl("about:blank")).toBe("restricted_scheme");
      expect(classifyUrl("about:newtab")).toBe("restricted_scheme");
    });

    it("classifies data: URLs as restricted_scheme", () => {
      expect(classifyUrl("data:text/html,<h1>hello</h1>")).toBe("restricted_scheme");
    });

    it("classifies chrome-extension:// as extension_page", () => {
      expect(classifyUrl("chrome-extension://abcdefgh/popup.html")).toBe("extension_page");
    });

    it("classifies the Chrome PDF viewer as pdf", () => {
      expect(classifyUrl("chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html")).toBe("pdf");
    });

    it("classifies Web Store pages as restricted_scheme", () => {
      expect(classifyUrl("https://chrome.google.com/webstore/detail/some-extension")).toBe("restricted_scheme");
    });

    it("returns unknown for undefined or empty URL", () => {
      expect(classifyUrl(undefined)).toBe("unknown");
      expect(classifyUrl(null)).toBe("unknown");
      expect(classifyUrl("")).toBe("unknown");
    });

    it("classifies file:// as restricted_scheme", () => {
      expect(classifyUrl("file:///Users/me/doc.html")).toBe("restricted_scheme");
    });

    it("classifies view-source: as restricted_scheme", () => {
      expect(classifyUrl("view-source:https://example.com")).toBe("restricted_scheme");
    });
  });

  describe("isInjectable", () => {
    it("returns true for http/https", () => {
      expect(isInjectable("https://example.com")).toBe(true);
    });

    it("returns false for restricted schemes", () => {
      expect(isInjectable("chrome://settings")).toBe(false);
      expect(isInjectable("edge://newtab")).toBe(false);
      expect(isInjectable(undefined)).toBe(false);
    });
  });
});
