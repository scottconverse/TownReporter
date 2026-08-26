import { o as __toESM } from "../_runtime.mjs";
import { c as getSql, t as PAPER } from "./paper-DHP8VcIV.mjs";
import { a as require_jsx_runtime, o as require_react, r as QueryClientProvider } from "../_libs/react+tanstack__react-query.mjs";
import { R as redirect, _ as createRootRoute, b as useRouter, f as createRouter, g as createFileRoute, h as lazyRouteComponent, l as Scripts, m as Outlet, p as useMatchRoute, u as HeadContent, v as Link, y as Navigate } from "../_libs/@tanstack/react-router+[...].mjs";
import { a as getServerFnById, i as TSS_SERVER_FUNCTION, r as createServerFn, s as __exportAll } from "./ssr.mjs";
import { B as union, F as number, I as object, N as literal, z as string } from "../_libs/@better-auth/core+[...].mjs";
import { i as signOut, t as authClient } from "./client-B40BzJxt.mjs";
import { n as auth } from "./server-BWMTqFbU.mjs";
import { t as QueryClient } from "../_libs/tanstack__query-core.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/gates-9YM9Sguo.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
/**
* Current user + loading state. Same behavior in live preview and when deployed:
*   - Auth enabled -> the real signed-in user; `user` is `null` while
*                            the session resolves (`isPending: true`) and when
*                            signed out (`isPending: false`). Session comes from
*                            Better Auth `useSession()` → `/api/auth/get-session`
*                            (cookie when deployed; bearer in live preview).
*   - Auth disabled (`VITE_AUTH_ENABLED=false`) -> `DEV_USER`, never pending.
*
* Protect a route by waiting out `isPending` before acting on `user` —
* redirecting on `user: null` alone bounces signed-in visitors to sign-in on
* every hard reload:
*
*   import { RedirectToSignIn } from "@/lib/auth/gates";
*   const { user, isPending } = useCurrentUserState();
*   if (isPending) return null;              // still resolving — don't redirect yet
*   if (!user) return <RedirectToSignIn />;  // definitely signed out
*
* `authEnabled` is a module-level constant fixed at load, so the guarded hook
* call keeps a stable hook order across every render of a given component.
*/
function useCurrentUserState() {
	const { data, isPending } = authClient.useSession();
	const user = data?.user;
	return {
		user: user ? {
			id: user.id,
			displayName: user.name ?? null,
			primaryEmail: user.email ?? null,
			profileImageUrl: user.image ?? null,
			isDevFallback: false
		} : null,
		isPending
	};
}
/**
* Convenience view of `useCurrentUserState().user` for display (e.g.
* `user?.displayName ?? "Guest"`). NOTE: `null` means *loading OR signed out* —
* for redirects/guards use `useCurrentUserState()` and check `isPending`.
*/
function useCurrentUser() {
	return useCurrentUserState().user;
}
/**
* Auth state components — plain wrappers around `useCurrentUserState()`.
*
* With auth on, visitors are signed out until they authenticate — in the sandbox
* live preview too, which does real sign-in. The shared dev user appears only
* when auth is disabled (`VITE_AUTH_ENABLED=false`, the shipped default).
* While the session is still resolving, gates that care about signed-out state
* render nothing so there's no signed-out flash on hard reload.
*/
/** Where `RedirectToSignIn` sends signed-out visitors. Create this route. */
var SIGN_IN_PATH = "/login";
/** Render children only when a user is present (real session, or the disabled-auth dev user). */
function SignedIn({ children }) {
	const { user } = useCurrentUserState();
	return user ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children }) : null;
}
/**
* Render children only once we KNOW the visitor is signed out (`isPending` has
* cleared and there is no user). Hidden while the session is still loading.
*/
function SignedOut({ children }) {
	const { user, isPending } = useCurrentUserState();
	if (isPending || user) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children });
}
/**
* Client-side redirect to the sign-in route (TanStack `<Navigate>` — NOT a full
* `window.location` reload). A hard navigation re-bootstraps the SPA and re-runs
* session loading, which feels like a second "Loading…" on /login.
*
* Guard routes by waiting out `isPending` first (see `use-current-user`), then
* render this.
*/
function RedirectToSignIn({ to = SIGN_IN_PATH }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Navigate, { to });
}
/**
* Minimal signed-in identity chip + sign-out. Restyle freely (see the
* `design-ui` skill). Sign-out is only shown when auth is enabled (the
* disabled-auth dev user has nothing to sign out of).
*/
function UserButton() {
	const user = useCurrentUser();
	const [signingOut, setSigningOut] = (0, import_react.useState)(false);
	if (!user) return null;
	const label = user.displayName ?? user.primaryEmail ?? "Account";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex items-center gap-2",
		children: [
			user.profileImageUrl ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
				src: user.profileImageUrl,
				alt: "",
				className: "h-8 w-8 rounded-full object-cover outline outline-1 -outline-offset-1 outline-ink/15"
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "grid h-8 w-8 place-items-center rounded-full bg-paper-2 text-sm font-medium text-ink",
				children: label.charAt(0).toUpperCase()
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "text-sm font-medium",
				children: label
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				disabled: signingOut,
				onClick: () => {
					setSigningOut(true);
					signOut().catch(() => setSigningOut(false));
				},
				className: "pressable inline-flex min-h-11 items-center px-2 text-sm underline-offset-4 opacity-70 transition-[opacity,color] duration-150 ease-out hover:opacity-100 hover:underline disabled:cursor-wait disabled:no-underline",
				children: signingOut ? "Signing out…" : "Sign out"
			})
		]
	});
}
//#endregion
//#region node_modules/.nitro/vite/services/ssr/assets/createSsrRpc-DMnwo9HN.js
var LINKS = [
	{
		to: "/desk",
		label: "Overview",
		exact: true
	},
	{
		to: "/desk/sources",
		label: "Sources"
	},
	{
		to: "/desk/scan",
		label: "Scan"
	},
	{
		to: "/desk/queue",
		label: "Queue"
	},
	{
		to: "/desk/dark",
		label: "Dark desk"
	},
	{
		to: "/desk/memory",
		label: "Memory"
	}
];
var inkSolid = "pressable inline-flex min-h-11 items-center justify-center bg-ink px-4 text-sm font-medium text-paper hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50";
var inkGhost = "pressable inline-flex min-h-11 items-center justify-center border border-ink px-4 text-sm font-medium hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-50";
function DeskShell({ children, title, kicker, night = false }) {
	const { user, isPending } = useCurrentUserState();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: night ? "min-h-dvh bg-ink text-paper" : "min-h-dvh bg-desk text-desk-ink",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
				href: "#desk",
				className: night ? "sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-20 focus:bg-paper focus:px-3 focus:py-2 focus:text-sm focus:text-ink" : "sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-20 focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-paper",
				children: "Skip to desk"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: night ? "border-b border-ink-2 bg-ink" : "border-b border-ink bg-paper",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/",
						className: "font-display text-lg font-semibold transition-[color] duration-150 ease-out hover:text-rust",
						children: PAPER.name
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: `text-[11px] tracking-[0.16em] uppercase ${night ? "text-paper-2" : "text-muted"}`,
						children: night ? "Dark desk — investigative engine" : "Editor-in-chief desk"
					})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center gap-3 text-sm",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: "/",
							className: night ? "inline-flex min-h-11 items-center text-paper-2 transition-[color] duration-150 ease-out hover:text-paper" : "inline-flex min-h-11 items-center text-muted transition-[color] duration-150 ease-out hover:text-ink",
							children: "View paper"
						}), isPending ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "h-8 w-8 rounded-full " + (night ? "skeleton-rule skeleton-rule-night" : "skeleton-rule"),
							"aria-hidden": true
						}) : user ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UserButton, {}) : null]
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DeskNav, { night })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
				id: "desk",
				className: "mx-auto max-w-6xl scroll-mt-4 px-4 py-8 sm:px-6",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "stagger-in",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-[11px] tracking-[0.16em] text-rust uppercase",
						children: kicker ?? "Newsroom"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						className: "mt-1 font-display text-3xl font-semibold",
						children: title
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "enter-rise mt-6",
					children
				})]
			})
		]
	});
}
function DeskNav({ night }) {
	const matchRoute = useMatchRoute();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", {
		className: "nav-rail mx-auto max-w-6xl gap-1 px-4 pb-0 sm:px-6",
		children: LINKS.map((l) => {
			const active = Boolean(matchRoute({
				to: l.to,
				fuzzy: !("exact" in l && l.exact)
			}));
			const base = "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 px-3 text-sm transition-[color,border-color] duration-150 ease-out ";
			const idle = night ? "border-transparent text-paper-2 hover:text-paper" : "border-transparent text-ink-2 hover:text-ink";
			return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: l.to,
				className: base + (active ? "border-rust text-rust" : idle),
				children: l.label
			}, l.to);
		})
	});
}
function InkButton({ children, onClick, disabled, tone = "solid", type = "button" }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
		type,
		onClick,
		disabled,
		className: "pressable inline-flex min-h-11 items-center justify-center px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 " + (tone === "solid" ? "bg-ink text-paper hover:bg-ink-2" : tone === "danger" ? "border border-danger text-danger hover:bg-paper-2" : tone === "invert" ? "bg-paper text-ink hover:bg-paper-2" : "border border-ink text-ink hover:bg-paper-2"),
		children
	});
}
function Field({ label, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
		className: "block space-y-1.5",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "text-[11px] tracking-[0.14em] text-muted uppercase",
			children: label
		}), children]
	});
}
var inputClass = "min-h-11 w-full border border-rule bg-paper px-3 text-sm text-ink outline-none transition-[border-color] duration-150 ease-out placeholder:text-muted/80 focus:border-ink";
var areaClass = "w-full border border-rule bg-paper px-3 py-2 text-sm leading-6 text-ink outline-none transition-[border-color] duration-150 ease-out placeholder:text-muted/80 focus:border-ink";
var createSsrRpc = (functionId) => {
	const url = "/_serverFn/" + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId, { origin: "server" }))(...args);
	};
	return Object.assign(fn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
//#endregion
//#region node_modules/.nitro/vite/services/ssr/assets/public-CjBMJJwP.js
var listPublishedArticles = createServerFn({ method: "GET" }).handler(createSsrRpc("bf1b86607827896e82263b26867d05e1fa0129d1ad9b15fec19b1af69cecdf6e"));
var getPublishedArticle = createServerFn({ method: "GET" }).validator((slug) => slug).handler(createSsrRpc("7fd0d893e556b31897fdd44e6a3723a05ccb5c030caa87333339048cf240876a"));
var listPublishedByTopic = createServerFn({ method: "GET" }).validator((topic) => topic).handler(createSsrRpc("babb7cb9c4dcdf79ab03f223de9e03f878eb0675085365d76b3590705b09a76e"));
var searchPublished = createServerFn({ method: "GET" }).validator((q) => q.trim().slice(0, 80)).handler(createSsrRpc("88a303f278e5f9adbd1c000cb7f47aa1648cfc72f4df2f66935d2d2063b09584"));
var listPublicCorrections = createServerFn({ method: "GET" }).handler(createSsrRpc("0fcc8492304f9b5fa80bc98d7a2efc1dd137d3e368fe2cf69852f6a4de3d0a44"));
var subscribeNewsletter = createServerFn({ method: "POST" }).validator((email) => email.trim().toLowerCase()).handler(createSsrRpc("f3458156169f228d7be94baa0c8b85503435e48cfe22384e59f3596718d7878a"));
var confirmNewsletter = createServerFn({ method: "GET" }).validator((token) => token.trim()).handler(createSsrRpc("92caba9457f6fb910c7c5881eb90e75c93dc620b103a39afe8de0242c5c5ca28"));
//#endregion
//#region node_modules/.nitro/vite/services/ssr/assets/router-Bc9qy-Sg.js
function Ornament({ busy = false, night = false }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "ornament " + (busy ? "ornament-busy " : "") + (night ? "ornament-night" : ""),
		"aria-hidden": true,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {})
		]
	});
}
function ScreenPending({ title, kicker = PAPER.kicker, hint = "Setting type…", night = false }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: night ? "grid min-h-dvh place-items-center bg-ink px-6 text-paper" : "grid min-h-dvh place-items-center bg-paper px-6 text-ink",
		role: "status",
		"aria-live": "polite",
		"aria-busy": "true",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "enter-fade max-w-sm text-center",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-[11px] tracking-[0.16em] text-rust uppercase",
					children: kicker
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "mt-2 font-display text-3xl font-semibold",
					children: title
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mt-6",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ornament, {
						busy: true,
						night
					})
				}),
				hint ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "shimmer-text mt-5 text-sm " + (night ? "text-paper-2" : "text-muted"),
					children: hint
				}) : null
			]
		})
	});
}
function EmptyState({ kicker, title, body, action, children, night = false }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: night ? "enter-fade-fast border border-paper/15 bg-ink px-5 py-12 text-center" : "enter-fade-fast border border-rule bg-paper-2 px-5 py-12 text-center",
		role: "status",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ornament, { night }),
			kicker ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-5 text-[11px] tracking-[0.16em] text-rust uppercase",
				children: kicker
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "mt-5" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "mt-2 font-display text-2xl font-semibold text-balance",
				children: title
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mx-auto mt-2 max-w-md text-pretty " + (night ? "text-paper-2" : "text-ink-2"),
				children: body
			}),
			action ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-6 flex flex-wrap justify-center gap-3",
				children: action
			}) : null,
			children ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-6",
				children
			}) : null
		]
	});
}
function Rule({ className = "", night = false }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "skeleton-rule " + (night ? "skeleton-rule-night " : "") + className,
		"aria-hidden": true
	});
}
function EditionSkeleton() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "skeleton-stack space-y-8",
		"aria-busy": "true",
		"aria-label": "Loading the edition",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "border-b border-ink pb-10",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "w-32" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "mt-4 h-8 w-5/6 sm:h-10" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "mt-3 h-8 w-3/5" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "mt-6 h-4 w-full max-w-2xl" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "mt-2 h-4 w-full max-w-xl" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "mt-2 h-4 w-2/3 max-w-lg" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "mt-5 h-4 w-36" })
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "grid gap-8 sm:grid-cols-2",
			children: [
				0,
				1,
				2,
				3
			].map((i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "border-t border-rule pt-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "w-24" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "mt-3 h-6 w-4/5" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "mt-3 h-4 w-full" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "mt-2 h-4 w-3/4" })
				]
			}, i))
		})]
	});
}
function StorySkeleton() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "skeleton-stack max-w-3xl space-y-4",
		"aria-busy": "true",
		"aria-label": "Loading story",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "w-40" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "mt-3 h-10 w-5/6" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "h-10 w-3/5" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "mt-4 h-5 w-2/3" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-8 space-y-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "h-4 w-full" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "h-4 w-full" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "h-4 w-5/6" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "h-4 w-full" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "h-4 w-3/4" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "h-4 w-full" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "h-4 w-4/5" })
				]
			})
		]
	});
}
function ListSkeleton({ rows = 4, night = false }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
		className: night ? "mt-3 divide-y divide-ink-2 border border-ink-2" : "mt-3 divide-y divide-rule border border-rule bg-paper",
		"aria-busy": "true",
		"aria-label": "Loading",
		children: Array.from({ length: rows }).map((_, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
			className: "skeleton-stack space-y-2 px-4 py-3",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, {
					night,
					className: "h-4 w-2/3"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, {
					night,
					className: "h-3 w-full"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, {
					night,
					className: "h-3 w-1/2"
				})
			]
		}, i))
	});
}
function StatSkeleton() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "grid grid-cols-2 gap-4 sm:grid-cols-4",
		"aria-busy": "true",
		children: [
			0,
			1,
			2,
			3
		].map((i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "skeleton-stack border border-rule bg-paper p-4",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "h-3 w-24" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "mt-3 h-8 w-12" })]
		}, i))
	});
}
function WorkbenchSkeleton() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "skeleton-stack max-w-3xl space-y-4",
		"aria-busy": "true",
		"aria-label": "Loading lead",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "h-4 w-full max-w-xl" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "h-4 w-2/3" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-6 flex gap-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "h-11 w-36" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "h-11 w-28" })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "mt-8 h-3 w-24" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "h-11 w-full" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "h-3 w-16" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "h-11 w-full" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "h-3 w-20" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Rule, { className: "h-40 w-full" })
		]
	});
}
function BusyLine({ label, night = false }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex items-start gap-3",
		role: "status",
		"aria-live": "polite",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "busy-rule mt-2.5 w-10 shrink-0",
			"aria-hidden": true
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "shimmer-text text-sm " + (night ? "text-paper-2" : "text-muted"),
			children: label
		})]
	});
}
function FetchingRule({ active }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "fetching-track",
		"aria-hidden": true,
		children: active ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "fetching-bar" }) : null
	}), active ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "sr-only",
		role: "status",
		children: "Updating the edition"
	}) : null] });
}
function Notice({ kind, children, night = false }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "enter-fade-fast mt-3 border px-3 py-2.5 text-sm " + (kind === "err" ? night ? "border-blush/40 text-blush" : "border-danger/35 bg-paper-2 text-danger" : night ? "border-paper/20 text-paper" : "border-ink/20 bg-paper-2 text-ink"),
		role: "status",
		children
	});
}
function AppErrorComponent({ error }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "grid min-h-dvh place-items-center bg-paper px-6 text-ink",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "stagger-in max-w-md text-center",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-[11px] tracking-[0.16em] text-rust uppercase",
					children: "TownReporter"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "mt-2 font-display text-3xl font-semibold",
					children: "Something went wrong"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-3 max-w-md text-pretty break-words text-ink-2",
					children: error.message || "An unexpected error occurred. Try reloading the page."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mt-6 flex flex-wrap justify-center gap-3",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/",
						className: inkSolid,
						children: "Back to the paper"
					})
				})
			]
		})
	});
}
function AppNotFound() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "grid min-h-dvh place-items-center bg-paper px-6 text-ink",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "stagger-in max-w-md text-center",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-[11px] tracking-[0.16em] text-rust uppercase",
					children: "TownReporter"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "mt-2 font-display text-3xl font-semibold",
					children: "No page here"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-3 text-ink-2",
					children: "That address is not in this edition. The paper is on the front page. The desk is behind sign-in."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-6 flex flex-wrap justify-center gap-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/",
						className: inkSolid,
						children: "Open the paper"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/desk",
						className: inkGhost,
						children: "Editor desk"
					})]
				})
			]
		})
	});
}
function AppPending() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScreenPending, {
		title: "Opening the edition",
		hint: "Setting type…"
	});
}
/**
* App-wide client provider mounted once near the root (in `src/routes/__root.tsx`):
*
*   <AuthProvider><Outlet /></AuthProvider>
*
* Better Auth's React client (`@/lib/auth/client`) needs NO context provider —
* its `useSession()` works standalone — so this is a passthrough today. It's
* kept as the single, stable mount point for any future client-side providers
* (e.g. a toast or theme provider) without churning the root shell.
*/
function AuthProvider({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children });
}
function isGrokEmbedderOrigin(origin) {
	try {
		const url = new URL(origin);
		if (url.protocol !== "https:" && url.protocol !== "http:") return false;
		const host = url.hostname.toLowerCase();
		if (host === "grok.com" || host.endsWith(".grok.com")) return true;
		if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
		return false;
	} catch {
		return false;
	}
}
function isSandboxPreviewGuestHost(hostname) {
	const host = hostname.toLowerCase();
	return host === "grok-sandbox.com" || host.endsWith(".grok-sandbox.com");
}
function isRemintPreviewPair(guestHost, parentHost) {
	const guest = guestHost.toLowerCase();
	const parent = parentHost.toLowerCase();
	const i = guest.indexOf(".preview.");
	if (i <= 0) return false;
	const label = guest.slice(0, i);
	const rest = guest.slice(i + 9);
	if (label.includes(".") || !rest.includes(".")) return false;
	return parent === rest || parent === `grok.${rest}`;
}
function resolveParentEmbedderOrigin(parentIsSelf, referrer, ancestorOrigin, guestHostname = "") {
	if (parentIsSelf) return null;
	for (const candidate of [referrer, ancestorOrigin ?? ""].filter(Boolean)) try {
		const url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`);
		if (url.protocol !== "https:" && url.protocol !== "http:") continue;
		if (isGrokEmbedderOrigin(url.origin)) return url.origin;
		if (isSandboxPreviewGuestHost(guestHostname) || isRemintPreviewPair(guestHostname, url.hostname)) return url.origin;
	} catch {}
	return null;
}
/**
* Guest side of the grok-web ↔ sandbox preview postMessage bridge.
*
* Activates only when this page is framed by an allowlisted Grok embedder.
* Top-level runs (download/export, local `npm run dev`, deployed sites) noop.
*/
var PREVIEW_BRIDGE_CHANNEL = "grok-preview-bridge";
var EnvelopeSchema = object({
	channel: literal(PREVIEW_BRIDGE_CHANNEL),
	version: number().int().positive(),
	type: string().min(1)
});
var HelloSchema = EnvelopeSchema.extend({ type: literal("hello") });
var NavigateSchema = EnvelopeSchema.extend({
	type: literal("navigate"),
	path: string().min(1)
});
var HistorySchema = EnvelopeSchema.extend({
	type: literal("history"),
	delta: union([literal(-1), literal(1)])
});
function isSafeBridgePath(path) {
	if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return false;
	try {
		return new URL(path, "https://preview.invalid").origin === "https://preview.invalid";
	} catch {
		return false;
	}
}
/**
* Install host↔guest messaging. Returns a dispose function.
* Noops (returns a no-op dispose) when not embedded under a Grok parent.
*/
function installPreviewHostBridge(options = {}) {
	if (typeof window === "undefined") return () => {};
	const ancestorOrigin = typeof location.ancestorOrigins !== "undefined" && location.ancestorOrigins.length > 0 ? location.ancestorOrigins[0] : null;
	const parentOrigin = resolveParentEmbedderOrigin(window.parent === window, document.referrer, ancestorOrigin, window.location.hostname);
	if (parentOrigin === null) return () => {};
	const ROOT_STATE_KEY = "__grokPreviewBridgeRoot";
	const originalPushState = window.history.pushState.bind(window.history);
	const originalReplaceState = window.history.replaceState.bind(window.history);
	const isAtHistoryRoot = () => {
		const state = window.history.state;
		return Boolean(state && typeof state === "object" && state[ROOT_STATE_KEY] === true);
	};
	try {
		const current = window.history.state;
		if (!(current !== null && typeof current === "object" && Object.prototype.hasOwnProperty.call(current, ROOT_STATE_KEY))) {
			const isRoot = window.history.length <= 1;
			originalReplaceState(current && typeof current === "object" ? {
				...current,
				[ROOT_STATE_KEY]: isRoot
			} : { [ROOT_STATE_KEY]: isRoot }, "", window.location.href);
		}
	} catch {}
	const post = (message) => {
		window.parent.postMessage(message, parentOrigin);
	};
	const reportLocation = () => {
		post({
			channel: PREVIEW_BRIDGE_CHANNEL,
			version: 1,
			type: "location",
			path: window.location.pathname || "/",
			search: window.location.search,
			hash: window.location.hash
		});
	};
	const reportRoutes = () => {
		const paths = options.getRoutePaths?.() ?? [];
		post({
			channel: PREVIEW_BRIDGE_CHANNEL,
			version: 1,
			type: "routes",
			paths
		});
	};
	const defaultNavigate = (path) => {
		if (!isSafeBridgePath(path)) return;
		try {
			const url = new URL(path, window.location.origin);
			if (url.origin !== window.location.origin) return;
			const next = `${url.pathname}${url.search}${url.hash}`;
			window.history.pushState(window.history.state, "", next);
			window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
		} catch {}
	};
	const navigate = (path) => {
		if (!isSafeBridgePath(path)) return;
		if (options.navigate) {
			options.navigate(path);
			return;
		}
		defaultNavigate(path);
	};
	const announce = () => {
		reportLocation();
		reportRoutes();
		post({
			channel: PREVIEW_BRIDGE_CHANNEL,
			version: 1,
			type: "ready"
		});
	};
	const onMessage = (event) => {
		if (event.source !== window.parent) return;
		if (event.origin !== parentOrigin) return;
		const envelope = EnvelopeSchema.safeParse(event.data);
		if (!envelope.success || envelope.data.version !== 1) return;
		if (envelope.data.type === "hello") {
			if (!HelloSchema.safeParse(event.data).success) return;
			announce();
			return;
		}
		if (envelope.data.type === "navigate") {
			const parsed = NavigateSchema.safeParse(event.data);
			if (!parsed.success) return;
			navigate(parsed.data.path);
			queueMicrotask(reportLocation);
			return;
		}
		if (envelope.data.type === "history") {
			const parsed = HistorySchema.safeParse(event.data);
			if (!parsed.success) return;
			if (parsed.data.delta === -1 && isAtHistoryRoot()) return;
			window.history.go(parsed.data.delta);
		}
	};
	const onPopState = () => {
		reportLocation();
	};
	const onHashChange = () => {
		reportLocation();
	};
	window.history.pushState = (data, unused, url) => {
		const next = data && typeof data === "object" ? {
			...data,
			[ROOT_STATE_KEY]: false
		} : data;
		originalPushState(next, unused, url);
		reportLocation();
	};
	window.history.replaceState = (data, unused, url) => {
		const next = isAtHistoryRoot() ? {
			...data && typeof data === "object" ? data : {},
			[ROOT_STATE_KEY]: true
		} : data;
		originalReplaceState(next, unused, url);
		reportLocation();
	};
	window.addEventListener("message", onMessage);
	window.addEventListener("popstate", onPopState);
	window.addEventListener("hashchange", onHashChange);
	announce();
	return () => {
		window.removeEventListener("message", onMessage);
		window.removeEventListener("popstate", onPopState);
		window.removeEventListener("hashchange", onHashChange);
		window.history.pushState = originalPushState;
		window.history.replaceState = originalReplaceState;
	};
}
/** Collect static path patterns from a TanStack route tree (best-effort). */
function collectRoutePathsFromTree(routeTree) {
	const paths = /* @__PURE__ */ new Set();
	const walk = (node) => {
		if (!node || typeof node !== "object") return;
		const record = node;
		const full = typeof record.fullPath === "string" ? record.fullPath : typeof record.path === "string" ? record.path : null;
		if (full !== null && full !== "") paths.add(full.startsWith("/") ? full : `/${full}`);
		else if (full === "") paths.add("/");
		const children = record.children;
		if (Array.isArray(children)) for (const child of children) walk(child);
		else if (children && typeof children === "object") for (const child of Object.values(children)) walk(child);
	};
	walk(routeTree);
	return [...paths];
}
/**
* Mount once in `__root.tsx` so the Grok preview chrome can drive navigation
* (and later receive registered routes). Noops when the app is not embedded.
*/
function PreviewHostBridge() {
	const router = useRouter();
	(0, import_react.useEffect)(() => {
		return installPreviewHostBridge({
			navigate: (path) => {
				router.history.push(path);
			},
			getRoutePaths: () => collectRoutePathsFromTree(router.routeTree)
		});
	}, [router]);
	return null;
}
var styles_default = "/assets/styles-Dw51LPG7.css";
var Route$19 = createRootRoute({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1"
			},
			{ title: `${PAPER.name} — ${PAPER.location}` },
			{
				name: "description",
				content: "A civic newspaper for Longmont, Colorado. Human-edited. Grok-reported from the public record."
			},
			{
				name: "theme-color",
				content: "#F6F1E7"
			}
		],
		links: [
			{
				rel: "icon",
				type: "image/svg+xml",
				href: "/favicon.svg"
			},
			{
				rel: "stylesheet",
				href: styles_default
			},
			{
				rel: "manifest",
				href: "/__grok/manifest.webmanifest"
			},
			{
				rel: "apple-touch-icon",
				href: "/__grok/icon-180.png"
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap"
			}
		]
	}),
	component: Root
});
function Root() {
	const [client] = (0, import_react.useState)(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("html", {
		lang: "en",
		className: "antialiased",
		suppressHydrationWarning: true,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("head", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(HeadContent, {}) }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("body", {
			style: {
				background: "#F6F1E7",
				color: "#1C1410",
				margin: 0
			},
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PreviewHostBridge, {}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AuthProvider, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(QueryClientProvider, {
					client,
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Outlet, {})
				}) }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Scripts, {})
			]
		})]
	});
}
var $$splitComponentImporter$16 = () => import("./routes-5S7GfXKm.mjs");
var Route$18 = createFileRoute("/")({
	validateSearch: (s) => ({
		topic: typeof s.topic === "string" ? s.topic : void 0,
		q: typeof s.q === "string" ? s.q : void 0
	}),
	loaderDeps: ({ search }) => ({
		topic: search.topic,
		q: search.q
	}),
	loader: ({ deps }) => {
		if (deps.q) return searchPublished({ data: deps.q });
		if (deps.topic) return listPublishedByTopic({ data: deps.topic });
		return listPublishedArticles();
	},
	component: lazyRouteComponent($$splitComponentImporter$16, "component")
});
var $$splitComponentImporter$15 = () => import("./TownReporter_._zip-Cq7sI1xH.mjs");
/** Old zip URL used to serve a binary and gray-screen the preview. Send people to the save page. */
var Route$17 = createFileRoute("/TownReporter.zip")({
	loader: () => {
		throw redirect({ to: "/get-the-code" });
	},
	component: lazyRouteComponent($$splitComponentImporter$15, "component")
});
var $$splitComponentImporter$14 = () => import("./about-DfT2yvwA.mjs");
var Route$16 = createFileRoute("/about")({ component: lazyRouteComponent($$splitComponentImporter$14, "component") });
var $$splitComponentImporter$13 = () => import("./corrections-kH8_FuYi.mjs");
var Route$15 = createFileRoute("/corrections")({ component: lazyRouteComponent($$splitComponentImporter$13, "component") });
var $$splitComponentImporter$12 = () => import("./desk-Cc9yiFAa.mjs");
var Route$14 = createFileRoute("/desk")({ component: lazyRouteComponent($$splitComponentImporter$12, "component") });
var Route$13 = createFileRoute("/feed")({ server: { handlers: { GET: async () => {
	const items = (await (await getSql())`
          select slug, headline, dek, published_at
          from articles
          where status = 'published'
          order by published_at desc
          limit 40
        `).map((r) => {
		const link = `/articles/${encodeURIComponent(r.slug)}`;
		return `<item>
  <title><![CDATA[${r.headline}]]></title>
  <link>${link}</link>
  <guid>${link}</guid>
  <pubDate>${new Date(r.published_at).toUTCString()}</pubDate>
  <description><![CDATA[${r.dek}]]></description>
</item>`;
	}).join("\n");
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${PAPER.name} — ${PAPER.location}</title>
  <description>${PAPER.tagline}</description>
  <language>en-us</language>
  ${items}
</channel>
</rss>`;
	return new Response(xml, { headers: {
		"content-type": "application/rss+xml; charset=utf-8",
		"cache-control": "public, max-age=300"
	} });
} } } });
var $$splitComponentImporter$11 = () => import("./get-the-code-CVqnoU9e.mjs");
var Route$12 = createFileRoute("/get-the-code")({ component: lazyRouteComponent($$splitComponentImporter$11, "component") });
var $$splitComponentImporter$10 = () => import("./how-we-report-DZb5zVuM.mjs");
var Route$11 = createFileRoute("/how-we-report")({ component: lazyRouteComponent($$splitComponentImporter$10, "component") });
var $$splitComponentImporter$9 = () => import("./login-Bk562QW-.mjs");
var Route$10 = createFileRoute("/login")({ component: lazyRouteComponent($$splitComponentImporter$9, "component") });
var $$splitComponentImporter$8 = () => import("./articles._slug-WS_lGeDG.mjs");
var Route$9 = createFileRoute("/articles/$slug")({
	loader: ({ params }) => getPublishedArticle({ data: params.slug }),
	component: lazyRouteComponent($$splitComponentImporter$8, "component")
});
var $$splitComponentImporter$7 = () => import("./desk.index-DBVww65N.mjs");
var Route$8 = createFileRoute("/desk/")({ component: lazyRouteComponent($$splitComponentImporter$7, "component") });
var $$splitComponentImporter$6 = () => import("./desk.dark-Btk1Yuo7.mjs");
var Route$7 = createFileRoute("/desk/dark")({ component: lazyRouteComponent($$splitComponentImporter$6, "component") });
var $$splitComponentImporter$5 = () => import("./desk.memory-Bbr5MFGT.mjs");
var Route$6 = createFileRoute("/desk/memory")({ component: lazyRouteComponent($$splitComponentImporter$5, "component") });
var $$splitComponentImporter$4 = () => import("./desk.queue-Bais8OUO.mjs");
var Route$5 = createFileRoute("/desk/queue")({ component: lazyRouteComponent($$splitComponentImporter$4, "component") });
var $$splitComponentImporter$3 = () => import("./desk.scan-C4TznvXG.mjs");
var Route$4 = createFileRoute("/desk/scan")({ component: lazyRouteComponent($$splitComponentImporter$3, "component") });
var $$splitComponentImporter$2 = () => import("./desk.sources-D5mXQw0c.mjs");
var Route$3 = createFileRoute("/desk/sources")({ component: lazyRouteComponent($$splitComponentImporter$2, "component") });
var $$splitComponentImporter$1 = () => import("./newsletter.confirm-Bx5Ib72a.mjs");
var Route$2 = createFileRoute("/newsletter/confirm")({
	validateSearch: (s) => ({ token: typeof s.token === "string" ? s.token : "" }),
	loaderDeps: ({ search }) => ({ token: search.token }),
	loader: async ({ deps }) => {
		if (!deps.token) return { ok: false };
		return confirmNewsletter({ data: deps.token });
	},
	component: lazyRouteComponent($$splitComponentImporter$1, "component")
});
var Route$1 = createFileRoute("/api/auth/$")({ server: { handlers: {
	GET: ({ request }) => auth.handler(request),
	POST: ({ request }) => auth.handler(request)
} } });
var $$splitComponentImporter = () => import("./desk.story._leadId-BWSQ3aSJ.mjs");
var Route = createFileRoute("/desk/story/$leadId")({ component: lazyRouteComponent($$splitComponentImporter, "component") });
var IndexRoute = Route$18.update({
	id: "/",
	path: "/",
	getParentRoute: () => Route$19
});
var TownReporterDotzipRoute = Route$17.update({
	id: "/TownReporter.zip",
	path: "/TownReporter.zip",
	getParentRoute: () => Route$19
});
var AboutRoute = Route$16.update({
	id: "/about",
	path: "/about",
	getParentRoute: () => Route$19
});
var CorrectionsRoute = Route$15.update({
	id: "/corrections",
	path: "/corrections",
	getParentRoute: () => Route$19
});
var DeskRoute = Route$14.update({
	id: "/desk",
	path: "/desk",
	getParentRoute: () => Route$19
});
var FeedRoute = Route$13.update({
	id: "/feed",
	path: "/feed",
	getParentRoute: () => Route$19
});
var GetTheCodeRoute = Route$12.update({
	id: "/get-the-code",
	path: "/get-the-code",
	getParentRoute: () => Route$19
});
var HowWeReportRoute = Route$11.update({
	id: "/how-we-report",
	path: "/how-we-report",
	getParentRoute: () => Route$19
});
var LoginRoute = Route$10.update({
	id: "/login",
	path: "/login",
	getParentRoute: () => Route$19
});
var ArticlesSlugRoute = Route$9.update({
	id: "/articles/$slug",
	path: "/articles/$slug",
	getParentRoute: () => Route$19
});
var DeskIndexRoute = Route$8.update({
	id: "/",
	path: "/",
	getParentRoute: () => DeskRoute
});
var DeskDarkRoute = Route$7.update({
	id: "/dark",
	path: "/dark",
	getParentRoute: () => DeskRoute
});
var DeskMemoryRoute = Route$6.update({
	id: "/memory",
	path: "/memory",
	getParentRoute: () => DeskRoute
});
var DeskQueueRoute = Route$5.update({
	id: "/queue",
	path: "/queue",
	getParentRoute: () => DeskRoute
});
var DeskScanRoute = Route$4.update({
	id: "/scan",
	path: "/scan",
	getParentRoute: () => DeskRoute
});
var DeskSourcesRoute = Route$3.update({
	id: "/sources",
	path: "/sources",
	getParentRoute: () => DeskRoute
});
var NewsletterConfirmRoute = Route$2.update({
	id: "/newsletter/confirm",
	path: "/newsletter/confirm",
	getParentRoute: () => Route$19
});
var ApiAuthSplatRoute = Route$1.update({
	id: "/api/auth/$",
	path: "/api/auth/$",
	getParentRoute: () => Route$19
});
var DeskRouteChildren = {
	DeskDarkRoute,
	DeskMemoryRoute,
	DeskQueueRoute,
	DeskScanRoute,
	DeskSourcesRoute,
	DeskIndexRoute,
	DeskStoryLeadIdRoute: Route.update({
		id: "/story/$leadId",
		path: "/story/$leadId",
		getParentRoute: () => DeskRoute
	})
};
var rootRouteChildren = {
	IndexRoute,
	TownReporterDotzipRoute,
	AboutRoute,
	CorrectionsRoute,
	DeskRoute: DeskRoute._addFileChildren(DeskRouteChildren),
	FeedRoute,
	GetTheCodeRoute,
	HowWeReportRoute,
	LoginRoute,
	ArticlesSlugRoute,
	NewsletterConfirmRoute,
	ApiAuthSplatRoute
};
var routeTree = Route$19._addFileChildren(rootRouteChildren)._addFileTypes();
var router_exports = /* @__PURE__ */ __exportAll({ getRouter: () => getRouter });
function getRouter() {
	return createRouter({
		routeTree,
		defaultErrorComponent: AppErrorComponent,
		defaultNotFoundComponent: AppNotFound,
		defaultPendingComponent: AppPending,
		defaultPendingMs: 120
	});
}
//#endregion
export { RedirectToSignIn as A, Field as C, inkGhost as D, createSsrRpc as E, SignedOut as M, UserButton as N, inkSolid as O, useCurrentUserState as P, DeskShell as S, areaClass as T, listPublicCorrections as _, Route$18 as a, searchPublished as b, EmptyState as c, Notice as d, ScreenPending as f, getPublishedArticle as g, WorkbenchSkeleton as h, Route$9 as i, SignedIn as j, inputClass as k, FetchingRule as l, StorySkeleton as m, Route as n, BusyLine as o, StatSkeleton as p, Route$2 as r, EditionSkeleton as s, router_exports as t, ListSkeleton as u, listPublishedArticles as v, InkButton as w, subscribeNewsletter as x, listPublishedByTopic as y };
