import { Link } from "@tanstack/react-router";
export function EmptyEdition({ area }: { area?: string }) {
  return (
    <div className="empty">
      <h2>{area ? "No stories in this area yet." : "The edition is still being set."}</h2>
      {area ? null : (
        <p>
          No published stories yet. Read about the newsroom while the editor prepares the paper.
        </p>
      )}
      <Link to="/about" className="btn">
        About this paper
      </Link>
    </div>
  );
}
