const { join } = require("node:path");
const { promises: fs } = require("node:fs");

/**
 * electron-builder invokes this hook after packaging each architecture slice.
 * We strip the native bindings that target the other architecture so the
 * universal merge step only sees the correct binary for each slice.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "mac") {
    return;
  }

  const arch = context.arch;
  const archTag = arch === 1 ? "x64" : arch === 3 ? "arm64" : null;
  if (!archTag) {
    return;
  }

  const nativeDir = join(context.appOutDir, "Contents", "Resources", "native", "core");

  let entries;
  try {
    entries = await fs.readdir(nativeDir);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.endsWith(".node")) {
        return;
      }
      if (!entry.includes("darwin-")) {
        return;
      }
      if (entry.includes(`darwin-${archTag}`)) {
        return;
      }

      await fs.unlink(join(nativeDir, entry));
    })
  );
};
