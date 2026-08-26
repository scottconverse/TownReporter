import { o as formatShortDate } from "./paper-DHP8VcIV.mjs";
import { a as require_jsx_runtime, i as useQueryClient, n as useQuery, t as useMutation } from "../_libs/react+tanstack__react-query.mjs";
import { v as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { o as keepPreviousData } from "../_libs/tanstack__query-core.mjs";
import { O as inkSolid, S as DeskShell, c as EmptyState, u as ListSkeleton, w as InkButton } from "./router-Bc9qy-Sg.mjs";
import { o as listLeads, p as setLeadStatus } from "./desk-CIYPAHm2.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/desk.queue-Bais8OUO.js
var import_jsx_runtime = require_jsx_runtime();
function QueuePage() {
	const qc = useQueryClient();
	const { data: leads = [], isPending } = useQuery({
		queryKey: ["leads"],
		queryFn: () => listLeads(),
		placeholderData: keepPreviousData
	});
	const setStatus = useMutation({
		mutationFn: (input) => setLeadStatus({ data: input }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] })
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DeskShell, {
		title: "Queue",
		kicker: "Leads",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "max-w-2xl text-ink-2",
			children: "What Grok thinks is news. Draft, hold, or kill. Published items stay here as a record."
		}), isPending && leads.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ListSkeleton, { rows: 4 }) : leads.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "mt-6",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
				kicker: "Leads",
				title: "Queue is empty",
				body: "Run a scan of the watch list, or send a Dark desk signal here. Nothing prints until you open a lead and publish.",
				action: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
					to: "/desk/scan",
					className: inkSolid,
					children: "Run a scan"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
					to: "/desk/dark",
					className: "pressable inline-flex min-h-11 items-center border border-ink px-4 text-sm hover:bg-paper-2",
					children: "Dark desk"
				})] })
			})
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
			className: "stagger-in mt-6 space-y-4",
			children: leads.map((l) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
				className: "story-card border border-rule bg-paper p-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap items-baseline justify-between gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "text-[11px] tracking-[0.14em] text-muted uppercase",
							children: [
								l.topic,
								" · ",
								formatShortDate(l.created_at),
								l.newsworthiness != null ? ` · ${l.newsworthiness}/20` : ""
							]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusChip, { status: l.status })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "mt-1 font-display text-2xl",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: "/desk/story/$leadId",
							params: { leadId: String(l.id) },
							className: "transition-[color] duration-150 ease-out hover:text-rust",
							children: l.headline
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-ink-2",
						children: l.why
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-4 flex flex-wrap gap-2",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
								to: "/desk/story/$leadId",
								params: { leadId: String(l.id) },
								className: inkSolid,
								children: "Open"
							}),
							l.article_slug ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
								to: "/articles/$slug",
								params: { slug: l.article_slug },
								className: "pressable inline-flex min-h-11 items-center border border-ink px-4 text-sm hover:bg-paper-2",
								children: "On the paper"
							}) : null,
							l.status !== "held" && l.status !== "published" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InkButton, {
								tone: "ghost",
								disabled: setStatus.isPending,
								onClick: () => setStatus.mutate({
									id: l.id,
									status: "held"
								}),
								children: "Hold"
							}),
							l.status !== "killed" && l.status !== "published" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InkButton, {
								tone: "danger",
								disabled: setStatus.isPending,
								onClick: () => setStatus.mutate({
									id: l.id,
									status: "killed"
								}),
								children: "Kill"
							})
						]
					})
				]
			}, l.id))
		})]
	});
}
function StatusChip({ status }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: "inline-flex items-center border px-2 py-0.5 text-[11px] tracking-[0.12em] uppercase " + (status === "published" ? "border-rust text-rust" : status === "killed" ? "border-danger text-danger" : status === "held" ? "border-rule text-muted" : "border-ink text-ink"),
		children: status
	});
}
//#endregion
export { QueuePage as component };
