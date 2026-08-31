import {
  MdOutlineConstruction,
  MdManageAccounts,
  MdSecurity,
  MdSchedule,
  MdHistory,
  MdEditRoad,
  MdLayers,
  MdMyLocation,
  MdOutlineStraighten,
  MdFullscreen
} from 'react-icons/md';
// react-icons 的 fa6 沒有 FaCarAlt / FaEdit(那是 fa5 的名稱)，
// 這裡各取所需，不為了統一而硬湊
import { FaCar, FaRoad, FaGear, FaLayerGroup, FaPenToSquare } from 'react-icons/fa6';
import { GiEdgeCrack, GiMountainRoad, GiAutoRepair } from 'react-icons/gi';
import { BsLayersFill, BsMap } from 'react-icons/bs';
import { SiOpenstreetmap } from 'react-icons/si';
import { AiFillProject } from 'react-icons/ai';
import { HiOutlineDocumentReport } from 'react-icons/hi';
import { TbReportAnalytics, TbIdBadge2, TbRouteSquare } from 'react-icons/tb';
import { LiaChalkboardSolid } from 'react-icons/lia';
import { FcStatistics } from 'react-icons/fc';
import { RiSurveyFill } from 'react-icons/ri';

/**
 * 圖示對照表。
 *
 * 後端只存圖示「名稱」而不是元件 —— 資料庫不該知道前端用哪一套圖示庫。
 * 找不到名稱時回傳中性的預設值而不是讓畫面破掉：
 * 新增功能時「後端先上線、前端還沒補圖示」是很常見的順序。
 */
const ICONS = {
  LiaChalkboardSolid,
  SiOpenstreetmap,
  AiFillProject,
  MdOutlineConstruction,
  HiOutlineDocumentReport,
  FaGear,
  FaCarAlt: FaCar,
  FaRoad,
  FaEdit: FaPenToSquare,
  GiEdgeCrack,
  GiMountainRoad,
  GiAutoRepair,
  BsLayersFill,
  BsMap,
  TbReportAnalytics,
  TbIdBadge2,
  TbRouteSquare,
  FcStatistics,
  RiSurveyFill,
  MdManageAccounts,
  MdSecurity,
  MdSchedule,
  MdHistory,
  MdEditRoad,
  MdLayers,
  MdMyLocation,
  MdOutlineStraighten,
  MdFullscreen,
  FaLayerGroup
};

export function getIcon(name) {
  return ICONS[name] ?? BsMap;
}
