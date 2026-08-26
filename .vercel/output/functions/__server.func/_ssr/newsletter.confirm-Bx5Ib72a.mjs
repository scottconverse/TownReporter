import { a as require_jsx_runtime } from "../_libs/react+tanstack__react-query.mjs";
import { v as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { t as PaperShell } from "./paper-chrome-B58DjJPI.mjs";
import { O as inkSolid, c as EmptyState, r as Route$2 } from "./router-Bc9qy-Sg.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/newsletter.confirm-Bx5Ib72a.js
var import_jsx_runtime = require_jsx_runtime();
function ConfirmPage() {
	const res = Route$2.useLoaderData();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PaperShell, {
		compact: true,
		children: res.ok ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
			kicker: "Newsletter",
			title: "You’re confirmed",
			body: "We’ll send new editions to that address. Nothing else.",
			action: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: "/",
				className: inkSolid,
				children: "Back to the paper"
			})
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
			kicker: "Newsletter",
			title: "That link didn’t take",
			body: "The confirmation is invalid or already used. Try subscribing from the front page again.",
			action: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: "/",
				className: inkSolid,
				children: "Back to the paper"
			})
		})
	});
}
//#endregion
export { ConfirmPage as component };
