"use client";

import { useState, useCallback, useEffect } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensors,
  useSensor,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { validateStatusTransition } from "@/lib/config/recruitment";
import { KanbanColumn } from "./kanban-column";
import { DragOverlayCard } from "./drag-overlay-card";
import type { ApplicationStatus } from ".prisma/hrm-client";

export interface KanbanApplication {
  id: string;
  status: ApplicationStatus;
  expectedSalary: string | null;
  offeredSalary: string | null;
  createdAt: string;
  employeeId: string | null;
  candidate: {
    fullName: string;
    email: string;
    phone: string | null;
    school: string | null;
    major: string | null;
  };
  requisition?: {
    id: string;
    title: string;
    department?: { name: string };
  };
  interviews: {
    id: string;
    round: number;
    scheduledAt: string;
    result: string;
  }[];
}

interface KanbanBoardProps {
  applications: KanbanApplication[];
  invalidateKeys?: string[][];
  userRole: string;
}

const KANBAN_COLUMNS: {
  id: ApplicationStatus;
  label: string;
  borderColor: string;
}[] = [
  { id: "NEW", label: "Mới", borderColor: "border-gray-300" },
  { id: "SCREENING", label: "Sàng lọc", borderColor: "border-blue-300" },
  { id: "INTERVIEW", label: "Phỏng vấn", borderColor: "border-yellow-300" },
  { id: "OFFERED", label: "Đề nghị", borderColor: "border-purple-300" },
  { id: "ACCEPTED", label: "Chấp nhận", borderColor: "border-green-400" },
  { id: "REJECTED", label: "Từ chối", borderColor: "border-red-300" },
  { id: "WITHDRAWN", label: "Rút đơn", borderColor: "border-gray-200" },
];

