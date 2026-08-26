import { o as __toESM } from "../_runtime.mjs";
import { a as formatDate, o as formatShortDate } from "./paper-DHP8VcIV.mjs";
import { a as require_jsx_runtime, i as useQueryClient, n as useQuery, o as require_react, t as useMutation } from "../_libs/react+tanstack__react-query.mjs";
import { v as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { r as createServerFn } from "./ssr.mjs";
import { E as createSsrRpc, S as DeskShell, T as areaClass, c as EmptyState, d as Notice, o as BusyLine, u as ListSkeleton, w as InkButton } from "./router-Bc9qy-Sg.mjs";
import { t as deskMiddleware } from "./desk-auth-DF6Ki2aL.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/desk.dark-Btk1Yuo7.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var listDarkSignals = createServerFn({ method: "GET" }).middleware([deskMiddleware]).handler(createSsrRpc("3e6006df6fac7044e94a5f88a8f5233abf5de4ea74b799291d4022966ae12e34"));
var listDarkRuns = createServerFn({ method: "GET" }).middleware([deskMiddleware]).handler(createSsrRpc("ed0e725a7bea9c56f7276c2ff3f726173c5c7cd552bb421fe2ac2a177c7628d2"));
var listDarkPromises = createServerFn({ method: "GET" }).middleware([deskMiddleware]).handler(createSsrRpc("6f97a86c3c56a496a387a66c953720cf87b355303663b8b6ca5fa46c61ecb62f"));
var listInvestigations = createServerFn({ method: "GET" }).middleware([deskMiddleware]).handler(createSsrRpc("cb24cae7c2cb40b67e0cdd95fc22fb31dbc3f6d9c074666f7d2c576e5a3dd1bc"));
var getInvestigation = createServerFn({ method: "GET" }).middleware([deskMiddleware]).validator((id) => id).handler(createSsrRpc("e48c684a8f0274db48e43e6a48f5cbebe2cc99bf7d76b5f8a9e010ce7b7da5f1"));
var runDarkDesk = createServerFn({ method: "POST" }).middleware([deskMiddleware]).validator((input) => input).handler(createSsrRpc("9b255f8e2895f56be8f515b012c024fd145d7a71860053e1b3d66294b9bf5d72"));
var continueInvestigation = createServerFn({ method: "POST" }).middleware([deskMiddleware]).validator((id) => id).handler(createSsrRpc("e9fcd3306e40ea957a28af78bd4a4669497cb889d27fe8e19b27a91a200caaf0"));
var sendDarkSignalToQueue = createServerFn({ method: "POST" }).middleware([deskMiddleware]).validator((id) => id).handler(createSsrRpc("3adf87a84026d2554afed3147bc3a92b809dbf9b978c275fabba358da73f0c5d"));
function DarkPage() {
	const qc = useQueryClient();
	const [paste, setPaste] = (0, import_react.useState)("");
	const [notice, setNotice] = (0, import_react.useState)(null);
	const [openId, setOpenId] = (0, import_react.useState)(null);
	const [queuedLead, setQueuedLead] = (0, import_react.useState)(null);
	const signals = useQuery({
		queryKey: ["dark-signals"],
		queryFn: () => listDarkSignals()
	});
	const runs = useQuery({
		queryKey: ["dark-runs"],
		queryFn: () => listDarkRuns()
	});
	const promises = useQuery({
		queryKey: ["dark-promises"],
		queryFn: () => listDarkPromises()
	});
	const investigations = useQuery({
		queryKey: ["investigations"],
		queryFn: () => listInvestigations()
	});
	const detail = useQuery({
		queryKey: ["investigation", openId],
		queryFn: () => getInvestigation({ data: openId }),
		enabled: openId != null
	});
	const invalidate = () => {
		qc.invalidateQueries({ queryKey: ["dark-signals"] });
		qc.invalidateQueries({ queryKey: ["dark-runs"] });
		qc.invalidateQueries({ queryKey: ["dark-promises"] });
		qc.invalidateQueries({ queryKey: ["investigations"] });
		if (openId != null) qc.invalidateQueries({ queryKey: ["investigation", openId] });
	};
	const run = useMutation({
		mutationFn: () => runDarkDesk({ data: { paste } }),
		onSuccess: (res) => {
			if (!res.ok) {
				setNotice("error" in res ? String(res.error) : "Dark desk failed");
				return;
			}
			setNotice(null);
			setOpenId(res.investigationId);
			invalidate();
		},
		onError: (err) => {
			setNotice(err instanceof Error ? err.message : "Dark desk failed");
		}
	});
	const cont = useMutation({
		mutationFn: (id) => continueInvestigation({ data: id }),
		onSuccess: (res) => {
			if (!res.ok) {
				setNotice(res.error);
				return;
			}
			setNotice(null);
			setOpenId(res.investigationId);
			invalidate();
		},
		onError: (err) => {
			setNotice(err instanceof Error ? err.message : "Continue failed");
		}
	});
	const toQueue = useMutation({
		mutationFn: (id) => sendDarkSignalToQueue({ data: id }),
		onSuccess: (res) => {
			qc.invalidateQueries({ queryKey: ["leads"] });
			if (res.ok) {
				setQueuedLead(res.leadId);
				setNotice(`In the working queue as lead ${res.leadId}.`);
			} else setNotice(res.error);
		}
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DeskShell, {
		night: true,
		title: "Dark desk",
		kicker: "Lane 3 — investigative engine",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "max-w-2xl border border-ink-2 bg-ink-2 p-4",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Search broadly. Dig recursively. Preserve evidence. Challenge conclusions. The watch list is a starting point, not a fence. Five hops per run; continue if the frontier is still open. Publication is a separate human action." })
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
				className: "mt-6 block space-y-1.5",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "text-[11px] tracking-[0.14em] text-paper-2 uppercase",
					children: "Paste minutes, a packet, a name, a contract number — optional seed"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
					className: areaClass + " min-h-36",
					value: paste,
					onChange: (e) => setPaste(e.target.value),
					placeholder: "Transcript, staff report, an LLC, an RFP number…"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-4 flex flex-wrap items-center gap-3",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InkButton, {
					tone: "invert",
					disabled: run.isPending,
					onClick: () => run.mutate(),
					children: run.isPending ? "Digging…" : "Start investigation"
				})
			}),
			run.isPending && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "enter-fade-fast mt-6 border border-ink-2 bg-ink-2 p-4",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BusyLine, {
					night: true,
					label: "Recursive search — several hops. Stay on this page."
				})
			}),
			run.data?.ok && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "enter-fade-fast mt-6 border border-paper-2 bg-ink-2 p-4",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "font-medium",
					children: [
						"Investigation ",
						run.data.investigationId,
						" · ",
						run.data.hops,
						" hops ·",
						" ",
						run.data.artifacts,
						" artifacts · ",
						run.data.frontier,
						" frontier",
						run.data.paused ? " · paused with work remaining" : ""
					]
				}), run.data.summary && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 whitespace-pre-wrap text-paper-2",
					children: run.data.summary
				})]
			}),
			cont.isPending && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "enter-fade-fast mt-6 border border-ink-2 bg-ink-2 p-4",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BusyLine, {
					night: true,
					label: "Continuing the trail. Stay on this page."
				})
			}),
			cont.data?.ok && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "enter-fade-fast mt-6 border border-paper-2 bg-ink-2 p-4",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "font-medium",
					children: [
						"Continued investigation ",
						cont.data.investigationId,
						" · ",
						cont.data.hops,
						" hops ·",
						" ",
						cont.data.artifacts,
						" artifacts · ",
						cont.data.frontier,
						" frontier",
						cont.data.paused ? " · still open" : ""
					]
				}), cont.data.summary && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 whitespace-pre-wrap text-paper-2",
					children: cont.data.summary
				})]
			}),
			(notice || run.data && !run.data.ok) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Notice, {
				kind: "err",
				night: true,
				children: notice
			}),
			queuedLead != null && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-3 flex flex-wrap gap-4 text-sm",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
					to: "/desk/story/$leadId",
					params: { leadId: String(queuedLead) },
					className: "text-rust transition-[color] duration-150 ease-out hover:text-paper",
					children: "Open the lead"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
					to: "/desk/queue",
					className: "text-paper-2 transition-[color] duration-150 ease-out hover:text-paper",
					children: "Working queue"
				})]
			}),
			investigations.isPending && !(investigations.data ?? []).length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-10",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display text-2xl",
					children: "Investigations"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ListSkeleton, {
					rows: 3,
					night: true
				})]
			}) : (investigations.data ?? []).length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-10",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display text-2xl",
					children: "Investigations"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "mt-3 divide-y divide-ink-2 border border-ink-2",
					children: (investigations.data ?? []).map((inv) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "px-4 py-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "min-h-11 text-left",
							onClick: () => setOpenId(inv.id),
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "font-medium",
								children: [
									"#",
									inv.id,
									" ",
									inv.title
								]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "text-sm text-paper-2",
								children: [
									inv.status,
									" · ",
									inv.hops,
									" hops · ",
									formatShortDate(inv.updated_at)
								]
							})]
						}), inv.status === "paused" || inv.status === "open" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "mt-2",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InkButton, {
								tone: "invert",
								disabled: cont.isPending,
								onClick: () => {
									setOpenId(inv.id);
									cont.mutate(inv.id);
								},
								children: cont.isPending && openId === inv.id ? "Continuing…" : "Continue digging"
							})
						}) : null]
					}, inv.id))
				})]
			}) : null,
			detail.data && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-10 space-y-8",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", {
						className: "font-display text-2xl",
						children: ["Investigation ", detail.data.investigation.id]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "whitespace-pre-wrap text-paper-2",
						children: detail.data.investigation.summary
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(BlockList, {
						title: "Frontier",
						items: detail.data.frontier.map((f) => `${f.status} ${f.priority} ${f.kind}: ${f.label} — ${f.why}${f.closed_reason ? ` [${f.closed_reason}]` : ""}`)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(BlockList, {
						title: "Artifacts",
						items: detail.data.artifacts.map((a) => `${a.fetch_outcome ?? a.fetch_status ?? "?"} v${a.version_id ?? "—"} ${a.title} ${a.url}`)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(BlockList, {
						title: "Entities",
						items: detail.data.entities.map((e) => `${e.kind}: ${e.name} — ${e.why}`)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(BlockList, {
						title: "Historical matches",
						items: (detail.data.historicalEntities ?? []).map((e) => `inv ${e.investigation_id}${e.verdict ? ` ${e.verdict}` : ""}: ${e.kind}: ${e.name} — ${e.why}`)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(BlockList, {
						title: "Relationships",
						items: detail.data.relationships.map((r) => `${r.from_name} —[${r.kind}]→ ${r.to_name} (${r.evidence})${r.version_id != null ? ` v${r.version_id}` : ""}${r.capture_event_id != null ? ` c${r.capture_event_id}` : ""}${r.provenance_status === "unresolved" ? " provenance unresolved" : ""}`)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(BlockList, {
						title: "Claims",
						items: detail.data.claims.map((c) => `${c.kind}${c.confidence != null ? ` ${c.confidence}` : ""}${c.version_id != null ? ` v${c.version_id}` : ""}${c.capture_event_id != null ? ` c${c.capture_event_id}` : ""}${c.provenance_status === "unresolved" ? " provenance unresolved" : ""}: ${c.body}`)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(BlockList, {
						title: "Hypotheses",
						items: (detail.data.hypotheses ?? []).map((h) => `[${h.status}] ${h.body}`)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(BlockList, {
						title: "Anomalies",
						items: detail.data.anomalies.map((a) => `${a.kind}: ${a.summary}`)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(BlockList, {
						title: "Dead ends",
						items: detail.data.deadEnds.map((d) => `${d.hypothesis} — ${d.dismissed_because}`)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(BlockList, {
						title: "Searches",
						items: detail.data.searches.map((s) => `${s.state ?? "unknown"} hop ${s.hop}${s.provider ? ` ${s.provider}` : ""}: ${s.query}`)
					})
				]
			}),
			(promises.data ?? []).length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-10",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display text-2xl",
					children: "Promise ledger"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "mt-3 divide-y divide-ink-2 border border-ink-2",
					children: (promises.data ?? []).map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "px-4 py-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "font-medium",
							children: [
								p.who_promised,
								" — ",
								p.what
							]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "text-sm text-paper-2",
							children: [
								p.status,
								p.when_due ? ` · due ${p.when_due}` : "",
								p.source_cite ? ` · ${p.source_cite}` : ""
							]
						})]
					}, p.id))
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-10",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-display text-2xl",
						children: "Signals"
					}),
					signals.isPending && !(signals.data ?? []).length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ListSkeleton, {
						rows: 2,
						night: true
					}) : (signals.data ?? []).length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "mt-3",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
							night: true,
							kicker: "Lane 3",
							title: "No signals yet",
							body: "Start an investigation. Dark desk searches broadly, preserves evidence, and never prints on its own."
						})
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
						className: "stagger-in mt-4 space-y-4",
						children: (signals.data ?? []).map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
							className: "border border-ink-2 bg-ink-2 p-4",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
									className: "text-[11px] tracking-[0.14em] text-rust uppercase",
									children: [
										s.posture,
										" · ",
										s.signal_type,
										" · strength ",
										s.strength,
										" · confidence ",
										Number(s.confidence).toFixed(2),
										" · ",
										s.handoff,
										s.investigation_id != null ? ` · inv ${s.investigation_id}` : ""
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
									className: "mt-1 font-display text-xl",
									children: s.name
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Block, {
									label: "Observation",
									text: s.observation
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Block, {
									label: "Pattern",
									text: s.pattern
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Block, {
									label: "Linkage",
									text: s.linkage_map
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Block, {
									label: "Alternatives",
									text: s.alternatives
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Block, {
									label: "Counter-narrative",
									text: s.counter_narrative
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Block, {
									label: "What would kill this",
									text: s.what_would_kill
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Block, {
									label: "Pathway",
									text: s.pathway
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Block, {
									label: "Privacy",
									text: s.privacy_review
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "mt-3 flex flex-wrap gap-2",
									children: [(s.handoff === "FOR VERIFICATION" || s.handoff === "FINDING" || s.handoff === "CONTINUE") && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InkButton, {
										tone: "invert",
										disabled: toQueue.isPending,
										onClick: () => toQueue.mutate(s.id),
										children: "Send to working queue"
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "self-center text-sm text-paper-2",
										children: formatShortDate(s.created_at)
									})]
								})
							]
						}, s.id))
					})
				]
			}),
			(runs.data ?? []).length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-10",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display text-2xl",
					children: "Previous runs"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "mt-3 divide-y divide-ink-2 border border-ink-2",
					children: (runs.data ?? []).map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
						className: "px-4 py-3",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm text-paper-2",
								children: formatDate(r.started_at)
							}),
							r.error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-danger",
								children: r.error
							}),
							r.summary && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mt-1 whitespace-pre-wrap text-paper-2",
								children: r.summary
							})
						]
					}, r.id))
				})]
			}),
			toQueue.isSuccess && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-4 text-sm text-paper-2",
				children: [
					"In the working queue with provenance.",
					" ",
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/desk/queue",
						className: "text-rust",
						children: "Open the queue"
					})
				]
			})
		]
	});
}
function Block({ label, text }) {
	if (!text.trim()) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "mt-3",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "text-[11px] tracking-[0.14em] text-paper-2 uppercase",
			children: label
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "mt-1 whitespace-pre-wrap text-paper-2",
			children: text
		})]
	});
}
function BlockList({ title, items }) {
	if (!items.length) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
		className: "font-display text-xl",
		children: title
	}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
		className: "mt-2 list-disc space-y-1 pl-5 text-sm text-paper-2",
		children: items.map((t, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", {
			className: "break-all",
			children: t
		}, i))
	})] });
}
//#endregion
export { DarkPage as component };
