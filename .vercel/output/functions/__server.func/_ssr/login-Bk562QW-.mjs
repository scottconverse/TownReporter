import { t as PAPER } from "./paper-DHP8VcIV.mjs";
import { a as require_jsx_runtime } from "../_libs/react+tanstack__react-query.mjs";
import { v as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { r as signIn } from "./client-B40BzJxt.mjs";
import { t as GROK_PROVIDERS } from "./server-BWMTqFbU.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/login-Bk562QW-.js
var import_jsx_runtime = require_jsx_runtime();
function Login() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "grid min-h-dvh place-items-center bg-paper px-6 text-ink",
		style: {
			background: "#F6F1E7",
			color: "#1C1410",
			minHeight: "100dvh"
		},
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "stagger-in w-full max-w-sm space-y-5",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-[11px] tracking-[0.18em] text-rust uppercase",
						children: PAPER.name
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						className: "mt-2 font-display text-3xl font-semibold",
						children: "Editor sign-in"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-sm text-muted",
						children: "The public paper is open. The desk is not. Sign in to scan sources, draft, and publish."
					})
				] }),
				GROK_PROVIDERS.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					onClick: () => signIn(p.providerId, { callbackURL: "/desk" }),
					className: "pressable w-full min-h-11 border border-ink bg-paper px-4 text-sm hover:bg-paper-2",
					children: ["Continue with ", p.label]
				}, p.providerId)),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
					to: "/",
					className: "inline-flex min-h-11 items-center text-sm text-muted transition-[color] duration-150 ease-out hover:text-ink",
					children: "Back to the paper"
				})
			]
		})
	});
}
//#endregion
export { Login as component };