export function KanbanBoard({
  applications: initialApps,
  invalidateKeys,
  userRole,
}: KanbanBoardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isHRManager = userRole === "HR_MANAGER" || userRole === "SUPER_ADMIN";

  const [apps, setApps] = useState<KanbanApplication[]>(initialApps);
  const [activeApp, setActiveApp] = useState<KanbanApplication | null>(null);

  // Keep local state in sync when parent data changes
  useEffect(() => {
    setApps(initialApps);
  }, [initialApps]);

  // Action modal state (for screen, interview, offer, reject)
  const [activeModal, setActiveModal] = useState<{
    type: string;
    appId: string;
  } | null>(null);
  const [modalData, setModalData] = useState<Record<string, string>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor),
  );

  const actionMutation = useMutation({
    mutationFn: async ({
      appId,
      action,
      body,
    }: {
      appId: string;
      action: string;
      body: Record<string, unknown>;
    }) => {
      const res = await fetch(
        `/api/recruitment/applications/${appId}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Action failed");
      }
      return res.json();
    },
    onSuccess: () => {
      invalidateKeys?.forEach((key) =>
        queryClient.invalidateQueries({ queryKey: key }),
      );
      setActiveModal(null);
      setModalData({});
    },
  });

  function handleAction(
    appId: string,
    action: string,
    body: Record<string, unknown> = {},
  ) {
    actionMutation.mutate({ appId, action, body });
  }

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const app = apps.find((a) => a.id === event.active.id);
      setActiveApp(app || null);
    },
    [apps],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveApp(null);
      const { active, over } = event;
      if (!over) return;

      const applicationId = active.id as string;
      const newStatus = over.id as ApplicationStatus;

      const app = apps.find((a) => a.id === applicationId);
      if (!app) return;

      const oldStatus = app.status;
      if (oldStatus === newStatus) return;

      // Client-side validation
      const error = validateStatusTransition(oldStatus, newStatus);
      if (error) {
        toast({
          title: "Không thể di chuyển",
          description: error,
          variant: "destructive",
        });
        return;
      }

      // ACCEPTED requires HR_MANAGER+
      if (newStatus === "ACCEPTED" && !isHRManager) {
        toast({
          title: "Không có quyền",
          description: "Chỉ HR Manager mới có thể chấp nhận ứng viên",
          variant: "destructive",
        });
        return;
      }

      // Optimistic update
      setApps((prev) =>
        prev.map((a) =>
          a.id === applicationId ? { ...a, status: newStatus } : a,
        ),
      );

      try {
        const res = await fetch(
          `/api/recruitment/applications/${applicationId}/status`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus }),
          },
        );

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Failed");
        }

        // Invalidate to get fresh data
        invalidateKeys?.forEach((key) =>
          queryClient.invalidateQueries({ queryKey: key }),
        );

        if (newStatus === "ACCEPTED") {
          toast({
            title: "Đã chấp nhận",
            description: "Tài khoản nhân viên được tạo tự động.",
          });
        }
      } catch (err) {
        // Rollback
        setApps((prev) =>
          prev.map((a) =>
            a.id === applicationId ? { ...a, status: oldStatus } : a,
          ),
        );
        toast({
          title: "Lỗi",
          description:
            err instanceof Error
              ? err.message
              : "Không thể cập nhật trạng thái",
          variant: "destructive",
        });
      }
    },
    [apps, isHRManager, toast, queryClient, invalidateKeys],
  );

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-4">
          {KANBAN_COLUMNS.map((col) => {
            const items = apps.filter((a) => a.status === col.id);
            return (
              <KanbanColumn
                key={col.id}
                id={col.id}
                label={col.label}
                borderColor={col.borderColor}
                items={items}
              />
            );
          })}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeApp ? <DragOverlayCard app={activeApp} /> : null}
        </DragOverlay>
      </DndContext>

      {/* Action dialog with focus trap and ARIA */}
      <Dialog
        open={!!activeModal}
        onOpenChange={(open) => {
          if (!open) {
            setActiveModal(null);
            setModalData({});
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {activeModal?.type === "screen" && "Sàng lọc ứng viên"}
              {activeModal?.type === "interview" && "Lên lịch phỏng vấn"}
              {activeModal?.type === "offer" && "Gửi Offer"}
              {activeModal?.type === "reject" && "Từ chối ứng viên"}
            </DialogTitle>
          </DialogHeader>

          {activeModal?.type === "screen" && (
            <div className="space-y-3">
              <div>
                <Label>Ghi chú sàng lọc</Label>
                <Textarea
                  className="mt-1"
                  rows={3}
                  value={modalData.screeningNote || ""}
                  onChange={(e) =>
                    setModalData({
                      ...modalData,
                      screeningNote: e.target.value,
                    })
                  }
                />
              </div>
              <Button
                className="w-full"
                style={{ backgroundColor: "#1E3A5F" }}
                disabled={actionMutation.isPending}
                onClick={() =>
                  handleAction(activeModal.appId, "screen", {
                    screeningNote: modalData.screeningNote,
                  })
                }
              >
                Xác nhận sàng lọc
              </Button>
            </div>
          )}

          {activeModal?.type === "interview" && (
            <div className="space-y-3">
              <div>
                <Label>Ngày giờ phỏng vấn *</Label>
                <Input
                  type="datetime-local"
                  className="mt-1"
                  value={modalData.scheduledAt || ""}
                  onChange={(e) =>
                    setModalData({ ...modalData, scheduledAt: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>Địa điểm</Label>
                <Input
                  className="mt-1"
                  placeholder="VD: Phòng họp A"
                  value={modalData.location || ""}
                  onChange={(e) =>
                    setModalData({ ...modalData, location: e.target.value })
                  }
                />
              </div>
              <Button
                className="w-full"
                style={{ backgroundColor: "#1E3A5F" }}
                disabled={actionMutation.isPending || !modalData.scheduledAt}
                onClick={() =>
                  handleAction(activeModal.appId, "interview", {
                    scheduledAt: modalData.scheduledAt,
                    location: modalData.location,
                  })
                }
              >
                Tạo lịch PV
              </Button>
            </div>
          )}

          {activeModal?.type === "offer" && (
            <div className="space-y-3">
              <div>
                <Label>Mức lương đề xuất (VNĐ) *</Label>
                <Input
                  type="number"
                  className="mt-1"
                  value={modalData.offeredSalary || ""}
                  onChange={(e) =>
                    setModalData({
                      ...modalData,
                      offeredSalary: e.target.value,
                    })
                  }
                />
              </div>
              <div>
                <Label>Hạn chót phản hồi</Label>
                <Input
                  type="date"
                  className="mt-1"
                  value={modalData.offerDeadline || ""}
                  onChange={(e) =>
                    setModalData({
                      ...modalData,
                      offerDeadline: e.target.value,
                    })
                  }
                />
              </div>
              <div>
                <Label>Ghi chú</Label>
                <Textarea
                  className="mt-1"
                  rows={2}
                  value={modalData.offerNote || ""}
                  onChange={(e) =>
                    setModalData({ ...modalData, offerNote: e.target.value })
                  }
                />
              </div>
              <Button
                className="w-full"
                style={{ backgroundColor: "#1E3A5F" }}
                disabled={actionMutation.isPending || !modalData.offeredSalary}
                onClick={() =>
                  handleAction(activeModal.appId, "offer", {
                    offeredSalary: parseFloat(modalData.offeredSalary),
                    offerDeadline: modalData.offerDeadline || null,
                    offerNote: modalData.offerNote || null,
                  })
                }
              >
                Gửi Offer
              </Button>
            </div>
          )}

          {activeModal?.type === "reject" && (
            <div className="space-y-3">
              <div>
                <Label>Lý do từ chối *</Label>
                <Textarea
                  className="mt-1"
                  rows={3}
                  value={modalData.rejectionReason || ""}
                  onChange={(e) =>
                    setModalData({
                      ...modalData,
                      rejectionReason: e.target.value,
                    })
                  }
                />
              </div>
              <Button
                className="w-full bg-red-600 hover:bg-red-700 text-white"
                disabled={
                  actionMutation.isPending || !modalData.rejectionReason
                }
                onClick={() =>
                  handleAction(activeModal.appId, "reject", {
                    rejectionReason: modalData.rejectionReason,
                  })
                }
              >
                Xác nhận từ chối
              </Button>
            </div>
          )}

          {actionMutation.isError && (
            <p className="text-sm text-red-600 mt-2">
              {actionMutation.error?.message}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
