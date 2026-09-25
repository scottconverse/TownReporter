import { createServerFn } from "@tanstack/react-start";
import { readerArticlesInput } from "./reader-articles.ts";
import { listReaderArticles } from "./reader-articles.server.ts";

/**
 * The public reader query, as a server function.
 *
 * The schema lives in `reader-articles.ts` and the query in
 * `reader-articles.server.ts`: this file is the only one both a route and the
 * server share, and it may not hold a live reference to anything that reaches
 * the database, or the browser bundle inherits a database driver. The call
 * below sits inside the handler, which the bundler strips from the client
 * build along with the import.
 */
export const readerArticles = createServerFn({ method: "POST" })
  .validator(readerArticlesInput)
  .handler(({ data }) => listReaderArticles(data));
