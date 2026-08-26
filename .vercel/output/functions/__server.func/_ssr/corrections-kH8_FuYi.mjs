import { o as formatShortDate } from "./paper-DHP8VcIV.mjs";
import { a as require_jsx_runtime, n as useQuery } from "../_libs/react+tanstack__react-query.mjs";
import { v as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { t as PaperShell } from "./paper-chrome-B58DjJPI.mjs";
import { D as inkGhost, _ as listPublicCorrections, c as EmptyState, u as ListSkeleton } from "./router-Bc9qy-Sg.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/corrections-kH8_FuYi.js
var import_jsx_runtime = require_jsx_runtime();
function Corrections() {
	const { data: items = [], isPending } = useQuery({
		queryKey: ["corrections"],
		queryFn: () => listPublicCorrections()
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(PaperShell, {
		compact: true,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "enter-fade font-display text-4xl font-semibold",
				children: "Corrections"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "enter-rise mt-4 max-w-2xl text-lg text-ink-2",
				children: "If we got it wrong, it lives here in the open — not buried in a rewrite nobody sees."
			}),
			isPending ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-8 max-w-2xl",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ListSkeleton, { rows: 3 })
			}) : items.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-8 max-w-2xl",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
					kicker: "The record",
					title: "No corrections posted",
					body: "Nothing to walk back yet. If you spot an error, write the desk — we would rather look careful than look first.",
					action: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/",
						className: inkGhost,
						children: "Back to the paper"
					})
				})
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "stagger-in mt-8 max-w-2xl space-y-6",
				children: items.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "border-t border-rule pt-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-[11px] tracking-[0.14em] text-muted uppercase",
						children: [formatShortDate(c.created_at), c.headline ? ` · ${c.headline}` : ""]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-ink-2",
						children: c.body
					})]
				}, c.id))
			})
		]
	});
}
//#endregion
export { Corrections as component };
