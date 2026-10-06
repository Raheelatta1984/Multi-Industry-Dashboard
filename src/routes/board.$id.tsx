import { createFileRoute, Link } from "@tanstack/react-router";
import { dashboardById, DASHBOARDS } from "@/lib/catalog";
import { DashboardCanvas } from "@/components/widgets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/board/$id")({ component: BoardPage });

function BoardPage() {
  const { id } = Route.useParams();
  const board = dashboardById(id) ?? DASHBOARDS[0]!;
  const related = DASHBOARDS.filter(
    (d) => d.industry === board.industry && d.id !== board.id,
  ).slice(0, 6);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs tracking-[0.16em] text-silver uppercase">{board.eyebrow}</p>
          <h1 className="mt-1 font-display text-3xl lg:text-4xl">{board.title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{board.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{board.industry}</Badge>
          <Badge variant="silver">{board.department}</Badge>
        </div>
      </header>
      <DashboardCanvas board={board} />
      {related.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {related.map((d) => (
            <Button key={d.id} variant="outline" size="sm" asChild>
              <Link to="/board/$id" params={{ id: d.id }}>
                {d.title}
              </Link>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
