import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);

// Use the project's compiler; replace only browser/API boundaries in Node tests.
export function loadModule(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(
    name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name),
    module,
    module.exports,
  );
  return module.exports;
}
