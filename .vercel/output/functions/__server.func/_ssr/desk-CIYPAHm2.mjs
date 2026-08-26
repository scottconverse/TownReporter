import { r as createServerFn } from "./ssr.mjs";
import { E as createSsrRpc } from "./router-Bc9qy-Sg.mjs";
import { t as deskMiddleware } from "./desk-auth-DF6Ki2aL.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/desk-CIYPAHm2.js
createServerFn({ method: "POST" }).middleware([deskMiddleware]).handler(createSsrRpc("21e554705c95fbd4760974dd8e2a0ad3cf9f293fda9c3e959092c9ae6b4c5a16"));
var listSources = createServerFn({ method: "GET" }).middleware([deskMiddleware]).handler(createSsrRpc("56dd779a0083807261885ad77038e6f2b12b22f10498fa8475105dd508dcdef2"));
var addSource = createServerFn({ method: "POST" }).middleware([deskMiddleware]).validator((input) => input).handler(createSsrRpc("51769a9fd8fe6e2eda5cd729082acd73240e474c9294d0a29d6c7f0aeefeb188"));
var addSourcesBulk = createServerFn({ method: "POST" }).middleware([deskMiddleware]).validator((input) => input).handler(createSsrRpc("506aefeace3d36211134c815b162a361d63a255c5db4e48518b2fbbb4b271f31"));
var setSourceStatus = createServerFn({ method: "POST" }).middleware([deskMiddleware]).validator((input) => input).handler(createSsrRpc("a374f4787b8cabbcfee9afa1311924c38f6f2a99f2998723de54caff1a07a323"));
var listLeads = createServerFn({ method: "GET" }).middleware([deskMiddleware]).handler(createSsrRpc("0e45bec93e6a519f7ea787dc929885eda071d06b3909d77365fd6a308d1bcb99"));
var getLead = createServerFn({ method: "GET" }).middleware([deskMiddleware]).validator((id) => id).handler(createSsrRpc("a8f41414140d307d2cc7f4c29d4f950f5b40869c6ccb8e7adcd054363e74394c"));
var listMemory = createServerFn({ method: "GET" }).middleware([deskMiddleware]).handler(createSsrRpc("c661e61d5658780328cbb3fecce94ddd0b1091621cc44571a58671ed9b35533b"));
var listScans = createServerFn({ method: "GET" }).middleware([deskMiddleware]).handler(createSsrRpc("f115cb9a86947f3ad3247c58bdb3c7f484b71bf963901833d3ab93a0c8e649ff"));
var runScan = createServerFn({ method: "POST" }).middleware([deskMiddleware]).handler(createSsrRpc("079e6d6d5a6307d948e27b98f14ebd0c7e95bcc90bf71d65c90e7c3aaf924cc5"));
var draftLead = createServerFn({ method: "POST" }).middleware([deskMiddleware]).validator((leadId) => leadId).handler(createSsrRpc("a399cbc9503f52744daa4596de96899f220b07a0d5d6df107420edb3a96429e3"));
var saveDraft = createServerFn({ method: "POST" }).middleware([deskMiddleware]).validator((input) => input).handler(createSsrRpc("cf070f9a902a1901aabfb0131c7ecbed03c92368741f5d5b60f45a8dd563363b"));
var setLeadStatus = createServerFn({ method: "POST" }).middleware([deskMiddleware]).validator((input) => input).handler(createSsrRpc("c0bc5607757a51b44990b52eb01979160194f8dbeb4ed37f734b56280f8312b8"));
var publishLead = createServerFn({ method: "POST" }).middleware([deskMiddleware]).validator((leadId) => leadId).handler(createSsrRpc("5e7de1811bdbe284a829df14d4e68aefa42807e6f353ce8e5c870cdc7fd2fee8"));
var addCorrection = createServerFn({ method: "POST" }).middleware([deskMiddleware]).validator((input) => input).handler(createSsrRpc("29bd916a64848ce79ee6e9fdcba9ca3c5e13b5b226b25aff99dc84cdf9a73aed"));
//#endregion
export { getLead as a, listScans as c, runScan as d, saveDraft as f, draftLead as i, listSources as l, setSourceStatus as m, addSource as n, listLeads as o, setLeadStatus as p, addSourcesBulk as r, listMemory as s, addCorrection as t, publishLead as u };
