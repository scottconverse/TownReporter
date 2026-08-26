import { a as formatDate, t as PAPER } from "./paper-DHP8VcIV.mjs";
import { a as require_jsx_runtime } from "../_libs/react+tanstack__react-query.mjs";
import { p as useMatchRoute, v as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { M as SignedOut, N as UserButton, P as useCurrentUserState, j as SignedIn } from "./router-Bc9qy-Sg.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/paper-chrome-B58DjJPI.js
var import_jsx_runtime = require_jsx_runtime();
function Masthead({ compact = false }) {
	const today = formatDate(/* @__PURE__ */ new Date());
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
		className: "border-b border-ink",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
				href: "#paper",
				className: "sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-20 focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-paper",
				children: "Skip to stories"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center justify-between gap-3 border-b border-rule px-1 py-1 text-[11px] tracking-[0.14em] text-muted uppercase",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: PAPER.kicker }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "hidden sm:inline",
						children: today
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AuthSlot, {})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: compact ? "py-4 text-center" : "py-8 text-center sm:py-10",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
					to: "/",
					className: "inline-block transition-[color] duration-150 ease-out hover:text-rust",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: compact ? "font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl" : "font-display text-4xl font-semibold tracking-tight text-ink sm:text-6xl",
						children: PAPER.name
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-sm tracking-[0.18em] text-muted uppercase",
						children: PAPER.location
					})]
				}), !compact && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mx-auto mt-3 max-w-md font-display text-base italic text-ink-2",
					children: PAPER.tagline
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PaperNav, {})
		]
	});
}
function PaperNav() {
	const matchRoute = useMatchRoute();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex items-stretch border-y-2 border-ink",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("nav", {
			className: "nav-rail min-w-0 flex-1 items-center gap-x-5 px-1 py-0.5 text-[12px] font-medium tracking-[0.12em] uppercase sm:flex-wrap sm:justify-center",
			children: [[
				{
					to: "/",
					label: "The paper",
					exact: true
				},
				{
					to: "/about",
					label: "About"
				},
				{
					to: "/how-we-report",
					label: "How we report"
				},
				{
					to: "/corrections",
					label: "Corrections"
				}
			].map((item) => {
				const active = Boolean(matchRoute({
					to: item.to,
					fuzzy: !("exact" in item && item.exact)
				}));
				return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
					to: item.to,
					className: "inline-flex min-h-11 shrink-0 items-center border-b-2 px-1 transition-[color,border-color] duration-150 ease-out " + (active ? "border-rust text-rust" : "border-transparent text-ink hover:text-rust"),
					children: item.label
				}, item.to);
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
				href: "/feed",
				className: "inline-flex min-h-11 shrink-0 items-center border-b-2 border-transparent px-1 transition-[color] duration-150 ease-out hover:text-rust",
				children: "RSS"
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
			to: "/desk",
			className: "pressable inline-flex min-h-11 shrink-0 items-center bg-ink px-3 text-[12px] font-medium tracking-[0.12em] text-paper uppercase hover:bg-ink-2",
			children: "Editor desk"
		})]
	});
}
function AuthSlot() {
	const { user, isPending } = useCurrentUserState();
	if (isPending) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "skeleton-rule h-11 w-16",
		"aria-hidden": true,
		title: "Checking sign-in"
	});
	if (user) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
		className: "flex items-center gap-2 normal-case tracking-normal",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
			to: "/desk",
			className: "pressable bg-ink px-3 py-1 text-[11px] tracking-[0.12em] text-paper uppercase hover:bg-ink-2",
			children: "Desk"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SignedIn, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UserButton, {}) })]
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SignedOut, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
		to: "/login",
		className: "inline-flex min-h-11 items-center transition-[color] duration-150 ease-out hover:text-rust",
		children: "Sign in"
	}) });
}
function PaperShell({ children, compact = false }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "min-h-dvh bg-paper text-ink",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mx-auto max-w-5xl px-4 py-4 sm:px-6",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Masthead, { compact }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					id: "paper",
					className: "scroll-mt-4 py-8",
					children
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("footer", {
					className: "mt-8 border-t border-ink pt-4 pb-10 text-sm text-muted",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
						PAPER.name,
						" · ",
						PAPER.location,
						". Free to reprint with credit and a link back. Verify details against the official record."
					] })
				})
			]
		})
	});
}
function TopicChip({ topic, active }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
		to: "/",
		search: { topic },
		className: "pressable inline-flex min-h-11 shrink-0 items-center border px-3 text-[11px] tracking-[0.14em] uppercase transition-[background-color,color,border-color] duration-150 ease-out " + (active ? "border-ink bg-ink text-paper" : "border-rule text-ink-2 hover:border-ink hover:text-ink"),
		children: topic
	});
}
//#endregion
export { TopicChip as n, PaperShell as t };
