import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type Column<T> = {
  header: string;
  cell: (row: T) => React.ReactNode;
  /** Applies to header and cells (e.g. responsive visibility). */
  className?: string;
  /** Applies to body cells only (e.g. monospace, tabular numbers). */
  cellClassName?: string;
  /** Omit from the stacked mobile card (e.g. data already in the card title). */
  hideOnMobile?: boolean;
};

type ResponsiveTableProps<T extends { id: string }> = {
  caption: string;
  rows: T[];
  columns: Column<T>[];
  /** Card heading on small screens. */
  title: (row: T) => React.ReactNode;
  actions: (row: T) => React.ReactNode;
};

/** A table on medium+ screens; stacked cards on phones. One data definition for both. */
export function ResponsiveTable<T extends { id: string }>({
  caption,
  rows,
  columns,
  title,
  actions,
}: ResponsiveTableProps<T>) {
  return (
    <>
      <Card className="hidden py-0 md:block">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.header} className={cn("px-4", column.className)}>
                  {column.header}
                </TableHead>
              ))}
              <TableHead className="px-4 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                {columns.map((column) => (
                  <TableCell key={column.header} className={cn("px-4", column.className, column.cellClassName)}>
                    {column.cell(row)}
                  </TableCell>
                ))}
                <TableCell className="px-4">
                  <div className="flex justify-end gap-1">{actions(row)}</div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <ul className="space-y-3 md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={row.id}>
            <Card size="sm">
              <CardContent className="space-y-3">
                <div className="font-medium">{title(row)}</div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {columns
                    .filter((column) => !column.hideOnMobile)
                    .map((column) => (
                      <div key={column.header} className="contents">
                        <dt className="text-muted-foreground">{column.header}</dt>
                        <dd className="min-w-0 truncate">{column.cell(row)}</dd>
                      </div>
                    ))}
                </dl>
                <div className="flex flex-wrap gap-2">{actions(row)}</div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
