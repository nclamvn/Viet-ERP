"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Badge } from "@/components/ui/badge";
import { KanbanCard } from "./kanban-card";
import type { ApplicationStatus } from ".prisma/hrm-client";
import type { KanbanApplication } from "./kanban-board";

interface KanbanColumnProps {
  id: ApplicationStatus;
  label: string;
  borderColor: string;
  items: KanbanApplication[];
}

export function KanbanColumn({
  id,
  label,
  borderColor,
  items,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="min-w-[260px] w-[260px] flex-shrink-0">
      <div
        className={`flex items-center gap-2 mb-3 pb-2 border-b-2 ${borderColor}`}
      >
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        <Badge variant="secondary" className="text-xs ml-auto">
          {items.length}
        </Badge>
      </div>

      <div
        ref={setNodeRef}
        className={`space-y-2 min-h-[100px] rounded-lg p-1 transition-colors ${
          isOver ? "bg-blue-50" : ""
        }`}
      >
        <SortableContext
          items={items.map((a) => a.id)}
          strategy={verticalListSortingStrategy}
        >
          {items.map((app) => (
            <KanbanCard key={app.id} app={app} />
          ))}
        </SortableContext>

        {items.length === 0 && (
          <div className="text-center py-8 text-xs text-slate-400 border border-dashed rounded-lg">
            Kéo ứng viên vào đây
          </div>
        )}
      </div>
    </div>
  );
}
