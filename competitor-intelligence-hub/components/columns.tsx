"use client";

/**
 * TanStack column definitions for the competitor email table (PART 2 §2).
 * Columns: Brand · Subject · Date · Promo Code · Attachments (icon) · View Details.
 */
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown, Eye, Paperclip, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CompetitorEmail } from "@/lib/types";
import { formatDate, splitLinks } from "@/lib/utils";

export function getColumns(
  onView: (email: CompetitorEmail) => void
): ColumnDef<CompetitorEmail>[] {
  return [
    {
      accessorKey: "brand",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="-ml-3 h-8 px-2"
          onClick={() =>
            column.toggleSorting(column.getIsSorted() === "asc")
          }
        >
          Brand
          <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
        </Button>
      ),
      cell: ({ row }) => (
        <div className="font-medium">{row.original.brand}</div>
      ),
      // Enables the per-brand dropdown filter (exact match against the cell).
      filterFn: (row, id, value: string[]) =>
        value.length === 0 || value.includes(row.getValue(id)),
    },
    {
      accessorKey: "subject",
      header: "Subject",
      cell: ({ row }) => (
        <div className="max-w-[320px] truncate" title={row.original.subject}>
          {row.original.subject}
        </div>
      ),
    },
    {
      accessorKey: "receivedAt",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="-ml-3 h-8 px-2"
          onClick={() =>
            column.toggleSorting(column.getIsSorted() === "asc")
          }
        >
          Date
          <ArrowUpDown className="ml-2 h-3.5 w-3.5" />
        </Button>
      ),
      cell: ({ row }) => (
        <div className="whitespace-nowrap text-sm text-muted-foreground">
          {formatDate(row.original.receivedAt)}
        </div>
      ),
      sortingFn: (a, b) =>
        new Date(a.original.receivedAt).getTime() -
        new Date(b.original.receivedAt).getTime(),
    },
    {
      id: "promo",
      accessorKey: "promoCodes",
      header: "Promo Code",
      cell: ({ row }) => {
        const raw = row.original.promoCodes;
        const codes =
          raw && raw !== "None"
            ? raw.split(",").map((c) => c.trim()).filter(Boolean)
            : [];
        if (!codes.length)
          return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {codes.slice(0, 2).map((c) => (
              <Badge key={c} variant="success" className="gap-1 font-mono">
                <Tag className="h-3 w-3" />
                {c}
              </Badge>
            ))}
            {codes.length > 2 && (
              <Badge variant="outline">+{codes.length - 2}</Badge>
            )}
          </div>
        );
      },
    },
    {
      id: "attachments",
      header: "Files",
      cell: ({ row }) => {
        const count =
          splitLinks(row.original.attachmentUrls).length +
          splitLinks(row.original.inlineImageUrls).length;
        if (!count)
          return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <Badge variant="secondary" className="gap-1">
            <Paperclip className="h-3 w-3" />
            {count}
          </Badge>
        );
      },
      enableSorting: false,
    },
    {
      id: "actions",
      header: () => <div className="text-right">Details</div>,
      cell: ({ row }) => (
        <div className="text-right">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => onView(row.original)}
          >
            <Eye className="h-3.5 w-3.5" />
            View
          </Button>
        </div>
      ),
      enableSorting: false,
    },
  ];
}
