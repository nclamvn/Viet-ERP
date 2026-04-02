"use client";

import { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Package,
  Truck,
  Home,
  ClipboardCheck,
  XCircle,
  RotateCcw,
  ArrowRight,
  History,
  Link2,
} from "lucide-react";
import Link from "next/link";
import { PageShell } from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { PdfDownloadButton } from "@/components/pdf-download-button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOrder, useTransitionOrder } from "@/hooks/use-orders";
import { usePermissions } from "@/hooks/use-permissions";
import { ORDER_STATUSES, formatCurrency } from "@/lib/constants";
import {
  getAvailableTransitions,
  getStatusColor,
} from "@/lib/orders/state-machine";
import { StatusTimeline } from "@/components/orders/StatusTimeline";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/i18n";
import type { OrderStatus } from ".prisma/crm-client";

// ── Fulfillment steps ───────────────────────────────────────────────
const STEPS = [
  {
    key: "PENDING",
    labelKey: "orderStatus.pending" as const,
    icon: ClipboardCheck,
  },
  {
    key: "CONFIRMED",
    labelKey: "orderStatus.confirmed" as const,
    icon: CheckCircle2,
  },
  {
    key: "IN_PRODUCTION",
    labelKey: "orderStatus.inProduction" as const,
    icon: Package,
  },
  { key: "SHIPPED", labelKey: "orderStatus.shipped" as const, icon: Truck },
  { key: "DELIVERED", labelKey: "orderStatus.delivered" as const, icon: Home },
];

function getStepIndex(status: string) {
  const idx = STEPS.findIndex((s) => s.key === status);
  return idx >= 0 ? idx : 0;
}

// ── Action button config ────────────────────────────────────────────
const FORWARD_ACTIONS: Partial<
  Record<
    OrderStatus,
    {
      icon: typeof ArrowRight;
      labelKey: string;
      className: string;
    }
  >
