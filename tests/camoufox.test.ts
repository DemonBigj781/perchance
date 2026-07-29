import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createOwnedClose } from "../src/internal/browserOwnership.js";

describe("Camoufox browser ownership", () => {
  it("closes the context and its owning browser", async () => {
    const closed: string[] = [];
    const close = createOwnedClose(
      {
        async close() {
          closed.push("context");
        },
      },
      {
        async close() {
          closed.push("browser");
        },
      },
    );

    await close();
    await close();

    assert.deepEqual(closed, ["context", "browser"]);
  });

  it("still closes the browser if closing the context fails", async () => {
    let browserClosed = false;
    const close = createOwnedClose(
      {
        async close() {
          throw new Error("context close failed");
        },
      },
      {
        async close() {
          browserClosed = true;
        },
      },
    );

    await assert.rejects(close(), /context close failed/);
    assert.equal(browserClosed, true);
  });
});
