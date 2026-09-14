import { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  FormControl,
  IconButton,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import SearchableSelect from '../form/SearchableSelect';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import TuneIcon from '@mui/icons-material/Tune';

/**
 * 共用查詢面板。
 *
 * 用「欄位定義」而不是各畫面各寫一套表單：巡查系統的查詢條件多達十幾個，
 * 每個列表頁都手刻的話，同一個「日期區間」會有五種不同的行為。
 *
 * 兩個刻意的設計：
 *   1. 常用條件永遠可見，其餘收在「更多條件」裡 ——
 *      承辦八成的時間只用日期與狀態，全部攤開只會讓人找不到。
 *   2. 已套用的條件用 chip 列出來，因為收合後看不到的條件最容易被忘記，
 *      然後就變成「為什麼查不到那筆案件」的客訴。
 */
export default function QueryForm({ fields, value, onChange, onSearch, onReset, dense = false }) {
  const [expanded, setExpanded] = useState(false);

  const primary = fields.filter((f) => !f.advanced);
  const advanced = fields.filter((f) => f.advanced);

  const set = (key, v) => onChange({ ...value, [key]: v });

  const activeChips = fields
    .map((f) => {
      const v = value[f.key];
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return null;

      const text = Array.isArray(v)
        ? v.map((x) => f.options?.find((o) => o.value === x)?.label ?? x).join('、')
        : (f.options?.find((o) => o.value === v)?.label ?? String(v));

      return { key: f.key, label: `${f.label}：${text}` };
    })
    .filter(Boolean);

  const renderField = (f) => {
    if (f.type === 'multi' || f.type === 'select') {
      const multiple = f.type === 'multi';

      return (
        <FormControl key={f.key} size="small" sx={{ minWidth: f.width ?? (multiple ? 160 : 140) }}>
          <InputLabel shrink id={`ql-${f.key}`}>
            {f.label}
          </InputLabel>
          {/* 選項超過門檻自己長出搜尋欄：標案、行政區、車輛都是幾十筆起跳，
              捲到底再捲回來找一筆不是查詢，是折磨 */}
          <SearchableSelect
            multiple={multiple}
            label={f.label}
            labelId={`ql-${f.key}`}
            placeholder="全部"
            value={value[f.key] ?? (multiple ? [] : '')}
            options={f.options ?? []}
            onChange={(v) => set(f.key, v)}
            renderValue={multiple ? (sel) => (sel.length ? `${sel.length} 項` : '全部') : undefined}
            sx={{ '& .MuiSelect-select': { pt: 1.6 } }}
          />
        </FormControl>
      );
    }

    return (
      <TextField
        key={f.key}
        size="small"
        type={f.type ?? 'text'}
        label={f.label}
        placeholder={f.placeholder}
        value={value[f.key] ?? ''}
        onChange={(e) => set(f.key, e.target.value)}
        InputLabelProps={f.type === 'date' || f.type === 'month' ? { shrink: true } : undefined}
        sx={{ minWidth: f.width ?? 150 }}
      />
    );
  };

  return (
    <Paper sx={{ p: dense ? 1.5 : 2 }}>
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
        {primary.map(renderField)}

        <Box sx={{ flex: 1 }} />

        {advanced.length > 0 && (
          <Tooltip title={expanded ? '收合進階條件' : '更多條件'}>
            <IconButton size="small" onClick={() => setExpanded((v) => !v)} color={expanded ? 'primary' : 'default'}>
              <TuneIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        <Button size="small" variant="contained" startIcon={<SearchIcon />} onClick={onSearch}>
          查詢
        </Button>
        <Button size="small" startIcon={<RestartAltIcon />} onClick={onReset}>
          清除
        </Button>
      </Stack>

      <Collapse in={expanded}>
        <Stack
          direction="row"
          spacing={1.5}
          flexWrap="wrap"
          useFlexGap
          sx={{ mt: 2, pt: 2, borderTop: (t) => `1px dashed ${t.palette.divider}` }}
        >
          {advanced.map(renderField)}
        </Stack>
      </Collapse>

      {activeChips.length > 0 && (
        <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
            已套用
          </Typography>
          {activeChips.map((c) => (
            <Chip
              key={c.key}
              size="small"
              label={c.label}
              variant="outlined"
              onDelete={() => set(c.key, Array.isArray(value[c.key]) ? [] : '')}
              sx={{ height: 22, fontSize: 11 }}
            />
          ))}
        </Stack>
      )}
    </Paper>
  );
}
