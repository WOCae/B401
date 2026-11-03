// 2つのJSON出力を比較(数値は 1e-9 の誤差を許容、オブジェクトのキー順は無視)
import { readFileSync } from "node:fs";
const [a, b] = process.argv.slice(2).map(f => JSON.parse(readFileSync(f, "utf8")));
let bad = 0;
const isEmpty = v => (Array.isArray(v) && v.length === 0) || (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
const eq = (x, y) => {
  if (isEmpty(x) && isEmpty(y)) return true; // PHPは空の {} を [] と出力する
  if (typeof x === "number" && typeof y === "number") return Math.abs(x - y) < 1e-9;
  if (Array.isArray(x)) return Array.isArray(y) && x.length === y.length && x.every((v, i) => eq(v, y[i]));
  if (x && typeof x === "object") { if (!y || typeof y !== "object" || Array.isArray(y)) return false; const k = Object.keys(x); return k.length === Object.keys(y).length && k.every(key => eq(x[key], y[key])); }
  return x === y;
};
for (const g of ["validate", "patch"]) for (const n of Object.keys(a[g])) {
  if (!eq(a[g][n], b[g][n])) { bad++; console.log("MISMATCH", g, n, "\n JS :", JSON.stringify(a[g][n]).slice(0, 400), "\n PHP:", JSON.stringify(b[g][n]).slice(0, 400)); }
}
console.log(bad ? `${bad} 件の不一致` : `JS と PHP の結果が全 ${Object.keys(a.validate).length + Object.keys(a.patch).length} ケースで一致`);
process.exit(bad ? 1 : 0);
