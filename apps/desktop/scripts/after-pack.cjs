// electron-builder afterPack hook. It runs on the unpacked app before signing.
//
// onnxruntime-node ships its shared library twice as two regular files, libonnxruntime.1.<minor>.dylib
// and libonnxruntime.1.dylib (44 MB each). The second one is an alias, so it becomes a symlink.
const { existsSync, readdirSync, rmSync, symlinkSync, statSync } = require("node:fs");
const { join } = require("node:path");

function unpackedModules(context) {
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  return join(app, "Contents", "Resources", "app.asar.unpacked", "node_modules");
}

exports.default = async function afterPack(context) {
  const bin = join(
    unpackedModules(context),
    "onnxruntime-node",
    "bin",
    "napi-v6",
    "darwin",
    "arm64",
  );
  if (!existsSync(bin)) return;
  const alias = "libonnxruntime.1.dylib";
  const versioned = readdirSync(bin).find((f) => /^libonnxruntime\.1\.\d.*\.dylib$/.test(f));
  if (!versioned || !existsSync(join(bin, alias))) return;
  if (statSync(join(bin, versioned)).size !== statSync(join(bin, alias)).size) return;
  rmSync(join(bin, alias));
  symlinkSync(versioned, join(bin, alias));
};
