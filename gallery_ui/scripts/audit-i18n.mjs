import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../src/", import.meta.url));
const errors = [];
function catalog(locale) {
  const filename = path.join(root, "i18n/locales", `${locale}.ts`);
  const code = ts.transpileModule(fs.readFileSync(filename,"utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  const context = {exports:{}};
  vm.runInNewContext(code, context, {timeout:1000});
  return context.exports.default;
}
const en = catalog("en"), zh = catalog("zh-CN");
const variables = text => [...text.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort().join(",");
function compare(left,right,prefix="") {
  for (const key of new Set([...Object.keys(left),...Object.keys(right)])) {
    const name = prefix + key;
    if (!(key in left) || !(key in right)) { errors.push(`Missing locale key: ${name}`); continue; }
    if (typeof left[key] !== typeof right[key]) { errors.push(`Type mismatch: ${name}`); continue; }
    if (typeof left[key] === "object") compare(left[key],right[key],name+".");
    else if (variables(left[key]) !== variables(right[key])) errors.push(`Placeholder mismatch: ${name}`);
  }
}
compare(en,zh);
function walk(folder) {
  for (const item of fs.readdirSync(folder, {withFileTypes:true})) {
    const filename=path.join(folder,item.name);
    if(item.isDirectory()) {if(item.name!=="locales")walk(filename);continue;}
    if(!/\.tsx?$/.test(item.name) || /\.test\.|test\//.test(filename))continue;
    const source=ts.createSourceFile(filename,fs.readFileSync(filename,"utf8"),ts.ScriptTarget.Latest,true,item.name.endsWith("tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    function visit(node) {
      if(ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t" && node.arguments.length && ts.isStringLiteral(node.arguments[0])) {
        const key=node.arguments[0].text;
        if(!(key in en) || !(key in zh))errors.push(`Untranslated t("${key}") in ${path.relative(root,filename)}`);
      }
      if ((ts.isJsxText(node) || (ts.isStringLiteral(node) && ts.isJsxAttribute(node.parent))) && /[\u4e00-\u9fff]/.test(node.text)) errors.push(`Hardcoded JSX text in ${path.relative(root,filename)}: ${node.text.trim()}`);
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
}
walk(root);
if(errors.length){console.error(errors.join("\n"));process.exit(1);}
console.log(`i18n audit passed: ${Object.keys(en).length} keys, matching placeholders, static t() coverage, no hardcoded Chinese JSX.`);
