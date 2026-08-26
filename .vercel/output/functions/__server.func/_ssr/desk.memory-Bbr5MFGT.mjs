import { o as __toESM } from "../_runtime.mjs";
import { o as formatShortDate } from "./paper-DHP8VcIV.mjs";
import { a as require_jsx_runtime, i as useQueryClient, n as useQuery, o as require_react, t as useMutation } from "../_libs/react+tanstack__react-query.mjs";
import { C as Field, S as DeskShell, T as areaClass, c as EmptyState, d as Notice, k as inputClass, u as ListSkeleton, w as InkButton } from "./router-Bc9qy-Sg.mjs";
import { s as listMemory, t as addCorrection } from "./desk-CIYPAHm2.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/desk.memory-Bbr5MFGT.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function MemoryPage() {
	const qc = useQueryClient();
	const memory = useQuery({
		queryKey: ["memory"],
		queryFn: () => listMemory()
	});
	const [slug, setSlug] = (0, import_react.useState)("");
	const [body, setBody] = (0, import_react.useState)("");
	const [note, setNote] = (0, import_react.useState)(null);
	const corr = useMutation({
		mutationFn: () => addCorrection({ data: {
			articleSlug: slug || void 0,
			body
		} }),
		onSuccess: (res) => {
			if (res.ok) {
				setBody("");
				setNote("Posted to the public corrections page.");
				qc.invalidateQueries({ queryKey: ["corrections"] });
				qc.invalidateQueries({ queryKey: ["memory"] });
			} else setNote("error" in res ? String(res.error) : "Could not post that correction.");
		},
		onError: (err) => {
			setNote(err instanceof Error ? err.message : "Could not post that correction.");
		}
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DeskShell, {
		title: "Memory & corrections",
		kicker: "The record",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "max-w-2xl text-ink-2",
				children: "Beat memory is what Grok is told we already covered. Corrections are public."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-8",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-display text-2xl",
						children: "Post a correction"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
						className: "mt-3 max-w-xl space-y-3",
						onSubmit: (e) => {
							e.preventDefault();
							corr.mutate();
						},
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Article slug (optional)",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									className: inputClass,
									value: slug,
									onChange: (e) => setSlug(e.target.value),
									placeholder: "welcome-to-townreporter"
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
								label: "Correction",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
									className: areaClass + " min-h-28",
									value: body,
									onChange: (e) => setBody(e.target.value),
									required: true
								})
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(InkButton, {
								type: "submit",
								disabled: corr.isPending || !body.trim(),
								children: corr.isPending ? "Posting…" : "Publish correction"
							})
						]
					}),
					note && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Notice, {
						kind: note.startsWith("Posted") ? "ok" : "err",
						children: note
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-10",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display text-2xl",
					children: "Beat memory"
				}), memory.isPending && !(memory.data ?? []).length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ListSkeleton, { rows: 3 }) : (memory.data ?? []).length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mt-3",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
						kicker: "The record",
						title: "Empty until you publish",
						body: "Beat memory is what Grok is told we already covered. It fills in when a story hits the paper."
					})
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "stagger-in mt-3 divide-y divide-rule border border-rule bg-paper",
					children: (memory.data ?? []).map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "px-4 py-3",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "font-medium",
								children: m.entity
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm text-ink-2",
								children: m.last_angle
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-[12px] text-muted",
								children: formatShortDate(m.updated_at)
							})
						]
					}, m.id))
				})]
			})
		]
	});
}
//#endregion
export { MemoryPage as component };
