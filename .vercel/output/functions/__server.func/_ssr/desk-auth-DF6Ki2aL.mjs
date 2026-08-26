import { n as createMiddleware } from "./ssr.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/desk-auth-DF6Ki2aL.js
/**
* Authenticated AND a newsroom member (owner/editor).
* First user to hit the desk becomes owner; later identities are 403.
*/
var deskMiddleware = createMiddleware({ type: "function" }).client(async ({ next }) => {
	const { getBearerToken } = await import("./client-B40BzJxt.mjs").then((n) => n.n).then((n) => n.n);
	return next({ sendContext: { bearerToken: getBearerToken() ?? void 0 } });
}).server(async ({ next, context }) => {
	const { assertSameSiteRequest } = await import("./isolation.server-CGNg1r0B.mjs");
	const { requireUserId } = await import("./verify.server-D6PptSON.mjs");
	const { requireEditor } = await import("./membership-CCLGnxOQ.mjs");
	assertSameSiteRequest();
	const userId = await requireUserId(context.bearerToken);
	await requireEditor(userId);
	return next({ context: { userId } });
});
//#endregion
export { deskMiddleware as t };
