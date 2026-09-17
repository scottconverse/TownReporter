import { useQuery } from "@tanstack/react-query";
import { editorSections, publicSections } from "./news/sections";
export function useEditorSections() {
  const query = useQuery({ queryKey: ["editor-sections"], queryFn: () => editorSections() });
  return { ...query, sections: query.data?.sections.filter((s) => !s.replacementKey) ?? [] };
}
export function usePublicSections() {
  const query = useQuery({ queryKey: ["public-sections"], queryFn: () => publicSections() });
  return { ...query, sections: query.data?.filter((s) => !s.replacementKey) ?? [] };
}
