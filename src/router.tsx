import { createRouter } from "@tanstack/react-router";
import {
  AppErrorComponent,
  AppNotFound,
  AppPending,
} from "@/lib/error-component";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultErrorComponent: AppErrorComponent,
    defaultNotFoundComponent: AppNotFound,
    defaultPendingComponent: AppPending,
    defaultPendingMs: 120,
  });
}
