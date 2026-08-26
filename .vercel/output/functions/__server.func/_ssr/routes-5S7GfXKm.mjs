import { o as __toESM } from "../_runtime.mjs";
import { o as formatShortDate, r as TOPICS, t as PAPER } from "./paper-DHP8VcIV.mjs";
import { a as require_jsx_runtime, n as useQuery, o as require_react, t as useMutation } from "../_libs/react+tanstack__react-query.mjs";
import { v as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as TopicChip, t as PaperShell } from "./paper-chrome-B58DjJPI.mjs";
import { o as keepPreviousData } from "../_libs/tanstack__query-core.mjs";
import { D as inkGhost, O as inkSolid, a as Route$18, b as searchPublished, c as EmptyState, d as Notice, k as inputClass, l as FetchingRule, s as EditionSkeleton, v as listPublishedArticles, x as subscribeNewsletter, y as listPublishedByTopic } from "./router-Bc9qy-Sg.mjs";
import { t as StoryBody } from "./story-body-Dxd6dHm4.mjs";
import { n as ArrowRight, t as Search } from "../_libs/lucide-react.mjs";
import { t as twMerge } from "../_libs/tailwind-merge.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-5S7GfXKm.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function Home() {
	const { topic, q } = Route$18.useSearch();
	const navigate = Route$18.useNavigate();
	const [query, setQuery] = (0, import_react.useState)(q ?? "");
	const [email, setEmail] = (0, import_react.useState)("");
	(0, import_react.useEffect)(() => {
		setQuery(q ?? "");
	}, [q]);
	const initial = Route$18.useLoaderData();
	const { data, isPending, isFetching, isPlaceholderData } = useQuery({
		queryKey: [
			"paper",
			topic,
			q
		],
		queryFn: () => {
			if (q) return searchPublished({ data: q });
			if (topic) return listPublishedByTopic({ data: topic });
			return listPublishedArticles();
		},
		initialData: initial,
		placeholderData: keepPreviousData
	});
	const articles = data ?? initial;
	const sub = useMutation({
		mutationFn: (addr) => subscribeNewsletter({ data: addr }),
		onSuccess: (res) => {
			if (!res.ok) return;
			setEmail("");
		}
	});
	const featured = articles[0];
	const rest = articles.slice(1);
	const showSkeleton = isPending && !featured && !isPlaceholderData;
	const empty = !isPending && !isPlaceholderData && !featured;
	const dimming = isFetching && !showSkeleton;
	let emptyTitle = "The edition is still being set";
	let emptyBody = "No stories on the paper yet. The editor is working the desk — check back, or read how we report.";
	if (q) {
		emptyTitle = `Nothing matched “${q}”`;
		emptyBody = "Try a different word, or return to the full edition.";
	} else if (topic) {
		emptyTitle = `No ${topic} stories yet`;
		emptyBody = "That beat is quiet in this edition. See everything that has printed, or pick another topic.";
	}
	function clearSearch() {
		setQuery("");
		navigate({ search: {} });
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(PaperShell, { children: [
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "chip-rail",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
					to: "/",
					className: "pressable inline-flex min-h-11 shrink-0 items-center border px-3 text-[11px] tracking-[0.14em] uppercase transition-[background-color,color,border-color] duration-150 ease-out " + (!topic && !q ? "border-ink bg-ink text-paper" : "border-rule text-ink-2 hover:border-ink hover:text-ink"),
					children: "all"
				}), TOPICS.filter((t) => t !== "about").map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TopicChip, {
					topic: t,
					active: topic === t
				}, t))]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "flex min-h-11 flex-col gap-2 sm:flex-row",
				"aria-label": "Search the archive",
				onSubmit: (e) => {
					e.preventDefault();
					navigate({ search: {
						q: query.trim() || void 0,
						topic: void 0
					} });
				},
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
					className: "relative block min-w-0 flex-1 sm:w-56 sm:flex-none",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "sr-only",
							children: "Search the archive"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Search, {
							className: "pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted",
							strokeWidth: 1.75,
							"aria-hidden": true
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							type: "search",
							value: query,
							onChange: (e) => setQuery(e.target.value),
							placeholder: "Search the archive",
							enterKeyHint: "search",
							className: twMerge(inputClass, "w-full pl-10")
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "submit",
						className: inkGhost + " flex-1 sm:flex-none",
						children: isFetching && q ? "Searching…" : "Search"
					}), q ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: clearSearch,
						className: inkGhost + " flex-1 sm:flex-none",
						children: "Clear"
					}) : null]
				})]
			})]
		}),
		q ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "enter-fade-fast mb-3 text-sm text-muted",
			children: [
				"Archive search for “",
				q,
				"”"
			]
		}) : topic ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
			className: "enter-fade-fast mb-3 text-sm text-muted",
			children: ["Beat: ", topic]
		}) : null,
		/* @__PURE__ */ (0, import_jsx_runtime.jsx)(FetchingRule, { active: dimming }),
		showSkeleton ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-6",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EditionSkeleton, {})
		}) : null,
		empty ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-6",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
				kicker: topic ?? (q ? "Archive" : "The paper"),
				title: emptyTitle,
				body: emptyBody,
				action: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [(topic || q) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
					to: "/",
					search: {},
					className: "pressable inline-flex min-h-11 items-center justify-center bg-ink px-4 text-sm font-medium text-paper hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50",
					children: "Full edition"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
					to: "/how-we-report",
					className: inkGhost,
					children: "How we report"
				})] }),
				children: q || topic ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "chip-rail justify-center",
					children: TOPICS.filter((t) => t !== "about" && t !== topic).slice(0, 6).map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TopicChip, { topic: t }, t))
				}) : null
			})
		}) : null,
		featured && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: dimming ? "is-fetching" : void 0,
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
				className: "stagger-in mt-6 border-b border-ink pb-10",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-[11px] tracking-[0.16em] text-rust uppercase",
						children: [
							featured.topic,
							" · ",
							formatShortDate(featured.published_at)
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "mt-2 font-display text-3xl font-semibold leading-tight sm:text-5xl",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: "/articles/$slug",
							params: { slug: featured.slug },
							className: "transition-[color] duration-150 ease-out hover:text-rust",
							children: featured.headline
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-3 max-w-3xl text-lg italic text-ink-2",
						children: featured.dek
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-6 max-w-2xl",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StoryBody, { body: featured.body.split("\n\n").slice(0, 2).join("\n\n") }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
							to: "/articles/$slug",
							params: { slug: featured.slug },
							className: "group mt-4 inline-flex min-h-11 items-center gap-1 text-sm text-rust transition-[color] duration-150 ease-out hover:text-rust-2",
							children: ["Continue reading", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowRight, {
								className: "size-4 transition-transform duration-150 ease-out group-hover:translate-x-1",
								strokeWidth: 1.75,
								"aria-hidden": true
							})]
						})]
					})
				]
			}), rest.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "stagger-in mt-8 grid gap-8 sm:grid-cols-2",
				children: rest.map((a) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
					className: "border-t border-rule pt-4",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "text-[11px] tracking-[0.16em] text-muted uppercase",
							children: [
								a.topic,
								" · ",
								formatShortDate(a.published_at)
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
							className: "mt-1 font-display text-2xl font-semibold leading-snug",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
								to: "/articles/$slug",
								params: { slug: a.slug },
								className: "transition-[color] duration-150 ease-out hover:text-rust",
								children: a.headline
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-2 text-ink-2",
							children: a.dek
						})
					]
				}, a.id))
			})]
		}),
		/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "mt-14 border-t-2 border-ink pt-8",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display text-2xl font-semibold",
					children: "In your inbox"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 max-w-xl text-ink-2",
					children: "New articles when they publish. No spam. We store the address to send the paper; we do not sell it."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
					className: "mt-4 flex max-w-md flex-col gap-2 sm:flex-row",
					onSubmit: (e) => {
						e.preventDefault();
						sub.mutate(email);
					},
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						type: "email",
						required: true,
						autoComplete: "email",
						value: email,
						onChange: (e) => setEmail(e.target.value),
						placeholder: "you@example.com",
						className: inputClass + " flex-1",
						disabled: sub.isPending
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						type: "submit",
						className: inkSolid,
						disabled: sub.isPending,
						children: sub.isPending ? "Sending…" : "Subscribe"
					})]
				}),
				sub.data && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Notice, {
					kind: !sub.data.ok ? "err" : "ok",
					children: !sub.data.ok ? sub.data.error : sub.data.confirmPath ? `Confirm: ${sub.data.confirmPath} (preview — production would email this).` : "You’re already on the list."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "mt-6 text-sm text-muted",
					children: [PAPER.name, " complements the local paper. We cover the meetings and packets most people never sit through."]
				})
			]
		})
	] });
}
//#endregion
export { Home as component };
