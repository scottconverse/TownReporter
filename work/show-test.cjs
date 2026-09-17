const fs=require("fs");
const s=fs.readFileSync("src/lib/news/story-documents.test.ts","utf8");
const i=s.indexOf("bounds one failed-extraction retry");
const j=s.indexOf("it(", i+10);
console.log("test block starts at", i, "ends at", j, "length", j-i);
console.log(s.slice(i-20, j>0?j:i+3000));
