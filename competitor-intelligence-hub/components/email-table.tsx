"use client";

/**
 * Interactive competitor-email data table (PART 2 §2).
 *
 * Composition:
 *   - Advanced filters (brand multi-select, promo-only, attachments-only)
 *     are applied as a pre-filter via useMemo so they compose cleanly.
 *   - Global fuzzy search (brand + subject + body) and column sorting are
 *     handled by @tanstack/react-table.
 *   - SWR refreshes the dataset from /api/emails on an interval, seeded with
 *     server-rendered fallback data so first paint is instant.
 *   - Clicking a row opens the slide-over detail sheet.
 */
import * as React from "react";
import useSWR from "swr";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type FilterFn,
} from "@tanstack/react-table";
import {
  Search,
  SlidersHorizontal,
  Tag,
  Paperclip,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getColumns } from "@/components/columns";
import { EmailDetailSheet } from "@/components/email-detail-sheet";
import type { CompetitorEmail } from "@/lib/types";
import { splitLinks } from "@/lib/utils";

/** Global fuzzy-ish filter: case-insensitive token match across key fields. */
const globalFuzzy: FilterFn<CompetitorEmail> = (row, _id, query: string) => {
  if (!query) return true;
  const haystack = [
    row.original.brand,
    row.original.subject,
    row.original.bodyText,
    row.original.preview,
  ]
    .join(" ")
    .toLowerCase();
  // every whitespace-separated token must appear somewhere
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((tok) => haystack.includes(tok));
};

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json() as Promise<{ emails: CompetitorEmail[] }>);

export function EmailTable({
  initialData,
}: {
  initialData: CompetitorEmail[];
}) {
  // --- Data (SWR with server fallback, refresh every 60s) ------------------
  const { data, isValidating, mutate } = useSWR("/api/emails", fetcher, {
    fallbackData: { emails: initialData },
    refreshInterval: 60_000,
    revalidateOnFocus: true,
  });
  const allEmails = data?.emails ?? initialData;

  // --- Advanced filter state -----------------------------------------------
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [selectedBrands, setSelectedBrands] = React.useState<string[]>([]);
  const [promoOnly, setPromoOnly] = React.useState(false);
  const [attachmentsOnly, setAttachmentsOnly] = React.useState(false);
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "receivedAt", desc: true }, // newest first by default
  ]);

  // --- Detail sheet state ---------------------------------------------------
  const [active, setActive] = React.useState<CompetitorEmail | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const openDetail = React.useCallback((email: CompetitorEmail) => {
    setActive(email);
    setSheetOpen(true);
  }, []);

  const columns = React.useMemo(() => getColumns(openDetail), [openDetail]);

  // Distinct brand list for the multi-select dropdown.
  const brands = React.useMemo(
    () => Array.from(new Set(allEmails.map((e) => e.brand))).sort(),
    [allEmails]
  );

  // Pre-filter (advanced multi-filters compose before search + sort).
  const filtered = React.useMemo(() => {
    return allEmails.filter((e) => {
      if (selectedBrands.length && !selectedBrands.includes(e.brand))
        return false;
      if (promoOnly && (!e.promoCodes || e.promoCodes === "None")) return false;
      if (
        attachmentsOnly &&
        splitLinks(e.attachmentUrls).length === 0 &&
        splitLinks(e.inlineImageUrls).length === 0
      )
        return false;
      return true;
    });
  }, [allEmails, selectedBrands, promoOnly, attachmentsOnly]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: globalFuzzy,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 15 } },
  });

  const toggleBrand = (brand: string) =>
    setSelectedBrands((prev) =>
      prev.includes(brand)
        ? prev.filter((b) => b !== brand)
        : [...prev, brand]
    );

  const activeFilterCount =
    selectedBrands.length + (promoOnly ? 1 : 0) + (attachmentsOnly ? 1 : 0);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search brand, subject, or body…"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Advanced filters dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2">
                <SlidersHorizontal className="h-4 w-4" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge variant="default" className="ml-1 px-1.5">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-96 w-64 overflow-y-auto">
              <DropdownMenuLabel>Quick filters</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={promoOnly}
                onCheckedChange={(v) => setPromoOnly(Boolean(v))}
                onSelect={(e) => e.preventDefault()}
              >
                <Tag className="mr-2 h-3.5 w-3.5" /> Only with promo codes
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={attachmentsOnly}
                onCheckedChange={(v) => setAttachmentsOnly(Boolean(v))}
                onSelect={(e) => e.preventDefault()}
              >
                <Paperclip className="mr-2 h-3.5 w-3.5" /> Only with attachments
              </DropdownMenuCheckboxItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel>Brands</DropdownMenuLabel>
              {brands.length === 0 && (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  No brands yet
                </div>
              )}
              {brands.map((brand) => (
                <DropdownMenuCheckboxItem
                  key={brand}
                  checked={selectedBrands.includes(brand)}
                  onCheckedChange={() => toggleBrand(brand)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {brand}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            size="icon"
            onClick={() => mutate()}
            title="Refresh"
            disabled={isValidating}
          >
            <RefreshCw
              className={isValidating ? "h-4 w-4 animate-spin" : "h-4 w-4"}
            />
          </Button>
        </div>
      </div>

      {/* Active filter chips */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedBrands.map((b) => (
            <Badge
              key={b}
              variant="secondary"
              className="cursor-pointer"
              onClick={() => toggleBrand(b)}
            >
              {b} ✕
            </Badge>
          ))}
          {promoOnly && (
            <Badge
              variant="secondary"
              className="cursor-pointer"
              onClick={() => setPromoOnly(false)}
            >
              Promo only ✕
            </Badge>
          )}
          {attachmentsOnly && (
            <Badge
              variant="secondary"
              className="cursor-pointer"
              onClick={() => setAttachmentsOnly(false)}
            >
              Attachments only ✕
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => {
              setSelectedBrands([]);
              setPromoOnly(false);
              setAttachmentsOnly(false);
            }}
          >
            Clear all
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => openDetail(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      // Stop the row click when interacting with the actions cell.
                      onClick={
                        cell.column.id === "actions"
                          ? (e) => e.stopPropagation()
                          : undefined
                      }
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-32 text-center text-muted-foreground"
                >
                  No emails match your filters yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Footer: count + pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {table.getFilteredRowModel().rows.length} of {allEmails.length} emails
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount() || 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <EmailDetailSheet
        email={active}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </div>
  );
}
