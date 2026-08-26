import { o as __toESM } from "../_runtime.mjs";
import { l as parseUrlList } from "./paper-DHP8VcIV.mjs";
import { a as require_jsx_runtime, i as useQueryClient, n as useQuery, o as require_react, t as useMutation } from "../_libs/react+tanstack__react-query.mjs";
import { v as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { C as Field, S as DeskShell, c as EmptyState, d as Notice, h as WorkbenchSkeleton, n as Route, o as BusyLine, w as InkButton } from "./router-Bc9qy-Sg.mjs";
import { a as getLead, f as saveDraft, i as draftLead, u as publishLead } from "./desk-CIYPAHm2.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/desk.story._leadId-BWSQ3aSJ.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function StoryPage() {
	const { leadId } = Route.useParams();
	const id = Number(leadId);
	const qc = useQueryClient();
	const { data, isPending } = useQuery({
		queryKey: ["lead", id],
		queryFn: () => getLead({ data: id })
	});
	const [headline, setHeadline] = (0, import_react.useState)("");
	const [dek, setDek] = (0, import_react.useState)("");
	const [body, setBody] = (0, import_react.useState)("");
	const [topic, setTopic] = (0, import_react.useState)("council");
	const [msg, setMsg] = (0, import_react.useState)("");
	const [publishedSlug, setPublishedSlug] = (0, import_react.useState)(null);
	(0, import_react.useEffect)(() => {
		if (!data?.draft) return;
		setHeadline(data.draft.headline);
		setDek(data.draft.dek);
		setBody(data.draft.body);
		setTopic(data.draft.topic);
		if (data.articleSlug) setPublishedSlug(data.articleSlug);
	}, [data?.draft, data?.articleSlug]);
	const draft = useMutation({
		mutationFn: () => draftLead({ data: id }),
		onSuccess: async (res) => {
			if (!res.ok) {
				setMsg(res.error);
				return;
			}
			setMsg("");
			await qc.invalidateQueries({ queryKey: ["lead", id] });
			await qc.invalidateQueries({ queryKey: ["leads"] });
		}
	});
	const save = useMutation({
		mutationFn: () => saveDraft({ data: {
			leadId: id,
			headline,
			dek,
			body,
			topic
		} }),
		onSuccess: () => setMsg("Saved.")
	});
	const publish = useMutation({
		mutationFn: async () => {
			await saveDraft({ data: {
				leadId: id,
				headline,
				dek,
				body,
				topic
			} });
			return publishLead({ data: id });
		},
		onSuccess: async (res) => {
			if (!res.ok) {
				setMsg(res.error);
				return;
			}
			await qc.invalidateQueries({ queryKey: ["leads"] });
			await qc.invalidateQueries({ queryKey: ["paper"] });
			setPublishedSlug(res.slug);
			setMsg("On the paper. You are still at the desk.");
		}
	});
	if (isPending) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DeskShell, {
		title: "Story",
		kicker: "Workbench",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(WorkbenchSkeleton, {})
	});
	if (!data) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DeskShell, {
		title: "Missing",
		kicker: "Workbench",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
			kicker: "Workbench",
			title: "That lead is not on this desk",
			body: "It may have been killed, or this copy of the desk never filed it. The queue has what is still open.",
			action: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: "/desk/queue",
				className: "pressable inline-flex min-h-11 items-center border border-ink px-4 text-sm hover:bg-paper-2",
				children: "Back to queue"
			})
		})
	});
	const sources = parseUrlList(data.lead.source_urls);
	const fromDark = data.lead.why.includes("DARK DESK investigation") || data.lead.headline.startsWith("[Dark]");
	const locked = data.lead.status === "killed";
	const canPublish = Boolean(data.draft) && data.lead.status !== "held" && !locked && data.lead.status !== "published" && !publishedSlug;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DeskShell, {
		title: data.lead.headline,
		kicker: fromDark ? "Working notes from Dark desk" : "Workbench",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "max-w-2xl text-ink-2",
				children: data.lead.why
			}),
			fromDark && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-4 max-w-2xl border border-ink bg-paper-2 p-4 text-sm",
				children: "This trail came from Dark desk. You can write working notes and a private draft here. Printing is still a separate click, and every claim still needs evidence."
			}),
			data.lead.evidence && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("blockquote", {
				className: "mt-4 max-w-2xl border-l-2 border-rust pl-4 text-sm text-ink-2",
				children: data.lead.evidence
			}),
			sources.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-3 text-sm",
				children: sources.map((u) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
					href: u,
					className: "break-all text-rust transition-[color] duration-150 ease-out hover:text-rust-2",
					target: "_blank",
					rel: "noreferrer",
					children: u
				}) }, u))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-6 flex flex-wrap gap-3",
				children: [
					!locked && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InkButton, {
						disabled: draft.isPending,
						onClick: () => draft.mutate(),
						children: draft.isPending ? "Drafting with Grok…" : data.draft ? "Redraft" : "Draft with Grok"
					}),
					!locked && data.draft && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(InkButton, {
						tone: "ghost",
						disabled: save.isPending,
						onClick: () => save.mutate(),
						children: "Save edits"
					}), canPublish && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(InkButton, {
						disabled: publish.isPending || !headline || !body,
						onClick: () => publish.mutate(),
						children: publish.isPending ? "Publishing…" : "Publish to the paper"
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/desk/queue",
						className: "self-center text-sm text-muted transition-[color] duration-150 ease-out hover:text-ink",
						children: "Back to queue"
					})
				]
			}),
			draft.isPending && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "enter-fade-fast mt-4 max-w-2xl border border-rule bg-paper-2 p-4",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BusyLine, { label: "Grok is drafting under wire-service rules. Stay on this page." })
			}),
			publish.isPending && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "enter-fade-fast mt-4 max-w-2xl border border-rule bg-paper-2 p-4",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(BusyLine, { label: "Sending this to the paper…" })
			}),
			msg && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Notice, {
				kind: msg.startsWith("On the paper") || msg === "Saved." ? "ok" : "err",
				children: msg
			}),
			publishedSlug && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-3 flex flex-wrap gap-4 text-sm",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/articles/$slug",
						params: { slug: publishedSlug },
						className: "text-rust hover:text-rust-2",
						children: "Read it on the paper"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/desk/queue",
						className: "text-ink hover:text-rust",
						children: "Queue"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/desk",
						className: "text-ink hover:text-rust",
						children: "Desk overview"
					})
				]
			}),
			data.draft?.integrity_notes && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-4 max-w-2xl border border-rule bg-paper-2 p-3 text-sm",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "tracking-[0.12em] text-muted uppercase",
					children: "Verify · "
				}), data.draft.integrity_notes]
			}),
			!locked && data.draft && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				className: "mt-8 max-w-3xl space-y-4",
				onSubmit: (e) => e.preventDefault(),
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Headline",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							className: "min-h-11 w-full border border-rule bg-paper px-3 text-sm text-ink outline-none transition-[border-color] duration-150 ease-out placeholder:text-muted/80 focus:border-ink",
							value: headline,
							onChange: (e) => setHeadline(e.target.value)
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Dek",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							className: "min-h-11 w-full border border-rule bg-paper px-3 text-sm text-ink outline-none transition-[border-color] duration-150 ease-out placeholder:text-muted/80 focus:border-ink",
							value: dek,
							onChange: (e) => setDek(e.target.value)
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Topic",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							className: "min-h-11 w-full border border-rule bg-paper px-3 text-sm text-ink outline-none transition-[border-color] duration-150 ease-out placeholder:text-muted/80 focus:border-ink",
							value: topic,
							onChange: (e) => setTopic(e.target.value)
						})
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Field, {
						label: "Body",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
							className: "w-full border border-rule bg-paper px-3 py-2 text-sm leading-6 text-ink outline-none transition-[border-color] duration-150 ease-out placeholder:text-muted/80 focus:border-ink min-h-80",
							value: body,
							onChange: (e) => setBody(e.target.value)
						})
					})
				]
			})
		]
	});
}
//#endregion
export { StoryPage as component };
