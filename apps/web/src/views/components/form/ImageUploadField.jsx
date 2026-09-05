import { useCallback, useEffect, useState } from 'react';
import { Alert, LinearProgress, Stack, Typography } from '@mui/material';
import FormSection from './FormSection';
import ImageSlot from '../image/ImageSlot';
import { workOrderApi } from '../../../models/api/patrolApi';

/**
 * 派工單照片。
 *
 * **分區由後端決定**：哪些照片、擺在哪一區、要不要求，
 * 都跟著業主的驗收要求走。前端自己維護一份分區表的話，
 * 要求改了會有一邊忘記更新 —— 而報表檢查的與畫面顯示的不一致最難查。
 *
 * 三個刻意的設計：
 *
 * 1. **同類型重傳是覆寫**：驗收要的是「這個階段的照片」，不是同階段的二十張。
 *    現場重拍是常態，所以第二次上傳取代第一次而不是並存。要留全部就用 ZIP 類型。
 * 2. **必要照片標紅**：缺照片的完工單在驗收時會被退回。與其讓它一路走到驗收，
 *    不如在上傳畫面就說清楚還缺什麼。
 * 3. **上傳前先擋大小與格式**：20MB 的檔案傳到一半才被後端拒絕，
 *    在工地的網路上是很昂貴的浪費。
 *
 * `api` 可換成巡查單的那一組：兩者的端點形狀一模一樣（分區、缺件、multipart 欄位名即類型），
 * 抄一份出來只會讓其中一份先過期。
 */
export default function ImageUploadField({ orderId, canEdit = true, onChanged, api = workOrderApi }) {
  const [groups, setGroups] = useState([]);
  const [missing, setMissing] = useState([]);
  const [loading, setLoading] = useState(false);
  // 記「哪一格正在傳」而不是布林：整片轉圈會讓人以為所有格子都在動
  const [uploading, setUploading] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!orderId) return;

    setLoading(true);
    try {
      const res = await api.images(orderId);
      setGroups(res.data?.GROUPS ?? []);
      setMissing(res.data?.MISSING ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [orderId, api]);

  useEffect(() => {
    load();
  }, [load]);

  const pick = async (imgType, file) => {
    if (!file) return;

    setUploading(imgType);
    setError('');

    try {
      // 欄位名就是照片類型；後端依欄位名決定這張要存成哪一類
      const fd = new FormData();
      fd.append('ID', String(orderId));
      fd.append(imgType, file);

      await api.uploadImages(fd);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(null);
    }
  };

  const remove = async (imgType) => {
    setUploading(imgType);
    try {
      await api.deleteImage({ ID: orderId, IMG_TYPE: imgType });
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(null);
    }
  };

  return (
    <Stack spacing={1.5}>
      {(loading || uploading) && <LinearProgress />}

      {error && (
        <Alert severity="error" onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      {missing.length > 0 && (
        <Alert severity="warning" sx={{ fontSize: 13 }}>
          尚缺必要照片：{missing.map((m) => m.NAME ?? m.name ?? m).join('、')}
          <br />
          缺照片無法標記完工 —— 那樣的單在驗收時會被退回。
        </Alert>
      )}

      {groups.map((group) => (
        <FormSection key={group.GROUP} title={group.GROUP} subtitle={`${group.TYPES.length} 張`} minWidth={210} dense>
          {group.TYPES.map((slot) => (
            <ImageSlot key={slot.TYPE} slot={slot} canEdit={canEdit} uploading={uploading === slot.TYPE} onPick={pick} onRemove={remove} />
          ))}
        </FormSection>
      ))}

      {!groups.length && !loading && (
        <Typography variant="body2" color="text.disabled">
          此類型的派工單沒有定義照片分區。
        </Typography>
      )}
    </Stack>
  );
}
