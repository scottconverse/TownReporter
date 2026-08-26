import { a as formatDate } from "./paper-DHP8VcIV.mjs";
import { a as require_jsx_runtime, i as useQueryClient, n as useQuery, t as useMutation } from "../_libs/react+tanstack__react-query.mjs";
import { v as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { S as DeskShell, c as EmptyState, d as Notice, o as BusyLine, u as ListSkeleton, w as InkButton } from "./router-Bc9qy-Sg.mjs";
import { c as listScans, d as runScan } from "./desk-CIYPAHm2.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/desk.scan-C4TznvXG.js
var import_jsx_runtime = require_jsx_runtime();
function ScanPage() {
	const qc = useQueryClient();
	const scans = useQuery({
		queryKey: ["scans"],
		queryFn: () => listScans()
	});
	const scan = useMutation({
		mutationFn: () => runScan(),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["scans"] });
			qc.invalidateQueries({ queryKey: ["leads"] });
			qc.invalidateQueries({ queryKey: ["sources"] });
		}
	});
	const history = scans.data ?? [];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DeskShell, {
		title: "Scan",
		kicker: "Reporter pass",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "max-w-2xl text-ink-2",
				children: "Fetches up to sixteen accepted sources, then asks Grok for leads and new official URLs. This is the expensive button. Use it when you want a new edition, not on a loop."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-6 flex flex-wrap items-center gap-3",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InkButton, {
					disabled: scan.isPending,
					onClick: () => scan.mutate(),
					children: scan.isPending ? "Scanning sources…" : "Run scan"
				})
			}),
			scan.isPending && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "enter-fade-fast mt-6 border border-rule bg-paper-2 p-4",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BusyLine, { label: "Fetching accepted sources, then one Grok pass. Stay on this page." })
			}),
			scan.data && scan.data.ok && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "enter-fade-fast mt-6 border border-ink bg-paper p-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "font-medium",
						children: [
							"Fetched ",
							scan.data.fetchedCount,
							" · leads ",
							scan.data.leadsCreated,
							" · proposed ",
							scan.data.proposed
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "mt-2 text-ink-2",
						children: scan.data.summary
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
						to: "/desk/queue",
						className: "pressable inline-flex min-h-11 items-center justify-center bg-ink px-4 text-sm font-medium text-paper hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50 mt-4",
						children: ["Open the queue", scan.data.leadsCreated ? ` (${scan.data.leadsCreated} leads)` : ""]
					})
				]
			}),
			scan.data && !scan.data.ok && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Notice, {
				kind: "err",
				children: scan.data.error
			}),
			scan.error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Notice, {
				kind: "err",
				children: scan.error instanceof Error ? scan.error.message : "Scan failed"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "mt-10 font-display text-2xl",
				children: "Previous scans"
			}),
			scans.isPending && history.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ListSkeleton, { rows: 3 }) : history.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-3",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
					kicker: "Reporter pass",
					title: "No scans yet",
					body: "Nothing has been fetched. Click Run scan when you want a new edition — not on a loop."
				})
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "stagger-in mt-3 divide-y divide-rule border border-rule bg-paper",
				children: history.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "px-4 py-3",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-sm text-muted",
							children: formatDate(s.started_at)
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "mt-1",
							children: [
								s.sources_fetched,
								" sources · ",
								s.leads_created,
								" leads",
								s.error ? ` · ${s.error}` : ""
							]
						}),
						s.summary && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-1 text-ink-2",
							children: s.summary
						})
					]
				}, s.id))
			})
		]
	});
}
//#endregion
export { ScanPage as component };
