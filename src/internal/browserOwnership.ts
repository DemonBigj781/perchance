interface Closeable {
  close(): Promise<void>;
}

/** Close a browser context and, when owned, the browser process behind it. */
export function createOwnedClose(
  context: Closeable,
  owner?: Closeable,
): () => Promise<void> {
  let closePromise: Promise<void> | undefined;

  return () => {
    closePromise ??= closeAll(context, owner);
    return closePromise;
  };
}

async function closeAll(context: Closeable, owner?: Closeable): Promise<void> {
  let firstError: unknown;

  try {
    await context.close();
  } catch (error) {
    firstError = error;
  }

  if (owner) {
    try {
      await owner.close();
    } catch (error) {
      firstError ??= error;
    }
  }

  if (firstError) throw firstError;
}
