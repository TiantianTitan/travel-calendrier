import type { Activity, BoardState } from "./types";

// Editable suggestions transcribed from the group's reference itinerary.
// Nothing here claims that a venue is booked or that a member has joined.
const activities: Activity[] = [
  { id: "arrival", date: "2026-10-31", time: "13:30", endTime: "14:15", title: "抵达图卢兹", location: "Toulouse Matabiau", note: "抵达后寄存行李。抵达时间待确认。", category: "travel", sortOrder: 100, revision: 2 },
  { id: "space-city", date: "2026-10-31", time: "14:30", endTime: "18:00", title: "太空城", location: "Cité de l’Espace", note: "开放时间、门票待确认。", category: "explore", sortOrder: 200, revision: 2 },
  { id: "machines", date: "2026-10-31", time: "14:30", endTime: "18:00", title: "机械城", location: "Halle de La Machine", note: "开放时间、门票待确认。", category: "explore", sortOrder: 300, revision: 2 },
  { id: "dinner-first", date: "2026-10-31", time: "19:00", endTime: "20:30", title: "晚餐 · Le Colombier", location: "Le Colombier · 待确认", note: "Cassoulet、油封鸭。订位和用餐时间待确认。", category: "food", sortOrder: 400, revision: 2 },
  { id: "half-marathon", date: "2026-11-01", time: "10:00", endTime: "13:00", title: "半程马拉松", location: "比赛路线 · 待确认", note: "参赛或观赛。比赛安排、集合地点待确认。", category: "explore", sortOrder: 100, revision: 2 },
  { id: "recharge", date: "2026-11-01", time: "13:00", endTime: "15:00", title: "午餐与休息", location: "住处 / 附近", note: "洗漱、换装。", category: "rest", sortOrder: 200, revision: 2 },
  { id: "japanese-garden", date: "2026-11-01", time: "15:00", endTime: "18:00", title: "日式花园与运河", location: "Jardin Japonais · 运河", note: "", category: "explore", sortOrder: 300, revision: 2 },
  { id: "dinner-cassoulet", date: "2026-11-01", time: "19:30", endTime: "21:00", title: "晚餐 · Maison du cassoulet", location: "Maison du cassoulet · 待确认", note: "订位待确认。", category: "food", sortOrder: 400, revision: 2 },
  { id: "dinner-buffet", date: "2026-11-01", time: "19:30", endTime: "21:00", title: "晚餐 · Royal Buffet", location: "Royal Buffet · 待确认", note: "亚洲自助。营业、交通待确认。", category: "food", sortOrder: 500, revision: 2 },
  { id: "dinner-market", date: "2026-11-01", time: "19:30", endTime: "21:00", title: "晚餐 · Grand Marché", location: "Le Buffet du Grand Marché · 待确认", note: "市集自助。营业、交通、订位待确认。", category: "food", sortOrder: 600, revision: 2 },
  { id: "jean-jaures", date: "2026-11-02", time: "09:30", endTime: "12:00", title: "Jean Jaurès 校园", location: "Université Toulouse – Jean Jaurès", note: "地铁 A 线可达。访问安排待确认。", category: "explore", sortOrder: 100, revision: 2 },
  { id: "city-lunch", date: "2026-11-02", time: "12:15", endTime: "14:00", title: "市中心午餐与购物", location: "图卢兹市中心", note: "用餐地点待定。", category: "food", sortOrder: 200, revision: 2 },
  { id: "old-town", date: "2026-11-02", time: "14:00", endTime: "16:00", title: "老城步行", location: "Capitole → Saint-Sernin → Pont Neuf", note: "市政厅广场、圣塞宁教堂、新桥。", category: "explore", sortOrder: 300, revision: 2 },
  { id: "collect-luggage", date: "2026-11-02", time: "16:00", endTime: "16:45", title: "取行李、前往车站", location: "住处 → Toulouse Matabiau", note: "集合点、车次待确认。", category: "travel", sortOrder: 400, revision: 2 },
  { id: "return-paris", date: "2026-11-02", time: "17:00", endTime: "17:00", title: "返回巴黎", location: "Toulouse Matabiau", note: "车次及出发时间待确认。", category: "travel", sortOrder: 500, revision: 2 },
];

export const SEED_STATE: BoardState = { version: 1, activities, responses: [], reactions: [] };
