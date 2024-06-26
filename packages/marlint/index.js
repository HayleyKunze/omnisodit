/* eslint prefer-arrow-callback: 0 */
'use strict';
const path = require('path');
const globby = require('globby');
const pkgConf = require('pkg-conf');
const ESLint = require('eslint').ESLint;

const eslint = require('./lib/eslint');
const workspace = require('./lib/workspace');
const toWritableGlobal = require('./lib/toWritableGlobal');

const DEFAULT_IGNORES = [
  '**/node_modules/**',
  'bower_components/**',
  'coverage/**',
  '{tmp,temp}/**',
  '**/*.min.js',
  '**/bundle.js',
  'fixture.js',
  '{test/,}fixture{s,}/**',
];

exports.lintText = function lintText(str, options) {
  const cwd = path.resolve(options.cwd || process.cwd());

  const filePath = options.filename;
  const absolutePath = path.resolve(cwd, filePath);

  const pkgOpts = pkgConf.sync('marlint', { cwd });
  const isTypescript = filePath.endsWith('.ts') || filePath.endsWith('.tsx');
  const defaultOpts = eslint.generateOpts(
    { ...pkgOpts, typescript: isTypescript },
    options
  );

  const workspacePaths = workspace.getPaths({ cwd });

  if (workspacePaths.length > 0) {
    const workspacePath = workspacePaths.find((workspacePath) =>
      absolutePath.includes(workspacePath)
    );

    if (!workspacePath) {
      const engine = new ESLint(defaultOpts.eslint);
      return engine.lintText(str, filePath);
    }

    const workspaceOpts = pkgConf.sync('marlint', { cwd: workspacePath });
    const mergedOpts = {
      eslint: {
        ...defaultOpts.eslint,
        overrideConfig: {
          rules: { ...defaultOpts.eslint.rules, ...workspaceOpts.rules },
          globals: Object.assign(
            {},
            toWritableGlobal(defaultOpts.eslint.globals),
            toWritableGlobal(workspaceOpts.globals)
          ),
        },
      },
    };
    const engine = new ESLint(mergedOpts.eslint);
    return engine.lintText(str, filePath);
  }

  const engine = new ESLint(defaultOpts.eslint);
  return engine.lintText(str, filePath);
};

const DEFAULT_GLOB = '**/*.{js,jsx,ts,tsx}';

exports.lintFiles = function lintFiles(patterns, runtimeOpts) {
  const pkgOpts = pkgConf.sync('marlint', { cwd: process.cwd() });
  const workspacePaths = workspace.getPaths({ cwd: process.cwd() });
  const ignore = DEFAULT_IGNORES.concat(pkgOpts.ignores || []);
  const verbose = runtimeOpts.verbose;

  let glob;
  if (patterns.length === 0) {
    glob = DEFAULT_GLOB;
  } else {
    glob = patterns.map((p) => {
      if (p.includes('.') || p.includes('*')) {
        return p;
      } else {
        return p.endsWith('/') ? p + DEFAULT_GLOB : p + '/' + DEFAULT_GLOB;
      }
    })[0];
  }

  if (verbose) {
    console.log(`Finding files to lint...`);
  }

  return globby(glob, { ignore }).then((paths) => {
    // separate between js and ts files because they use different parser
    // and default rules
    const pathsByExt = {
      ts: [],
      js: [],
    };

    paths.forEach((path) => {
      const isTypescript = path.endsWith('.ts') || path.endsWith('.tsx');
      if (isTypescript) {
        pathsByExt.ts.push(path);
      } else {
        pathsByExt.js.push(path);
      }
    });

    if (verbose) {
      if (pathsByExt.ts.length > 0) {
        console.log(
          `Found ${pathsByExt.ts.length} TS files and ${pathsByExt.js.length} JS files`
        );
      } else {
        console.log(`${paths.length} JS files found`);
      }
    }

    const jsOptions = eslint.generateOpts(pkgOpts, runtimeOpts);
    const tsOptions = eslint.generateOpts(
      { ...pkgOpts, typescript: true },
      runtimeOpts
    );

    // if it's a workspace, allow override root config via workspace package.json
    if (workspacePaths.length !== 0) {
      if (verbose) {
        console.log(
          `Workspace (yarn/lerna) detected, found ${workspacePaths.length} packages`
        );
      }

      const jsConfigs = workspace.groupPathsByPackage(
        pathsByExt.js,
        workspacePaths,
        jsOptions
      );
      const tsConfigs = workspace.groupPathsByPackage(
        pathsByExt.ts,
        workspacePaths,
        tsOptions
      );
      const configs = jsConfigs.concat(tsConfigs);
      return eslint.run(configs, runtimeOpts);
    }

    // if ts file exists, run them in parallel with JS
    if (pathsByExt.ts.length > 0) {
      return eslint.run(
        [
          {
            id: '__extensions_js__',
            paths: pathsByExt.js,
            options: jsOptions,
          },
          {
            id: '__extensions_js__',
            paths: pathsByExt.ts,
            options: tsOptions,
          },
        ],
        runtimeOpts
      );
    }

    // no ts file, pass original paths
    return eslint.run(
      [{ id: '__shared__', paths, options: jsOptions }],
      runtimeOpts
    );
  });
};
