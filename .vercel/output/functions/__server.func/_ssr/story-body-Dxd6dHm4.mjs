import { a as require_jsx_runtime } from "../_libs/react+tanstack__react-query.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/story-body-Dxd6dHm4.js
var import_jsx_runtime = require_jsx_runtime();
function StoryBody({ body }) {
	const blocks = body.replace(/\r\n/g, "\n").split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "space-y-4 text-[1.05rem] leading-7 text-ink-2",
		children: blocks.map((block, i) => {
			if (block.startsWith("## ")) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "font-display text-xl font-semibold text-ink",
				children: block.slice(3)
			}, i);
			if (block.startsWith("- ")) {
				const items = block.split("\n").map((l) => l.replace(/^- /, "").trim());
				return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "list-disc space-y-1 pl-5",
					children: items.map((item, j) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: item }, j))
				}, i);
			}
			return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "whitespace-pre-wrap",
				children: block.replace(/\*\*(.+?)\*\*/g, "$1")
			}, i);
		})
	});
}
//#endregion
export { StoryBody as t };
