import { t as PAPER } from "./paper-DHP8VcIV.mjs";
import { a as require_jsx_runtime } from "../_libs/react+tanstack__react-query.mjs";
import { v as Link } from "../_libs/@tanstack/react-router+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/get-the-code-CVqnoU9e.js
var import_jsx_runtime = require_jsx_runtime();
/** Temporary public hosts. Preview iframe cannot save a blob. */
var SOURCE_ZIP_URL = "https://tmpfiles.org/dl/1787681717.7ca1f07217321375/wRwpGNKBXnh9/townreporter.zip";
var SOURCE_ZIP_BACKUP = "https://litter.catbox.moe/0h19m8.zip";
function openZip(url) {
	if (!window.open(url, "_blank", "noopener,noreferrer")) window.prompt("Copy this into a new Chrome or Safari tab:", url);
}
/** href stays on-origin so this preview never navigates to a zip (gray sad face). */
function SourceZipButton({ children, className }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
		href: "/get-the-code",
		className,
		onClick: (e) => {
			e.preventDefault();
			openZip(SOURCE_ZIP_URL);
		},
		children
	});
}
function SourceZipBackupLink({ className }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
		href: "/get-the-code",
		className,
		onClick: (e) => {
			e.preventDefault();
			openZip(SOURCE_ZIP_BACKUP);
		},
		children: "Backup link"
	});
}
function SourceZipUrl() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", {
		className: "block break-all text-sm",
		style: {
			wordBreak: "break-all",
			userSelect: "all"
		},
		children: SOURCE_ZIP_URL
	});
}
function GetTheCode() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "grid min-h-dvh place-items-center bg-paper px-6 text-ink",
		style: {
			background: "#F6F1E7",
			color: "#1C1410",
			minHeight: "100dvh"
		},
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "w-full max-w-md space-y-5",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-[11px] tracking-[0.18em] text-rust uppercase",
					children: PAPER.name
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "font-display text-3xl font-semibold",
					children: "Download the source"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-ink-2",
					children: "The black button opens a real browser tab. This preview cannot save files itself."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SourceZipButton, {
					className: "inline-flex min-h-12 w-full items-center justify-center bg-ink px-5 text-sm font-medium text-paper hover:bg-ink-2",
					children: "Download TownReporter.zip"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-sm text-muted",
					children: "Paste this into Chrome or Safari if the button is blocked:"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SourceZipUrl, {}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "text-sm text-muted",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SourceZipBackupLink, { className: "underline hover:text-ink" }), " if the first link is gone."]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
					to: "/",
					className: "text-sm text-muted hover:text-ink",
					children: "Back to the paper"
				}) })
			]
		})
	});
}
//#endregion
export { GetTheCode as component };
