import { a as require_jsx_runtime } from "../_libs/react+tanstack__react-query.mjs";
import { m as Outlet } from "../_libs/@tanstack/react-router+[...].mjs";
import { A as RedirectToSignIn, P as useCurrentUserState, f as ScreenPending } from "./router-Bc9qy-Sg.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/desk-Cc9yiFAa.js
var import_jsx_runtime = require_jsx_runtime();
function DeskGate() {
	const { user, isPending } = useCurrentUserState();
	if (isPending) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScreenPending, {
		title: "Checking sign-in",
		kicker: "Editor desk",
		hint: "Looking up the masthead…"
	});
	if (!user) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RedirectToSignIn, {});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "min-h-dvh",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Outlet, {})
	});
}
//#endregion
export { DeskGate as component };
