const path = require('path');
const findUp = require('find-up');
const loadJsonFile = require('load-json-file');
const pkgConf = require('pkg-conf');
const globby = require('globby');
const toWritableGlobal = require('./toWritableGlobal');

function getPackageEntries(workspacePaths, cwd) {
  const workspaceSet = workspacePaths.reduce((result, workspace) => {
    // Each workspace must have their own package.json
    // By using this heuristic, false positives are removed and lint executes faster
    globby
      .sync(path.join(workspace, '/package.json'), { cwd })
      // we get directories by simply removing /package.json from the path
      .map((path) => path.replace('/package.json', ''))
      // then we add to Set to remove duplicates
      .forEach((dir) => {
        result.add(dir);
      });

    return result;
  }, new Set());

  return Array.from(workspaceSet);
}

exports.getPaths = function getWorkspacePaths(opts) {
  const workspaceConfig = pkgConf.sync('workspaces', opts);

  if (Array.isArray(workspaceConfig)) {
    // default workspace config
    // { "workspaces": ["packages/*"] }
    return getPackageEntries(workspaceConfig, opts.cwd);
  }

  if (Array.isArray(workspaceConfig.packages)) {
    // workspace with nohoist options
    return getPackageEntries(workspaceConfig.packages, opts.cwd);
  }

  // no workspace config, try detecting lerna
  try {
    const lernaConfigPath = path.resolve(opts.cwd, 'lerna.json');
    const lerna = require(lernaConfigPath);
    // https://github.com/lerna/lerna/releases/tag/v2.0.0-beta.31
    lerna.packages = lerna.packages || ['packages/*'];
    return getPackageEntries(lerna.packages, opts.cwd);
  } catch (err) {
    return [];
  }
};

exports.groupPathsByPackage = function groupPathsByPackage(
  paths,
  workspacePaths,
  defaultOpts
) {
  const packages = workspacePaths.map((workspacePath) => {
    const pkgJson = findUp.sync('package.json', { cwd: workspacePath });
    const pkg = loadJsonFile.sync(pkgJson);
    const workspaceOpts = pkgConf.sync('marlint', { cwd: workspacePath });
    const mergedOpts = {
      ...defaultOpts,
      marlint: {
        ignores: defaultOpts.marlint.ignores.concat(
          workspaceOpts.ignores || []
        ),
      },
      eslint: {
        ...defaultOpts.eslint,
        overrideConfig: {
          rules: {
            ...defaultOpts.eslint.overrideConfig.rules,
            ...workspaceOpts.rules,
          },
          globals: Object.assign(
            {},
            toWritableGlobal(defaultOpts.eslint.overrideConfig.globals),
            toWritableGlobal(workspaceOpts.globals)
          ),
        },
      },
    };

    return {
      id: pkg.name,
      paths: [],
      options: mergedOpts,
    };
  });

  // add 1 more for grouping files outside workspace
  packages.push({
    id: '__global_workspace__',
    paths: [],
    options: defaultOpts,
  });
  const fallbackIndex = packages.length - 1;

  paths.forEach((filePath) => {
    const index = workspacePaths.findIndex((workspacePath) =>
      filePath.includes(workspacePath)
    );
    const targetIndex = index === -1 ? fallbackIndex : index;
    packages[targetIndex].paths.push(filePath);
  });

  return packages;
};
