declare module "word-extractor" {
  export default class WordExtractor {
    extract(
      input: Buffer,
    ): Promise<{
      getBody(): string;
      getTextboxes(): string;
      getFootnotes(): string;
      getEndnotes(): string;
      getHeaders(options?: { includeFooters?: boolean }): string;
      getFooters(): string;
    }>;
  }
}
