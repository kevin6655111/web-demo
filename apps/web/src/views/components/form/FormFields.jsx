import {
  Box,
  Checkbox,
  FormControlLabel,
  InputAdornment,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { FormControl, FormHelperText, InputLabel } from '@mui/material';
import SearchableSelect from './SearchableSelect';

/**
 * 表單欄位。
 *
 * 與查詢面板共用同一套「欄位定義」的想法，但表單多了兩件事：
 * 必填標記與錯誤訊息 —— 查詢條件沒有必填，表單有。
 *
 * 用定義而不是各表單手刻 `<TextField>`：同一個「面積」欄位在新增與編輯
 * 出現兩次時，小數位與單位應該一致，手刻兩次就會有兩種樣子。
 */
export function FormFields({ fields, value, errors = {}, onChange, columns = 2 }) {
  const set = (key, v) => onChange({ ...value, [key]: v });

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: `repeat(${columns}, 1fr)` }, gap: 2 }}>
      {fields.map((f) => {
        const common = {
          key: f.key,
          size: 'small',
          label: f.label,
          required: f.required,
          error: !!errors[f.key],
          helperText: errors[f.key] ?? f.hint,
          value: value[f.key] ?? '',
          onChange: (e) => set(f.key, e.target.value),
          fullWidth: true,
          sx: f.full ? { gridColumn: { sm: '1 / -1' } } : undefined
        };

        if (f.type === 'select' || f.type === 'multi') {
          return (
            <FormControl
              key={f.key}
              size="small"
              fullWidth
              error={!!errors[f.key]}
              sx={f.full ? { gridColumn: { sm: '1 / -1' } } : undefined}
            >
              <InputLabel shrink id={`ff-${f.key}`}>
                {f.label}
              </InputLabel>
              {/* 選項超過門檻會自己長出搜尋欄；標案與車輛清單動輒數十筆 */}
              <SearchableSelect
                multiple={f.type === 'multi'}
                label={f.label}
                labelId={`ff-${f.key}`}
                value={value[f.key] ?? (f.type === 'multi' ? [] : '')}
                options={f.options ?? []}
                error={errors[f.key]}
                onChange={(v) => set(f.key, v)}
                sx={{ '& .MuiSelect-select': { pt: 1.6 } }}
              />
              {(errors[f.key] || f.hint) && <FormHelperText>{errors[f.key] ?? f.hint}</FormHelperText>}
            </FormControl>
          );
        }

        if (f.type === 'switch') {
          return (
            <FormControlLabel
              key={f.key}
              sx={f.full ? { gridColumn: { sm: '1 / -1' } } : undefined}
              control={
                <Checkbox size="small" checked={!!value[f.key]} onChange={(e) => set(f.key, e.target.checked)} />
              }
              label={<Typography variant="body2">{f.label}</Typography>}
            />
          );
        }

        if (f.type === 'textarea') {
          return <TextField {...common} multiline rows={f.rows ?? 3} sx={{ gridColumn: { sm: '1 / -1' } }} />;
        }

        return (
          <TextField
            {...common}
            type={f.type ?? 'text'}
            placeholder={f.placeholder}
            InputLabelProps={f.type === 'date' || f.type === 'datetime-local' ? { shrink: true } : undefined}
            InputProps={f.unit ? { endAdornment: <InputAdornment position="end">{f.unit}</InputAdornment> } : undefined}
          />
        );
      })}
    </Box>
  );
}

/**
 * 唯讀的欄位列表，給詳情檢視用。
 *
 * 帶 title 時會分組：案件詳情有三十幾個欄位，
 * 一口氣攤成一片沒有人看得完 —— 分成「案件 / 位置 / 狀態」才找得到東西。
 */
export function FieldList({ items, columns = 2, title }) {
  return (
    <Box>
      {title && (
        <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
          {title}
        </Typography>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: `repeat(${columns}, 1fr)` }, gap: 1.5 }}>
        {items.map(({ label, value, full }) => (
          <Stack key={label} sx={full ? { gridColumn: { sm: '1 / -1' } } : undefined}>
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
            <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
              {value === null || value === undefined || value === '' ? '—' : value}
            </Typography>
          </Stack>
        ))}
      </Box>
    </Box>
  );
}
