import { useMemo, useRef, useState } from 'react';
import { Box, Checkbox, Chip, ListItemText, MenuItem, Select, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';

/**
 * 超過這個數量就給搜尋欄。
 *
 * 門檻不是隨便挑的：八項以內在一個畫面高度裡看得完，捲動找得到；
 * 再多就變成「拉到底再拉回來」。標案、車輛、行政區都會超過。
 */
export const SEARCH_THRESHOLD = 8;

/**
 * 帶搜尋的下拉選單。
 *
 * 用 Select + 自訂搜尋列而不是 Autocomplete：
 * 這個系統的多選欄位要顯示「已選 N 項」的摘要與 chip，
 * Autocomplete 的輸入框會被選項標籤塞滿，欄位一多就撐破版面。
 *
 * 搜尋只在前端過濾 —— 這些選項本來就整包載入了（標案、車輛、行政區），
 * 為了搜尋再打一次 API 只是把延遲加回去。
 */
export default function SearchableSelect({
  value,
  onChange,
  options = [],
  multiple = false,
  placeholder = '（不指定）',
  size = 'small',
  variant = 'outlined',
  label,
  error,
  sx,
  renderValue,
  labelId
}) {
  const [keyword, setKeyword] = useState('');
  const searchRef = useRef(null);

  const needSearch = options.length > SEARCH_THRESHOLD;

  const shown = useMemo(() => {
    if (!keyword.trim()) return options;

    const kw = keyword.trim().toLowerCase();
    return options.filter((o) => String(o.label ?? '').toLowerCase().includes(kw) || String(o.value ?? '').toLowerCase().includes(kw));
  }, [options, keyword]);

  const selected = multiple ? (Array.isArray(value) ? value : []) : (value ?? '');

  const defaultRenderValue = (v) => {
    if (multiple) {
      if (!v.length) {
        return (
          <Typography variant="body2" color="text.disabled">
            {placeholder}
          </Typography>
        );
      }

      return (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {v.map((s) => (
            <Chip key={s} size="small" label={options.find((o) => String(o.value) === String(s))?.label ?? s} sx={{ height: 18, fontSize: 10 }} />
          ))}
        </Box>
      );
    }

    if (v === '' || v === undefined || v === null) {
      return (
        <Typography variant="body2" color="text.disabled">
          {placeholder}
        </Typography>
      );
    }

    return options.find((o) => String(o.value) === String(v))?.label ?? String(v);
  };

  return (
    <Select
      multiple={multiple}
      size={size}
      variant={variant}
      label={label}
      labelId={labelId}
      // 沒有 label 元素可指的時候(例如面板內嵌的選單)自己帶名字 ——
      // 少了它，讀屏軟體只會念「下拉選單」，而測試也定位不到欄位
      inputProps={{ 'aria-label': label ?? placeholder }}
      error={!!error}
      value={selected}
      displayEmpty
      fullWidth
      sx={sx}
      renderValue={renderValue ?? defaultRenderValue}
      onChange={(e) => onChange?.(e.target.value)}
      // 關閉時清掉關鍵字：下次打開應該看到完整清單，
      // 而不是上一次搜尋剩下的兩筆 —— 那會讓人以為選項不見了
      onClose={() => setKeyword('')}
      MenuProps={{
        autoFocus: false,
        PaperProps: { sx: { maxHeight: 360 } }
      }}
    >
      {needSearch && (
        <Box
          sx={{ px: 1, py: 0.8, position: 'sticky', top: 0, zIndex: 1, bgcolor: 'background.paper' }}
          // 攔住鍵盤事件：Select 會把按鍵當成「跳到開頭是這個字的選項」，
          // 不攔的話在搜尋框裡打字會一直跳選項
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <TextField
            inputRef={searchRef}
            size="small"
            fullWidth
            autoFocus
            placeholder={`搜尋 ${options.length} 個選項`}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.8, color: 'text.secondary' }} /> }}
          />
        </Box>
      )}

      {!multiple && <MenuItem value="">{placeholder}</MenuItem>}

      {shown.map((o) => (
        <MenuItem key={o.value} value={o.value} dense={multiple}>
          {multiple ? (
            <>
              <Checkbox size="small" checked={selected.some((s) => String(s) === String(o.value))} />
              <ListItemText primary={o.label} />
            </>
          ) : (
            o.label
          )}
        </MenuItem>
      ))}

      {!shown.length && (
        <MenuItem disabled>
          <Typography variant="body2" color="text.secondary">
            查無符合「{keyword}」的選項
          </Typography>
        </MenuItem>
      )}
    </Select>
  );
}
