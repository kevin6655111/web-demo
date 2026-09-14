import {
  Box,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Typography
} from '@mui/material';

/**
 * 共用資料表格。
 *
 * 欄位用定義而不是各頁手刻 `<TableCell>`：
 * 同一個「面積」欄位在三個頁面出現時，對齊、小數位、空值的處理應該一致，
 * 手刻三次就會有三種樣子。
 *
 * `render` 讓少數需要特殊呈現的欄位(狀態晶片、進度條)仍然自由，
 * 但預設路徑不需要寫任何 JSX。
 */
export default function DataTable({
  columns,
  rows,
  loading = false,
  total,
  page,
  size,
  onPageChange,
  onSizeChange,
  onRowClick,
  emptyText = '查無資料',
  dense = true
}) {
  const align = (c) => c.align ?? (c.type === 'number' ? 'right' : 'left');

  const format = (col, row) => {
    if (col.render) return col.render(row[col.key], row);

    const v = row[col.key];
    if (v === null || v === undefined || v === '')
      return (
        <Typography variant="caption" color="text.secondary">
          —
        </Typography>
      );
    if (col.type === 'number') return Number(v).toFixed(col.digits ?? 2);

    return v;
  };

  return (
    <Paper sx={{ overflow: 'hidden' }}>
      {loading && <LinearProgress />}

      <Box sx={{ overflowX: 'auto' }}>
        <Table size={dense ? 'small' : 'medium'} stickyHeader>
          <TableHead>
            <TableRow>
              {columns.map((c) => (
                <TableCell
                  key={c.key}
                  align={align(c)}
                  sx={{ whiteSpace: 'nowrap', bgcolor: 'background.paper', fontWeight: 600 }}
                >
                  {c.label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>

          <TableBody>
            {rows.map((row, i) => (
              <TableRow
                key={row.ID ?? i}
                hover
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                sx={{ cursor: onRowClick ? 'pointer' : 'default' }}
              >
                {columns.map((c) => (
                  <TableCell
                    key={c.key}
                    align={align(c)}
                    sx={{
                      whiteSpace: c.wrap ? 'normal' : 'nowrap',
                      // 數字用等寬字：一整欄的數字沒對齊時很難比較大小
                      fontFamily: c.type === 'number' || c.mono ? '"JetBrains Mono", monospace' : undefined,
                      fontSize: c.type === 'number' || c.mono ? 12 : undefined
                    }}
                  >
                    {format(c, row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}

            {!rows.length && !loading && (
              <TableRow>
                <TableCell colSpan={columns.length} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {emptyText}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

      {total !== undefined && (
        <TablePagination
          component="div"
          count={total}
          page={page}
          rowsPerPage={size}
          onPageChange={(_, p) => onPageChange(p)}
          onRowsPerPageChange={(e) => onSizeChange(Number(e.target.value))}
          rowsPerPageOptions={[25, 50, 100, 200]}
          labelRowsPerPage="每頁"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} / 共 ${count} 筆`}
        />
      )}
    </Paper>
  );
}

/** 狀態晶片：顏色由呼叫端給，讓同一份色票在地圖與表格通用 */
export function StatusChip({ label, color }) {
  return (
    <Chip size="small" label={label} variant="outlined" sx={{ borderColor: color, color, height: 22, fontSize: 11 }} />
  );
}

/** 進度條：用在完修率、覆蓋率這類「有目標值」的數字 */
export function ProgressBar({ value, color = 'var(--c-success)', width = 70 }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
      <Box sx={{ width, height: 6, borderRadius: 3, bgcolor: 'action.selected', flexShrink: 0 }}>
        <Box
          sx={{
            width: `${Math.min(100, value)}%`,
            height: '100%',
            borderRadius: 3,
            background: color,
            transition: 'width .4s ease'
          }}
        />
      </Box>
      <Typography
        variant="caption"
        sx={{ fontFamily: '"JetBrains Mono", monospace', minWidth: 34, textAlign: 'right' }}
      >
        {value}%
      </Typography>
    </Stack>
  );
}
