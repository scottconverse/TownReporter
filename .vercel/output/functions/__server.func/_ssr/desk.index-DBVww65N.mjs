import { a as require_jsx_runtime, n as useQuery } from "../_libs/react+tanstack__react-query.mjs";
import { v as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { D as inkGhost, O as inkSolid, S as DeskShell, c as EmptyState, p as StatSkeleton } from "./router-Bc9qy-Sg.mjs";
import { c as listScans, l as listSources, o as listLeads } from "./desk-CIYPAHm2.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/desk.index-DBVww65N.js
var import_jsx_runtime = require_jsx_runtime();
function DeskHome() {
	const sources = useQuery({
		queryKey: ["sources"],
		queryFn: () => listSources()
	});
	const leads = useQuery({
		queryKey: ["leads"],
		queryFn: () => listLeads()
	});
	const scans = useQuery({
		queryKey: ["scans"],
		queryFn: () => listScans()
	});
	const booting = sources.isPending && !sources.data || leads.isPending && !leads.data || scans.isPending && !scans.data;
	const accepted = (sources.data ?? []).filter((s) => s.status === "accepted").length;
	const proposed = (sources.data ?? []).filter((s) => s.status === "proposed").length;
	const openLeads = (leads.data ?? []).filter((l) => l.status === "new" || l.status === "drafted").length;
	const last = scans.data?.[0];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DeskShell, {
		title: "The desk",
		kicker: "Editor-in-chief",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "max-w-2xl text-ink-2",
				children: "You are the editor. Grok fetches Longmont’s public sources, files leads, and drafts recaps. Nothing prints until you say so. Scans and drafts spend your Grok quota — they only run when you click."
			}),
			booting ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-8",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatSkeleton, {})
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", {
				className: "stagger-in mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Sources on watch",
						value: accepted
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Proposed sources",
						value: proposed
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Open leads",
						value: openLeads
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						label: "Scans run",
						value: scans.data?.length ?? 0
					})
				]
			}),
			last ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "enter-fade-fast mt-8 border border-rule bg-paper p-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-[11px] tracking-[0.14em] text-muted uppercase",
						children: "Last scan"
					}),
					last.summary ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-ink-2",
						children: last.summary
					}) : last.error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-danger",
						children: last.error
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-2 text-ink-2",
						children: [
							last.sources_fetched,
							" sources · ",
							last.leads_created,
							" leads"
						]
					}),
					last.leads_created > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
						to: "/desk/queue",
						className: "mt-3 inline-flex min-h-11 items-center text-sm text-rust transition-[color] duration-150 ease-out hover:text-rust-2",
						children: [last.leads_created, " leads in the queue"]
					})
				]
			}) : !booting ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-8",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
					kicker: "Reporter pass",
					title: "No scans yet",
					body: "The watch list is ready. Run a scan when you want a new edition — not on a loop.",
					action: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/desk/scan",
						className: inkSolid,
						children: "Run the first scan"
					})
				})
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-8 flex flex-wrap gap-3",
				children: [
					booting || last ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/desk/scan",
						className: inkSolid,
						children: "Run a scan"
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/desk/queue",
						className: inkGhost,
						children: "Open the queue"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/desk/dark",
						className: inkSolid,
						children: "Dark desk"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/desk/sources",
						className: inkGhost,
						children: "Review sources"
					})
				]
			})
		]
	});
}
function Stat({ label, value }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "border border-rule bg-paper p-4",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("dt", {
			className: "text-[11px] tracking-[0.12em] text-muted uppercase",
			children: label
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("dd", {
			className: "mt-1 font-display text-3xl tabular-nums",
			children: value
		})]
	});
}
//#endregion
export { DeskHome as component };
