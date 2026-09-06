import { readFileSync, realpathSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const forbiddenPackage =
  /^(?:mongoose|mongodb(?:[-/].*)?|connect-mongo|@workspace\/legacy-migration)$/;
const forbiddenFile =
  /(?:^|\/)(?:mongo-schemas|db-mongo|postgres-station-sync|station-change-stream-cdc|legacy-document-codec)(?:\.[cm]?[jt]s)?$/;

export function isLegacyDatabaseImport(value) {
  const normalized = value.replaceAll("\\", "/").split("?")[0];
  if (forbiddenPackage.test(normalized) || forbiddenFile.test(normalized))
    return true;
  return (
    normalized
      .split("/")
      .some((part) =>
        /^(?:mongoose|mongodb(?:-[a-z-]+)?|connect-mongo)(?:@|$)/.test(part),
      ) || /(?:^|\/)legacy-migration(?:\/|$)/.test(normalized)
  );
}

export function assertProductionMetafile(metafile) {
  const paths = [...Object.keys(metafile.inputs || {})];
  for (const item of [
    ...Object.values(metafile.inputs || {}),
    ...Object.values(metafile.outputs || {}),
  ]) {
    for (const imported of item.imports || []) paths.push(imported.path);
  }
  const blocked = [...new Set(paths.filter(isLegacyDatabaseImport))];
  if (blocked.length)
    throw new Error(
      "Production bundle contains forbidden legacy database dependencies: " +
        blocked.join(", "),
    );
  return {
    inputFiles: Object.keys(metafile.inputs || {}).length,
    mongoDependencies: 0,
  };
}

export function productionDatabaseBoundaryPlugin() {
  return {
    name: "postgres-only-production-boundary",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (isLegacyDatabaseImport(args.path)) {
          return {
            errors: [
              {
                text:
                  "MongoDB/legacy migration code is forbidden in production: " +
                  args.path +
                  " (imported by " +
                  args.importer +
                  ")",
              },
            ],
          };
        }
      });
    },
  };
}

function findDependencyManifest(packageDir, name) {
  for (let current = packageDir; ; current = path.dirname(current)) {
    const manifest = path.join(current, "node_modules", name, "package.json");
    if (existsSync(manifest)) return realpathSync(manifest);
    if (path.dirname(current) === current) return null;
  }
}

// Only installed production dependencies are traversed. Development tools and
// optional peers (for example Drizzle's alternate adapters) are not shipped by
// pnpm deploy --prod and must not manufacture false runtime dependency edges.
export function inspectProductionDependencyGraph(rootManifests) {
  const visited = new Set();
  const packages = new Set();
  const unavailableOptional = [];
  function visit(filename, chain) {
    const resolved = realpathSync(filename);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    const manifest = JSON.parse(readFileSync(resolved, "utf8"));
    const nextChain = [...chain, manifest.name];
    if (forbiddenPackage.test(manifest.name || ""))
      throw new Error(
        "Forbidden production dependency: " + nextChain.join(" -> "),
      );
    packages.add(manifest.name + "@" + manifest.version);
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    };
    for (const name of Object.keys(dependencies)) {
      if (forbiddenPackage.test(name))
        throw new Error(
          "Forbidden production dependency: " +
            [...nextChain, name].join(" -> "),
        );
      const dependency = findDependencyManifest(path.dirname(resolved), name);
      if (!dependency) {
        if (name in (manifest.optionalDependencies || {})) {
          unavailableOptional.push(name);
          continue;
        }
        throw new Error(
          "Missing installed production dependency: " +
            [...nextChain, name].join(" -> "),
        );
      }
      visit(dependency, nextChain);
    }
  }
  for (const filename of rootManifests) visit(filename, []);
  return {
    packages: [...packages].sort(),
    packageCount: packages.size,
    mongoDependencies: 0,
    unavailableOptional: [...new Set(unavailableOptional)].sort(),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const repository = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const manifests = process.argv.slice(2);
  const report = inspectProductionDependencyGraph(
    manifests.length
      ? manifests.map((value) => path.resolve(value))
      : [
          path.join(repository, "artifacts/api-server/package.json"),
          path.join(repository, "artifacts/megaradio/package.json"),
        ],
  );
  console.log(JSON.stringify(report, null, 2));
}
