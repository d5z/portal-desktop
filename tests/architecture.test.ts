import { readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

const root = path.resolve("desktop");
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sources(file)
      : /\.(?:ts|tsx|js)$/.test(file)
        ? [file]
        : [];
  });
}
const edges = ["main", "preload", "renderer", "shared"].flatMap((layer) =>
  sources(path.join(root, layer)).flatMap((file) => {
    const imports: string[] = [];
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node: ts.Node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        imports.push(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          node.expression.getText(source) === "require") &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        imports.push(node.arguments[0].text);
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      )
        imports.push(node.argument.literal.text);
      ts.forEachChild(node, visit);
    }
    visit(source);
    return imports.map((specifier) => ({
      layer,
      source: path.relative(root, file).replaceAll(path.sep, "/"),
      specifier,
      target: specifier.startsWith(".")
        ? path
            .relative(root, path.resolve(path.dirname(file), specifier))
            .replaceAll(path.sep, "/")
        : specifier,
    }));
  }),
);
const nodeImport = (specifier: string) =>
  specifier.startsWith("node:") || builtinModules.includes(specifier);

test("renderer cannot import privileged process code or Node/Electron APIs", () => {
  expect(
    edges.filter(
      (edge) =>
        edge.layer === "renderer" &&
        (/^(?:main|preload)\//.test(edge.target) ||
          edge.specifier === "electron" ||
          nodeImport(edge.specifier)),
    ),
  ).toEqual([]);
});

test("main and preload do not depend on renderer implementation", () => {
  expect(
    edges.filter(
      (edge) =>
        ["main", "preload"].includes(edge.layer) &&
        edge.target.startsWith("renderer/"),
    ),
  ).toEqual([]);
});

test("shared contracts and renderer utilities do not depend on feature implementations", () => {
  expect(
    edges.filter(
      (edge) =>
        edge.layer === "shared" &&
        (/^(?:main|preload|renderer)\//.test(edge.target) ||
          edge.specifier === "electron" ||
          nodeImport(edge.specifier)),
    ),
  ).toEqual([]);
  expect(
    edges.filter(
      (edge) =>
        edge.source.startsWith("renderer/shared/") &&
        edge.target.startsWith("renderer/") &&
        !edge.target.startsWith("renderer/shared/"),
    ),
  ).toEqual([]);
});

test("feature models and services remain independent of React components and hooks", () => {
  expect(
    edges.filter(
      (edge) =>
        edge.layer === "renderer" &&
        /\/(?:models|services)\//.test(edge.source) &&
        (/\/(?:components|hooks)\//.test(edge.target) ||
          ["react", "react-dom"].includes(edge.specifier)),
    ),
  ).toEqual([]);
});

test("main features cannot import the process entry or composition root", () => {
  expect(
    edges.filter(
      (edge) =>
        edge.layer === "main" &&
        (edge.target === "main/main" ||
          (edge.target === "main/app/bootstrap" && edge.source !== "main/main.ts")),
    ),
  ).toEqual([]);
});


test("renderer pure utilities and icon assets do not import UI or feature state", () => {
  expect(edges.filter(edge =>
    /renderer\/shared\/(?:lib|icons)\//.test(edge.source) &&
    (/\/(?:components|hooks|models|services)\//.test(edge.target) ||
      /\.(?:s?css)$/.test(edge.specifier))
  )).toEqual([]);
});
