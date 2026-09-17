const fs = require("fs");
let s = fs.readFileSync("src/lib/news/provider-login.test.ts", "utf8");
if (!s.includes("providerStatuses,\r\n")) {
  const anchor = "} from \"./provider-login.server.ts\";";
  const i = s.indexOf(anchor);
  if (i < 0) { console.error("import anchor missing"); process.exit(1); }
  s = s.slice(0, i) + "  providerStatuses,\r\n" + s.slice(i);
  fs.writeFileSync("src/lib/news/provider-login.test.ts", s);
  console.log("import added");
} else {
  console.log("already present");
}
