import { a as formatDate, l as parseUrlList } from "./paper-DHP8VcIV.mjs";
import { a as require_jsx_runtime, n as useQuery } from "../_libs/react+tanstack__react-query.mjs";
import { v as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { t as PaperShell } from "./paper-chrome-B58DjJPI.mjs";
import { D as inkGhost, c as EmptyState, g as getPublishedArticle, i as Route$9, m as StorySkeleton, v as listPublishedArticles } from "./router-Bc9qy-Sg.mjs";
import { t as StoryBody } from "./story-body-Dxd6dHm4.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/articles._slug-WS_lGeDG.js
var import_jsx_runtime = require_jsx_runtime();
function ArticlePage() {
	const { slug } = Route$9.useParams();
	const loaded = Route$9.useLoaderData();
	const { data: article, isPending } = useQuery({
		queryKey: ["article", slug],
		queryFn: () => getPublishedArticle({ data: slug }),
		initialData: loaded ?? void 0
	});
	const { data: related = [] } = useQuery({
		queryKey: ["paper"],
		queryFn: () => listPublishedArticles()
	});
	if (isPending) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PaperShell, {
		compact: true,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StorySkeleton, {})
	});
	if (!article) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PaperShell, {
		compact: true,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
			kicker: "Archive",
			title: "That story is not in this edition",
			body: "It may have been held, or the address is wrong. The paper is on the front page.",
			action: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: "/",
				className: inkGhost,
				children: "Back to the paper"
			})
		})
	});
	const sources = parseUrlList(article.source_urls);
	const more = related.filter((a) => a.slug !== slug).slice(0, 4);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(PaperShell, {
		compact: true,
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "stagger-in",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-[11px] tracking-[0.16em] text-rust uppercase",
						children: [
							article.topic,
							" · ",
							formatDate(article.published_at)
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						className: "mt-3 max-w-3xl font-display text-4xl font-semibold leading-tight sm:text-5xl",
						children: article.headline
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-4 max-w-2xl text-xl italic text-ink-2",
						children: article.dek
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "enter-rise mt-8 max-w-2xl",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StoryBody, { body: article.body })
			}),
			sources.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "enter-rise mt-10 max-w-2xl border-t border-rule pt-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "text-[11px] tracking-[0.16em] text-muted uppercase",
						children: "Sources"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "mt-2 space-y-1 text-sm",
						children: sources.map((u) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
							href: u,
							className: "break-all text-rust transition-[color] duration-150 ease-out hover:text-rust-2",
							target: "_blank",
							rel: "noreferrer",
							children: u
						}) }, u))
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 text-sm text-muted",
						children: "Trust is verifiable. Check the official record before you act on a figure or a vote."
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-8 max-w-2xl text-sm text-muted",
				children: "Free to reprint in whole or part with credit to TownReporter and a link back. Do not imply endorsement."
			}),
			more.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-12 border-t-2 border-ink pt-6",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display text-2xl font-semibold",
					children: "Also in the paper"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "stagger-in mt-4 space-y-3",
					children: more.map((a) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/articles/$slug",
						params: { slug: a.slug },
						className: "font-display text-xl transition-[color] duration-150 ease-out hover:text-rust",
						children: a.headline
					}) }, a.id))
				})]
			})
		]
	});
}
//#endregion
export { ArticlePage as component };
