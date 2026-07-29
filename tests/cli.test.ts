import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BrowserContext } from "../src/generator.js";
import { runCli, type CliDependencies } from "../src/cli/program.js";

interface FakeState {
  stdout: string;
  stderr: string;
  launchCalls: Array<{ headless: boolean }>;
}

function createFakeDependencies(): CliDependencies & { state: FakeState } {
  const state: FakeState = {
    stdout: "",
    stderr: "",
    launchCalls: [],
  };
  const browser: BrowserContext = {
    async newPage() {
      throw new Error("unused fake page");
    },
    async close() {},
  };

  return {
    state,
    async launchBrowser(options) {
      state.launchCalls.push(options);
      return browser;
    },
    createImageGenerator() {
      throw new Error("unused fake image generator");
    },
    createTextGenerator() {
      throw new Error("unused fake text generator");
    },
    async runBrowserCommand() {
      throw new Error("unused fake browser command");
    },
    stdout(text) {
      state.stdout += text;
    },
    stderr(text) {
      state.stderr += text;
    },
    cwd() {
      return "/work";
    },
    async pathExists() {
      return false;
    },
    async isDirectory() {
      return false;
    },
    async mkdir() {},
    onSignal() {
      return () => {};
    },
  };
}

describe("CLI parsing", () => {
  it("shows the command surface", async () => {
    const dependencies = createFakeDependencies();

    const status = await runCli(
      ["node", "perchance", "--help"],
      dependencies,
    );

    assert.equal(status, 0);
    assert.match(dependencies.state.stdout, /image \[options\] <prompt>/);
    assert.match(dependencies.state.stdout, /text \[options\] <prompt>/);
    assert.match(dependencies.state.stdout, /browser/);
  });

  it("rejects an invalid image shape before launching a browser", async () => {
    const dependencies = createFakeDependencies();

    const status = await runCli(
      ["node", "perchance", "image", "cat", "--shape", "wide"],
      dependencies,
    );

    assert.equal(status, 1);
    assert.equal(dependencies.state.launchCalls.length, 0);
    assert.match(dependencies.state.stderr, /portrait, square, or landscape/);
  });

  it("rejects invalid numeric options", async () => {
    const dependencies = createFakeDependencies();

    const status = await runCli(
      ["node", "perchance", "image", "cat", "--seed", "nope"],
      dependencies,
    );

    assert.equal(status, 1);
    assert.equal(dependencies.state.launchCalls.length, 0);
    assert.match(dependencies.state.stderr, /integer/);
  });

  it("requires a prompt", async () => {
    const dependencies = createFakeDependencies();

    const status = await runCli(
      ["node", "perchance", "text"],
      dependencies,
    );

    assert.equal(status, 1);
    assert.equal(dependencies.state.launchCalls.length, 0);
    assert.match(dependencies.state.stderr, /missing required argument/);
  });
});