> = {
  CONFIRMED: {
    icon: CheckCircle2,
    labelKey: "orders.actions.confirm",
    className: "bg-[#3B82F6] hover:bg-[#2563EB] text-white",
  },
  IN_PRODUCTION: {
    icon: Package,
    labelKey: "orders.actions.startProduction",
    className: "bg-[#8B5CF6] hover:bg-[#7C3AED] text-white",
  },
  SHIPPED: {
    icon: Truck,
    labelKey: "orders.actions.markShipped",
    className: "bg-[#06B6D4] hover:bg-[#0891B2] text-white",
  },
  DELIVERED: {
    icon: Home,
    labelKey: "orders.actions.markDelivered",
    className: "bg-[#10B981] hover:bg-[#059669] text-white",
  },
};

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useTranslation();
  const { isManagerOrAbove } = usePermissions();
  const id = params.id as string;

  const { data: order, isLoading } = useOrder(id);
  const transitionOrder = useTransitionOrder();

  // Dialog states
  const [cancelOpen, setCancelOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [shippedOpen, setShippedOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelNote, setCancelNote] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundNote, setRefundNote] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [shippingProvider, setShippingProvider] = useState("");
  const [shippedNote, setShippedNote] = useState("");

  const statusConfig = ORDER_STATUSES.find(
    (s) => s.value === order?.status,
  ) || {
    labelKey: order?.status || "",
    color: "#6B7280",
  };

  const formatDate = (dateStr: string | Date | null | undefined) => {
    if (!dateStr) return "--";
    return new Date(dateStr).toLocaleDateString("vi-VN");
  };

  // Handle forward transition (confirm, start production, delivered)
  const handleForwardTransition = useCallback(
    (toStatus: OrderStatus) => {
      if (toStatus === "SHIPPED") {
        setShippedOpen(true);
        return;
      }
      transitionOrder.mutate({ id, toStatus });
    },
    [id, transitionOrder],
  );

  const handleCancel = useCallback(() => {
    if (!cancelReason.trim()) return;
    transitionOrder.mutate(
      {
        id,
        toStatus: "CANCELLED",
        cancellationReason: cancelReason,
        note: cancelNote || undefined,
      },
      {
        onSuccess: () => {
          setCancelOpen(false);
          setCancelReason("");
          setCancelNote("");
        },
      },
    );
  }, [id, cancelReason, cancelNote, transitionOrder]);

  const handleRefund = useCallback(() => {
    const amount = parseFloat(refundAmount);
    if (!amount || amount <= 0) return;
    transitionOrder.mutate(
      {
        id,
        toStatus: "REFUNDED",
        refundAmount: amount,
        note: refundNote || undefined,
      },
      {
        onSuccess: () => {
          setRefundOpen(false);
          setRefundAmount("");
          setRefundNote("");
        },
      },
    );
  }, [id, refundAmount, refundNote, transitionOrder]);

  const handleShipped = useCallback(() => {
    transitionOrder.mutate(
      {
        id,
        toStatus: "SHIPPED",
        trackingNumber: trackingNumber || undefined,
        shippingProvider: shippingProvider || undefined,
        note: shippedNote || undefined,
      },
      {
        onSuccess: () => {
          setShippedOpen(false);
          setTrackingNumber("");
          setShippingProvider("");
          setShippedNote("");
        },
      },
    );
  }, [id, trackingNumber, shippingProvider, shippedNote, transitionOrder]);

  if (isLoading) {
    return (
      <PageShell title={t("orders.title")}>
        <div className="space-y-4">
          <Skeleton className="h-8 w-64 bg-[var(--crm-bg-subtle)]" />
          <Skeleton className="h-40 w-full bg-[var(--crm-bg-subtle)]" />
          <Skeleton className="h-60 w-full bg-[var(--crm-bg-subtle)]" />
        </div>
      </PageShell>
    );
  }

  if (!order) {
    return (
      <PageShell title={t("orders.title")}>
        <div className="text-center py-16 text-[var(--crm-text-secondary)]">
          {t("orders.notFound")}
        </div>
      </PageShell>
    );
  }

  const currentStep = getStepIndex(order.status);
  const isCancelled =
    order.status === "CANCELLED" || order.status === "REFUNDED";
  const available = getAvailableTransitions(order.status as OrderStatus);
  const forwardStatuses = available.filter(
    (s) => s !== "CANCELLED" && s !== "REFUNDED",
  );
  const canCancel = available.includes("CANCELLED");
  const canRefund = available.includes("REFUNDED");
  const statusHistory = (order as any).statusHistory ?? [];

  return (
    <PageShell
      title={`${t("orders.title")} ${order.orderNumber}`}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => router.back()}
            className="border-[var(--crm-border)] text-[var(--crm-text-secondary)] hover:text-[var(--crm-text-primary)] hover:bg-[var(--crm-bg-subtle)]"
          >
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            {t("common.back")}
          </Button>
          <PdfDownloadButton
            url={`/api/orders/${id}/pdf`}
            filename={order.orderNumber}
            label="PDF"
          />
        </div>
      }
    >
      {/* Status badge + created date */}
      <div className="flex items-center gap-3">
        <Badge
          className="border-0 text-xs px-2 py-0.5"
          style={{
            backgroundColor: `${statusConfig.color}20`,
            color: statusConfig.color,
          }}
        >
          {t(statusConfig.labelKey)}
        </Badge>
        <span className="text-sm text-[var(--crm-text-muted)]">
          {t("orders.createdDate")}: {formatDate(order.createdAt)}
        </span>
      </div>

      {/* Action Buttons */}
      {isManagerOrAbove &&
        (forwardStatuses.length > 0 || canCancel || canRefund) && (
          <div className="flex flex-wrap items-center gap-2">
            {forwardStatuses.map((toStatus) => {
              const action = FORWARD_ACTIONS[toStatus];
              if (!action) return null;
              const Icon = action.icon;
              return (
                <Button
                  key={toStatus}
                  onClick={() => handleForwardTransition(toStatus)}
                  disabled={transitionOrder.isPending}
                  className={action.className}
                >
                  <Icon className="w-4 h-4 mr-1.5" />
                  {t(action.labelKey)}
                </Button>
              );
            })}
            {canCancel && (
              <Button
                variant="outline"
                onClick={() => setCancelOpen(true)}
                disabled={transitionOrder.isPending}
                className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <XCircle className="w-4 h-4 mr-1.5" />
                {t("orders.actions.cancel")}
              </Button>
            )}
            {canRefund && (
              <Button
                variant="outline"
                onClick={() => {
                  setRefundAmount(String(Number(order.total)));
                  setRefundOpen(true);
                }}
                disabled={transitionOrder.isPending}
                className="border-[var(--crm-border)] text-[var(--crm-text-secondary)] hover:text-[var(--crm-text-primary)] hover:bg-[var(--crm-bg-subtle)]"
              >
                <RotateCcw className="w-4 h-4 mr-1.5" />
                {t("orders.actions.refund")}
              </Button>
            )}
          </div>
        )}

      {/* Cancelled / Refunded info banner */}
      {order.status === "CANCELLED" && (order as any).cancellationReason && (
        <div className="glass-card-static p-4 border-red-500/20">
          <div className="flex items-center gap-2 text-red-400 mb-1">
            <XCircle className="w-4 h-4" />
            <span className="text-sm font-medium">
              {t("orders.cancelledReason")}
            </span>
          </div>
          <p className="text-sm text-[var(--crm-text-secondary)]">
            {(order as any).cancellationReason}
          </p>
        </div>
      )}

      {order.status === "REFUNDED" && (order as any).refundAmount && (
        <div className="glass-card-static p-4 border-[var(--crm-border)]">
          <div className="flex items-center gap-2 text-[var(--crm-text-secondary)] mb-1">
            <RotateCcw className="w-4 h-4" />
            <span className="text-sm font-medium">
              {t("orders.refundedAmount")}
            </span>
          </div>
          <p className="text-sm text-[var(--crm-text-primary)] font-semibold">
            {formatCurrency(Number((order as any).refundAmount))}
          </p>
        </div>
      )}

      {/* Linked quote */}
      {(order as any).quote && (
        <Link
          href={`/quotes/${(order as any).quote.id}`}
          className="glass-card-static p-4 flex items-center gap-3 hover:border-[#10B981]/40 transition-colors"
        >
          <Link2 className="w-4 h-4 text-[#10B981]" />
          <div className="flex-1">
            <p className="text-sm text-[var(--crm-text-primary)]">
              Từ báo giá:{" "}
              <span className="font-medium">
                {(order as any).quote.quoteNumber}
              </span>
            </p>
            <p className="text-xs text-[var(--crm-text-muted)]">
              {formatCurrency(Number((order as any).quote.total))}
            </p>
          </div>
          <ArrowLeft className="w-4 h-4 text-[var(--crm-text-muted)] rotate-180" />
        </Link>
      )}

      {/* Fulfillment Timeline */}
      {!isCancelled && (
        <div className="glass-card-static p-3">
          <h3 className="text-sm font-medium text-[var(--crm-text-primary)] mb-3">
            {t("orders.fulfillmentProgress")}
          </h3>
          <div className="flex items-center justify-between relative">
            {/* Progress line */}
            <div className="absolute top-5 left-5 right-5 h-0.5 bg-[var(--crm-border)]" />
            <div
              className="absolute top-5 left-5 h-0.5 bg-[#10B981] transition-all duration-500"
              style={{
                width: `${(currentStep / (STEPS.length - 1)) * 100}%`,
                maxWidth: "calc(100% - 40px)",
              }}
            />

            {STEPS.map((step, idx) => {
              const isCompleted = idx <= currentStep;
              const isCurrent = idx === currentStep;
              const StepIcon = step.icon;
              return (
                <div
                  key={step.key}
                  className="flex flex-col items-center relative z-10"
                >
                  <div
                    className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors",
                      isCompleted
                        ? "bg-[#10B981]/10 border-[#10B981] text-[#10B981]"
                        : "bg-[var(--crm-bg-page)] border-[var(--crm-border)] text-[var(--crm-text-muted)]",
                      isCurrent && "ring-2 ring-[#10B981]/20",
                    )}
                  >
                    {isCompleted && idx < currentStep ? (
                      <CheckCircle2 className="w-5 h-5" />
                    ) : (
                      <StepIcon className="w-4 h-4" />
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-[11px] mt-2 whitespace-nowrap",
                      isCompleted
                        ? "text-[#10B981]"
                        : "text-[var(--crm-text-muted)]",
                    )}
                  >
                    {t(step.labelKey)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Order info */}
      <div className="glass-card-static p-3">
        <h3 className="text-sm font-medium text-[var(--crm-text-primary)] mb-3">
          {t("orders.orderInfo")}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-[var(--crm-text-muted)] text-xs">
              {t("orders.company")}
            </p>
            <p className="text-[var(--crm-text-primary)] mt-0.5">
              {order.company?.name || "--"}
            </p>
          </div>
          <div>
            <p className="text-[var(--crm-text-muted)] text-xs">
              {t("orders.payment")}
            </p>
            <p
              className={cn(
                "mt-0.5",
                order.paidAt ? "text-[#10B981]" : "text-[#F59E0B]",
              )}
            >
              {order.paidAt ? formatDate(order.paidAt) : t("orders.notPaid")}
            </p>
          </div>
          <div>
            <p className="text-[var(--crm-text-muted)] text-xs">
              {t("orders.shipping")}
            </p>
            <p
              className={cn(
                "mt-0.5",
                order.shippedAt
                  ? "text-[#10B981]"
                  : "text-[var(--crm-text-secondary)]",
              )}
            >
              {order.shippedAt
                ? formatDate(order.shippedAt)
                : t("orders.notShipped")}
            </p>
          </div>
          <div>
            <p className="text-[var(--crm-text-muted)] text-xs">
              {t("orders.delivery")}
            </p>
            <p
              className={cn(
                "mt-0.5",
                order.deliveredAt
                  ? "text-[#10B981]"
                  : "text-[var(--crm-text-secondary)]",
              )}
            >
              {order.deliveredAt
                ? formatDate(order.deliveredAt)
                : t("orders.notDelivered")}
            </p>
          </div>
        </div>

        {/* Tracking info */}
        {((order as any).trackingNumber || (order as any).shippingProvider) && (
          <div className="grid grid-cols-2 gap-3 text-sm mt-4">
            {(order as any).shippingProvider && (
              <div>
                <p className="text-[var(--crm-text-muted)] text-xs">
                  {t("orders.shippingProvider")}
                </p>
                <p className="text-[var(--crm-text-primary)] mt-0.5">
                  {(order as any).shippingProvider}
                </p>
              </div>
            )}
            {(order as any).trackingNumber && (
              <div>
                <p className="text-[var(--crm-text-muted)] text-xs">
                  {t("orders.trackingNumber")}
                </p>
                <p className="text-[var(--crm-text-primary)] mt-0.5">
                  {(order as any).trackingNumber}
                </p>
              </div>
            )}
          </div>
        )}

        {order.shippingAddress && (
          <div className="mt-4">
            <p className="text-[var(--crm-text-muted)] text-xs">
              {t("orders.shippingAddress")}
            </p>
            <p className="text-[var(--crm-text-primary)] text-sm mt-0.5">
              {order.shippingAddress}
            </p>
          </div>
        )}
      </div>

      {/* Items table */}
      <div className="glass-card-static overflow-hidden">
        <div className="p-4 pb-0">
          <h3 className="text-sm font-medium text-[var(--crm-text-primary)]">
            {t("orders.products")}
          </h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="border-[var(--crm-border)] hover:bg-transparent">
              <TableHead className="text-[var(--crm-text-secondary)] w-10">
                #
              </TableHead>
              <TableHead className="text-[var(--crm-text-secondary)]">
                {t("orders.product")}
              </TableHead>
              <TableHead className="text-[var(--crm-text-secondary)]">
                {t("common.description")}
              </TableHead>
              <TableHead className="text-[var(--crm-text-secondary)] text-right">
                {t("orders.qty")}
              </TableHead>
              <TableHead className="text-[var(--crm-text-secondary)] text-right">
                {t("orders.unitPrice")}
              </TableHead>
              <TableHead className="text-[var(--crm-text-secondary)] text-right">
                {t("orders.lineTotal")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.items.map((item, idx) => (
              <TableRow key={item.id} className="border-[var(--crm-border)]">
                <TableCell className="text-[var(--crm-text-muted)]">
                  {idx + 1}
                </TableCell>
                <TableCell className="text-[var(--crm-text-primary)] font-medium">
                  {item.product?.name || t("orders.customProduct")}
                </TableCell>
                <TableCell className="text-[var(--crm-text-secondary)]">
                  {item.description || "--"}
                </TableCell>
                <TableCell className="text-right text-[var(--crm-text-primary)]">
                  {Number(item.quantity)}
                </TableCell>
                <TableCell className="text-right text-[var(--crm-text-primary)]">
                  {formatCurrency(Number(item.unitPrice))}
                </TableCell>
                <TableCell className="text-right text-[var(--crm-text-primary)] font-medium">
                  {formatCurrency(Number(item.total))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Totals */}
        <div className="p-4 border-t border-[var(--crm-border)]">
          <div className="flex justify-end">
            <div className="w-72 space-y-2 text-sm">
              <div className="flex justify-between text-[var(--crm-text-secondary)]">
                <span>{t("orders.subtotal")}</span>
                <span className="text-[var(--crm-text-primary)]">
                  {formatCurrency(Number(order.subtotal))}
                </span>
              </div>
              <div className="flex justify-between text-[var(--crm-text-secondary)]">
                <span>{t("orders.tax")}</span>
                <span className="text-[var(--crm-text-primary)]">
                  {formatCurrency(Number(order.taxAmount))}
                </span>
              </div>
              <Separator className="bg-[var(--crm-border)]" />
              <div className="flex justify-between font-bold text-base">
                <span className="text-[var(--crm-text-primary)]">
                  {t("orders.total")}
                </span>
                <span className="text-[#10B981]">
                  {formatCurrency(Number(order.total))}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      {order.notes && (
        <div className="glass-card-static p-3">
          <h3 className="text-sm font-medium text-[var(--crm-text-primary)] mb-2">
            {t("common.notes")}
          </h3>
          <p className="text-sm text-[var(--crm-text-secondary)] whitespace-pre-wrap">
            {order.notes}
          </p>
        </div>
      )}

      {/* Status History Timeline */}
      {statusHistory.length > 0 && (
        <div className="glass-card-static p-3">
          <div className="flex items-center gap-2 mb-4">
            <History className="w-4 h-4 text-[var(--crm-text-muted)]" />
            <h3 className="text-sm font-medium text-[var(--crm-text-primary)]">
              {t("orders.statusHistory")}
            </h3>
          </div>
          <StatusTimeline history={statusHistory} />
        </div>
      )}

      {/* Cancel Dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="bg-[var(--crm-bg-card)] border-[var(--crm-border)]">
          <DialogHeader>
            <DialogTitle className="text-[var(--crm-text-primary)]">
              {t("orders.cancelDialog.title")}
            </DialogTitle>
            <DialogDescription className="text-[var(--crm-text-secondary)]">
              {t("orders.cancelDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-[var(--crm-text-secondary)]">
                {t("orders.cancelDialog.reason")} *
              </Label>
              <Textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder={t("orders.cancelDialog.reasonPlaceholder")}
                className="input-premium bg-[var(--crm-bg-card)] border-[var(--crm-border)] text-[var(--crm-text-primary)]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[var(--crm-text-secondary)]">
                {t("orders.note")}
              </Label>
              <Input
                value={cancelNote}
                onChange={(e) => setCancelNote(e.target.value)}
                placeholder={t("orders.notePlaceholder")}
                className="input-premium bg-[var(--crm-bg-card)] border-[var(--crm-border)] text-[var(--crm-text-primary)]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelOpen(false)}
              className="border-[var(--crm-border)] text-[var(--crm-text-secondary)]"
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleCancel}
              disabled={!cancelReason.trim() || transitionOrder.isPending}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {transitionOrder.isPending
                ? t("common.processing")
                : t("orders.cancelDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund Dialog */}
      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent className="bg-[var(--crm-bg-card)] border-[var(--crm-border)]">
          <DialogHeader>
            <DialogTitle className="text-[var(--crm-text-primary)]">
              {t("orders.refundDialog.title")}
            </DialogTitle>
            <DialogDescription className="text-[var(--crm-text-secondary)]">
              {t("orders.refundDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-[var(--crm-text-secondary)]">
                {t("orders.refundDialog.amount")} *
              </Label>
              <Input
                type="number"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                max={Number(order.total)}
                min={0}
                className="input-premium bg-[var(--crm-bg-card)] border-[var(--crm-border)] text-[var(--crm-text-primary)]"
              />
              <p className="text-xs text-[var(--crm-text-muted)]">
                {t("orders.refundDialog.maxAmount")}:{" "}
                {formatCurrency(Number(order.total))}
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-[var(--crm-text-secondary)]">
                {t("orders.note")}
              </Label>
              <Input
                value={refundNote}
                onChange={(e) => setRefundNote(e.target.value)}
                placeholder={t("orders.notePlaceholder")}
                className="input-premium bg-[var(--crm-bg-card)] border-[var(--crm-border)] text-[var(--crm-text-primary)]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRefundOpen(false)}
              className="border-[var(--crm-border)] text-[var(--crm-text-secondary)]"
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleRefund}
              disabled={
                !refundAmount ||
                parseFloat(refundAmount) <= 0 ||
                transitionOrder.isPending
              }
              className="btn-accent-glow"
            >
              {transitionOrder.isPending
                ? t("common.processing")
                : t("orders.refundDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Shipped Dialog */}
      <Dialog open={shippedOpen} onOpenChange={setShippedOpen}>
        <DialogContent className="bg-[var(--crm-bg-card)] border-[var(--crm-border)]">
          <DialogHeader>
            <DialogTitle className="text-[var(--crm-text-primary)]">
              {t("orders.shippedDialog.title")}
            </DialogTitle>
            <DialogDescription className="text-[var(--crm-text-secondary)]">
              {t("orders.shippedDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-[var(--crm-text-secondary)]">
                {t("orders.shippingProvider")}
              </Label>
              <Input
                value={shippingProvider}
                onChange={(e) => setShippingProvider(e.target.value)}
                placeholder={t("orders.shippedDialog.providerPlaceholder")}
                className="input-premium bg-[var(--crm-bg-card)] border-[var(--crm-border)] text-[var(--crm-text-primary)]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[var(--crm-text-secondary)]">
                {t("orders.trackingNumber")}
              </Label>
              <Input
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder={t("orders.shippedDialog.trackingPlaceholder")}
                className="input-premium bg-[var(--crm-bg-card)] border-[var(--crm-border)] text-[var(--crm-text-primary)]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[var(--crm-text-secondary)]">
                {t("orders.note")}
              </Label>
              <Input
                value={shippedNote}
                onChange={(e) => setShippedNote(e.target.value)}
                placeholder={t("orders.notePlaceholder")}
                className="input-premium bg-[var(--crm-bg-card)] border-[var(--crm-border)] text-[var(--crm-text-primary)]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShippedOpen(false)}
              className="border-[var(--crm-border)] text-[var(--crm-text-secondary)]"
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleShipped}
              disabled={transitionOrder.isPending}
              className="bg-[#06B6D4] hover:bg-[#0891B2] text-white"
            >
              {transitionOrder.isPending
                ? t("common.processing")
                : t("orders.shippedDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
