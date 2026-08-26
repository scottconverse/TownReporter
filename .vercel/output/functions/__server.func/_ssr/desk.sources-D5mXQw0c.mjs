import { o as __toESM } from "../_runtime.mjs";
import { o as formatShortDate } from "./paper-DHP8VcIV.mjs";
import { a as require_jsx_runtime, i as useQueryClient, n as useQuery, o as require_react, t as useMutation } from "../_libs/react+tanstack__react-query.mjs";
import { C as Field, S as DeskShell, T as areaClass, c as EmptyState, d as Notice, k as inputClass, u as ListSkeleton, w as InkButton } from "./router-Bc9qy-Sg.mjs";
import { l as listSources, m as setSourceStatus, n as addSource, r as addSourcesBulk } from "./desk-CIYPAHm2.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/desk.sources-D5mXQw0c.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function SourcesPage() {
	const qc = useQueryClient();
	const fileRef = (0, import_react.useRef)(null);
	const { data: sources = [], isPending, error: listError } = useQuery({
		queryKey: ["sources"],
		queryFn: () => listSources()
	});
	const [url, setUrl] = (0, import_react.useState)("");
	const [title, setTitle] = (0, import_react.useState)("");
	const [bulk, setBulk] = (0, import_react.useState)("");
	const [notice, setNotice] = (0, import_react.useState)(null);
	const add = useMutation({
		mutationFn: () => addSource({ data: {
			url,
			title,
			kind: "official",
			tier: "A"
		} }),
		onSuccess: (res) => {
			if (!res.ok) {
				setNotice({
					kind: "err",
					text: res.error
				});
				return;
			}
			setUrl("");
			setTitle("");
			setNotice({
				kind: "ok",
				text: `On watch: ${res.source.title}`
			});
			qc.invalidateQueries({ queryKey: ["sources"] });
		},
		onError: (err) => {
			const msg = err instanceof Error ? err.message : "Could not add that source.";
			setNotice({
				kind: "err",
				text: msg === "Unauthorized" ? "Session expired. Sign in again, then retry." : msg
			});
		}
	});
	const addBulk = useMutation({
		mutationFn: (text) => addSourcesBulk({ data: { text } }),
		onSuccess: (res) => {
			if (!res.ok) {
				setNotice({
					kind: "err",
					text: res.error
				});
				return;
			}
			setBulk("");
			const t = res.byTier;
			setNotice({
				kind: "ok",
				text: `Added ${res.added} sources (A ${t.A} · B ${t.B} · C ${t.C}). Tier C is scanned as a discovery clue, never treated as fact.`
			});
			qc.invalidateQueries({ queryKey: ["sources"] });
		},
		onError: (err) => {
			const msg = err instanceof Error ? err.message : "Bulk add failed.";
			setNotice({
				kind: "err",
				text: msg === "Unauthorized" ? "Session expired. Sign in again, then retry." : msg
			});
		}
	});
	const setStatus = useMutation({
		mutationFn: (input) => setSourceStatus({ data: input }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] })
	});
	const proposed = sources.filter((s) => s.status === "proposed");
	const watch = sources.filter((s) => s.status === "accepted");
	const rejected = sources.filter((s) => s.status === "rejected");
	async function onPickFile(file) {
		if (!file) return;
		const text = await file.text();
		setBulk(text);
		setNotice(null);
		addBulk.mutate(text);
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DeskShell, {
		title: "Sources",
		kicker: "Watch list",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "max-w-2xl text-ink-2",
				children: "Official pages Grok is allowed to fetch. Paste a registry or pick a .txt / .md / .csv. TIER A/B/C headers are honored. Community URLs stay on the list as signals and are not scanned."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "mt-6 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end",
				onSubmit: (e) => {
					e.preventDefault();
					setNotice(null);
					add.mutate();
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "URL",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							className: inputClass,
							value: url,
							onChange: (e) => setUrl(e.target.value),
							placeholder: "https://www.longmontcolorado.gov/…",
							required: true
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Name",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							className: inputClass,
							value: title,
							onChange: (e) => setTitle(e.target.value),
							placeholder: "City Council packets"
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(InkButton, {
						type: "submit",
						disabled: add.isPending || !url.trim(),
						children: add.isPending ? "Adding…" : "Add source"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "mt-8 max-w-3xl space-y-3",
				onSubmit: (e) => {
					e.preventDefault();
					setNotice(null);
					addBulk.mutate(bulk);
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Bulk paste or file",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
							className: areaClass + " min-h-36",
							value: bulk,
							onChange: (e) => setBulk(e.target.value),
							placeholder: `TIER A — OFFICIAL RECORD
* City Council: https://www.longmontcolorado.gov/departments/departments-a-d/city-council
TIER B — JOURNALISM
* Times-Call: https://www.timescall.com/`
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted",
						children: "Markdown bullets, Title | URL, or CSV. Up to 400 URLs. Duplicate URLs update in place."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-wrap gap-2",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(InkButton, {
								type: "submit",
								disabled: addBulk.isPending || !bulk.trim(),
								children: addBulk.isPending ? "Adding list…" : "Add list"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(InkButton, {
								tone: "ghost",
								disabled: addBulk.isPending,
								onClick: () => fileRef.current?.click(),
								children: "Pick a .txt or .csv"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								ref: fileRef,
								type: "file",
								accept: ".txt,.csv,.md,.tsv,text/plain,text/csv,text/markdown",
								className: "hidden",
								onChange: (e) => {
									const file = e.target.files?.[0];
									e.target.value = "";
									onPickFile(file);
								}
							})
						]
					})
				]
			}),
			notice && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Notice, {
				kind: notice.kind,
				children: notice.text
			}),
			listError && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Notice, {
				kind: "err",
				children: ["Could not load sources.", listError instanceof Error && listError.message === "Unauthorized" ? " Sign in again." : ""]
			}),
			isPending && sources.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-10",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ListSkeleton, { rows: 5 })
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
				proposed.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "mt-10",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-display text-2xl",
						children: "Proposed by Grok"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SourceTable, {
						rows: proposed,
						onAccept: (id) => setStatus.mutate({
							id,
							status: "accepted"
						}),
						onReject: (id) => setStatus.mutate({
							id,
							status: "rejected"
						})
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "mt-10",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "font-display text-2xl",
							children: "On watch"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-1 text-sm text-muted",
							children: "The starting list, not the universe. Tier C is fetched as a clue."
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SourceTable, {
							rows: watch,
							onReject: (id) => setStatus.mutate({
								id,
								status: "rejected"
							}),
							emptyTitle: "Nothing on watch",
							emptyBody: "Add an official URL above, or paste a registry. Scans only fetch accepted sources."
						})
					]
				}),
				rejected.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "mt-10",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-display text-2xl",
						children: "Rejected"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SourceTable, {
						rows: rejected,
						onAccept: (id) => setStatus.mutate({
							id,
							status: "accepted"
						})
					})]
				})
			] })
		]
	});
}
function SourceTable({ rows, onAccept, onReject, emptyTitle, emptyBody }) {
	if (rows.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "mt-3",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
			kicker: "Watch list",
			title: emptyTitle ?? "None",
			body: emptyBody ?? "Nothing in this list."
		})
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
		className: "stagger-in mt-3 divide-y divide-rule border border-rule bg-paper",
		children: rows.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
			className: "flex flex-col gap-2 px-4 py-3 transition-[background-color] duration-150 ease-out hover:bg-paper-2 sm:flex-row sm:items-start sm:justify-between",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "min-w-0",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "font-medium",
						children: s.title
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
						href: s.url,
						className: "break-all text-sm text-rust transition-[color] duration-150 ease-out hover:text-rust-2",
						target: "_blank",
						rel: "noreferrer",
						children: s.url
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "mt-1 text-[12px] text-muted",
						children: [
							"Tier ",
							s.tier,
							" · ",
							s.kind,
							s.last_fetched_at ? ` · fetched ${formatShortDate(s.last_fetched_at)}` : "",
							s.last_error ? ` · ${s.last_error}` : ""
						]
					})
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex gap-2",
				children: [onAccept && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InkButton, {
					tone: "ghost",
					onClick: () => onAccept(s.id),
					children: "Accept"
				}), onReject && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InkButton, {
					tone: "ghost",
					onClick: () => onReject(s.id),
					children: "Drop"
				})]
			})]
		}, s.id))
	});
}
//#endregion
export { SourcesPage as component };
