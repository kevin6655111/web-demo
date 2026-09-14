import { Box, Stack, TextField, Typography, alpha } from '@mui/material';
import SearchableSelect from './SearchableSelect';

const MAX_COLS = 12;

/**
 * 規格表式欄位格線。
 *
 * 左邊固定寬的標籤格、右邊值格，靠框線分隔 —— 排版就是資料本身的結構，
 * 三十幾個欄位一眼看得出哪些是一組的。
 *
 * 用「標籤在左」而不是 MUI 慣用的「標籤浮在框上」：
 * 欄位多的時候，浮動標籤會讓每一列的高度都不一樣，掃視時對不齊。
 *
 * 唯讀與可編輯共用同一格線 —— 承辦看到的位置就是他要改的位置，
 * 切到編輯模式時欄位不會跳位。
 */
export function SpecSheet({ groups, value = {}, errors = {}, onChange, readOnly = false }) {
  const set = (name, v) => onChange?.({ ...value, [name]: v });

  return (
    <Box
      sx={{
        border: (t) => `1px solid ${t.palette.divider}`,
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: 'action.hover'
      }}
    >
      {groups.map((group, gi) => (
        <Box key={group.title ?? gi}>
          {group.title && (
            <Typography
              variant="caption"
              sx={{
                display: 'block',
                px: 1.5,
                py: 0.7,
                fontWeight: 700,
                letterSpacing: '0.04em',
                color: 'primary.light',
                bgcolor: (t) => alpha(t.palette.primary.main, 0.07),
                borderTop: gi === 0 ? 'none' : (t) => `1px solid ${t.palette.divider}`,
                borderBottom: (t) => `1px solid ${t.palette.divider}`
              }}
            >
              {group.title}
            </Typography>
          )}

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: `repeat(${MAX_COLS}, minmax(0, 1fr))` } }}>
            {group.fields.filter(Boolean).map((field, fi) => (
              <SpecField
                key={field.name ?? `${gi}-${fi}`}
                field={field}
                value={value[field.name]}
                error={errors[field.name]}
                readOnly={readOnly}
                onChange={set}
                first={fi === 0 && !group.title}
              />
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function SpecField({ field, value, error, readOnly, onChange, first }) {
  const { label, name, type, options, unit, span = MAX_COLS, hint, render, required, disabled } = field;
  const editable = !readOnly && !!type && type !== 'readonly' && !disabled;

  return (
    <Box
      sx={{
        gridColumn: { xs: '1 / -1', sm: `span ${Math.min(span, MAX_COLS)}` },
        display: 'grid',
        gridTemplateColumns: { xs: '92px minmax(0, 1fr)', sm: 'clamp(88px, 9vw, 116px) minmax(0, 1fr)' },
        alignItems: 'stretch',
        borderTop: first ? 'none' : (t) => `1px solid ${t.palette.divider}`,
        minHeight: 42
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="center"
        sx={{
          px: 1,
          py: 0.6,
          gap: 0.3,
          borderRight: (t) => `1px solid ${t.palette.divider}`,
          bgcolor: 'action.hover'
        }}
      >
        <Typography
          variant="caption"
          sx={{ fontWeight: 600, color: 'text.secondary', textAlign: 'center', lineHeight: 1.25 }}
        >
          {label}
        </Typography>
        {required && (
          <Typography component="span" sx={{ color: 'error.main', fontSize: 12, lineHeight: 1 }}>
            *
          </Typography>
        )}
      </Stack>

      <Box sx={{ px: 1, py: editable ? 0.5 : 0.6, display: 'flex', alignItems: 'center', minWidth: 0 }}>
        {render ? (
          render(value)
        ) : editable ? (
          <EditableControl
            type={type}
            name={name}
            value={value}
            options={options}
            unit={unit}
            error={error}
            hint={hint}
            onChange={onChange}
          />
        ) : (
          <Typography
            variant="body2"
            sx={{
              color: value === null || value === undefined || value === '' ? 'text.disabled' : 'text.primary',
              wordBreak: 'break-word'
            }}
          >
            {value === null || value === undefined || value === '' ? '—' : value}
            {unit && value !== null && value !== undefined && value !== '' ? ` ${unit}` : ''}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function EditableControl({ type, name, value, options = [], unit, error, hint, onChange }) {
  const common = {
    size: 'small',
    fullWidth: true,
    error: !!error,
    // 錯誤訊息用 title 而不是 helperText：helperText 會把整列撐高，
    // 而規格表的價值在於每一列高度一致
    title: error ?? hint ?? '',
    variant: 'standard',
    sx: { '& .MuiInput-underline:before': { borderBottom: 'none' }, '& .MuiInputBase-input': { fontSize: 14, py: 0.4 } }
  };

  // 選項多的時候自己會長出搜尋欄 —— 標案、車輛、行政區都超過門檻
  if (type === 'select' || type === 'multi') {
    return (
      <SearchableSelect
        {...common}
        multiple={type === 'multi'}
        value={value}
        options={options}
        onChange={(v) => onChange(name, v)}
      />
    );
  }

  return (
    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ width: '100%' }}>
      <TextField
        {...common}
        type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
        value={value ?? ''}
        onChange={(e) =>
          onChange(name, type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)
        }
        inputProps={type === 'number' ? { min: 0, step: 'any' } : undefined}
        InputLabelProps={type === 'date' ? { shrink: true } : undefined}
      />
      {unit && (
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          {unit}
        </Typography>
      )}
    </Stack>
  );
}

export default SpecSheet;
