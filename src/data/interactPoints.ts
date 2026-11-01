// ============ 61 交互点全表（20 卷 §5.2，B8 物品经济） ============
// E 吃喝18 / G 赌6 / S 戏5 / M 歌4 / B 买16 / R 骑8 / W 船4 = 61
// R/W 类挂既有坐骑/开船系统（表内登记不重复注册）；E/B 用书价目直喂 openShop
export interface GoodRow { name: string; price: number; act: string; say: string }
export interface PointRow {
  id: string; name: string; x: number; z: number;
  kind: 'eat' | 'gamble' | 'show' | 'song' | 'buy' | 'ride' | 'boat';
  desc: string; goods?: GoodRow[]; system?: 'mount' | 'boat';
}

const g = (name: string, price: number, act: string, say: string): GoodRow => ({ name, price, act, say });

export const POINTS: PointRow[] = [
  // ---- E 吃喝 18 ----
  { id: 'E1', name: '茶坊点茶', x: -36, z: 62, kind: 'eat', desc: '点茶/听书/小唱', goods: [g('點茶', 2, 'eat', '一盏点茶，沫饽如雪'), g('茶點', 5, 'eat', '就茶小点，闲话半晌')] },
  { id: 'E2', name: '孙羊正店·散座', x: 226, z: 66, kind: 'eat', desc: '正店酒菜', goods: [g('羊羔酒', 15, 'drink', '羊羔美酒，一杯暖到心头'), g('肉包', 7, 'eat', '薄皮大馅，汁水四溢')] },
  { id: 'E3', name: '孙羊正店·雅座', x: 226, z: 72, kind: 'eat', desc: '席面包间', goods: [g('席面', 80, 'drink', '楼上雅座，凭栏望虹桥')] },
  { id: 'E4', name: '十千脚店', x: 122, z: 64, kind: 'eat', desc: '脚店沽饮', goods: [g('濁酒', 5, 'drink', '浊酒一碗，快活似仙'), g('炊餅', 3, 'eat', '武大郎炊饼，扎实顶饱')] },
  { id: 'E5', name: '唐家酒店', x: -2820, z: 940, kind: 'eat', desc: '村酿', goods: [g('村酒', 4, 'drink', '村酿入口，糙而带劲'), g('鹽豆', 1, 'eat', '盐豆几粒，佐酒正好')] },
  { id: 'E6', name: '久住王員外家', x: 340, z: 64, kind: 'eat', desc: '客茶投宿', goods: [g('客茶', 2, 'eat', '客来敬茶'), g('宿夜', 30, 'present', '一枕黑甜到天明')] },
  { id: 'E7', name: '飯鋪', x: 2680, z: 860, kind: 'eat', desc: '平价饭食', goods: [g('羊肉麵', 7, 'eat', '一碗羊肉面，满头大汗'), g('蒸餅', 2, 'eat', '蒸饼热乎')] },
  { id: 'E8', name: '南岸胡饼摊', x: -60, z: -66, kind: 'eat', desc: '现烤胡饼', goods: [g('胡餅', 2, 'eat', '芝麻胡饼，脆响满街')] },
  { id: 'E9', name: '南岸鱼羹摊', x: -90, z: -60, kind: 'eat', desc: '鱼羹', goods: [g('魚羹', 10, 'eat', '汴河鲜鱼熬羹，稠白鲜香')] },
  { id: 'E10', name: '码头鱼粥棚', x: -238, z: 44, kind: 'eat', desc: '鱼粥', goods: [g('魚粥', 5, 'eat', '鱼粥一碗，船工早饭')] },
  { id: 'E11', name: '东市炒肺摊', x: 2740, z: 940, kind: 'eat', desc: '炒肺灌肺', goods: [g('炒肺', 5, 'eat', '炒肺一盘，市井至味')] },
  { id: 'E12', name: '东市环饼摊', x: 2860, z: 940, kind: 'eat', desc: '环饼', goods: [g('環餅', 1, 'eat', '馓子环饼，嘎嘣脆')] },
  { id: 'E13', name: '西市馉饳儿摊', x: -2860, z: 860, kind: 'eat', desc: '馉饳儿', goods: [g('餶飣兒', 4, 'eat', '一碗馉饳儿，皮薄馅足')] },
  { id: 'E14', name: '西市冷元子摊', x: -2740, z: 940, kind: 'eat', desc: '冷饮甜汤', goods: [g('冷元子', 3, 'eat', '冰凉甜润，暑气全消')] },
  { id: 'E15', name: '州桥夜市', x: 0, z: 40, kind: 'eat', desc: '旋煎羊白肠', goods: [g('羊白腸', 10, 'eat', '旋煎羊白肠，夜市头一绝')] },
  { id: 'E16', name: '瓦子茶棚', x: 306, z: 90, kind: 'eat', desc: '凉浆解渴', goods: [g('涼漿', 2, 'eat', '一盏凉浆，戏看半场')] },
  { id: 'E17', name: '御街饮子摊', x: 0, z: 600, kind: 'eat', desc: '药饮子', goods: [g('藥飲子', 2, 'eat', '香药饮子，生津解乏')] },
  { id: 'E18', name: '上清观素斋', x: 540, z: 118, kind: 'eat', desc: '素面斋饭', goods: [g('素麵', 5, 'eat', '一碗素面，随喜功德')] },
  // ---- G 赌 6 ----
  { id: 'G1', name: '瓦子骰宝棚', x: 320, z: 96, kind: 'gamble', desc: '骰宝押注（底注10）' },
  { id: 'G2', name: '州桥五子棋摊', x: 30, z: 50, kind: 'gamble', desc: '五子棋对弈（彩头5）' },
  { id: 'G3', name: '南岸双陆摊', x: -30, z: -70, kind: 'gamble', desc: '双陆对局（注5）' },
  { id: 'G4', name: '码头骰摊', x: -220, z: 44, kind: 'gamble', desc: '码头速骰（注5）' },
  { id: 'G5', name: '东市五子摊', x: 2900, z: 880, kind: 'gamble', desc: '五子棋（彩头3）' },
  { id: 'G6', name: '西市关扑摊', x: -2620, z: 920, kind: 'gamble', desc: '关扑掷钱（每扑2）' },
  // ---- S 戏 5 ----
  { id: 'S1', name: '勾栏大棚', x: 306, z: 78, kind: 'show', desc: '大戏杂剧杂技（门钱20）' },
  { id: 'S2', name: '说书棚', x: 270, z: 92, kind: 'show', desc: '说书水浒话本（5）' },
  { id: 'S3', name: '傀儡棚', x: 342, z: 92, kind: 'show', desc: '悬丝傀儡（5）' },
  { id: 'S4', name: '影戏棚', x: 352, z: 100, kind: 'show', desc: '皮影戏（5）' },
  { id: 'S5', name: '相扑场', x: 330, z: 110, kind: 'show', desc: '相扑赛可下注（门票10）' },
  // ---- M 歌 4 ----
  { id: 'M1', name: '东市楼歌台', x: 2800, z: 900, kind: 'song', desc: '乐和歌姬点曲（10）' },
  { id: 'M2', name: '琵琶船', x: -100, z: 0, kind: 'song', desc: '汴河船上琵琶（点曲15）' },
  { id: 'M3', name: '虹桥笛手', x: 0, z: 20, kind: 'song', desc: '桥头笛声（赏钱2）' },
  { id: 'M4', name: '西市楼铁笛', x: -2800, z: 900, kind: 'song', desc: '马麟铁笛胡音（赏钱5）' },
  // ---- B 买 16 ----
  { id: 'B1', name: '香药铺', x: 40, z: 62, kind: 'buy', desc: '香料药材', goods: [g('沉香', 80, 'present', '沉香一炷，静气凝神'), g('檀香', 50, 'present', '檀香袅袅')] },
  { id: 'B2', name: '王家纸马', x: 352, z: 66, kind: 'buy', desc: '纸马冥器', goods: [g('紙馬', 5, 'present', '纸马一匹，捎给那头'), g('樓庫', 30, 'present', '纸楼库一座，烧给先人'), g('燒紙·刀', 10, 'burnpaper', '一刀纸钱焚尽，阴德 +1（单向）')] },
  { id: 'B3', name: '解当铺', x: 258, z: 64, kind: 'buy', desc: '典当/淘死当', goods: [g('贖當', 60, 'present', '赎回当物，物归原主'), g('淘死當', 25, 'present', '死当捡漏，全凭眼力')] },
  { id: 'B4', name: '赵太丞家', x: 168, z: 64, kind: 'buy', desc: '诊疗抓药', goods: [g('湯藥', 10, 'eat', '一剂汤药，寒热俱消'), g('金瘡藥', 20, 'eat', '金疮药敷上，血止痛消')] },
  { id: 'B5', name: '綢緞莊', x: -2900, z: 960, kind: 'buy', desc: '绸缎量裁', goods: [g('杭緞', 150, 'present', '杭缎一匹，水滑生光'), g('蜀錦', 300, 'present', '蜀锦丈二，富贵人家')] },
  { id: 'B6', name: '明家靴店', x: 2740, z: 820, kind: 'buy', desc: '靴鞋', goods: [g('麻鞋', 15, 'present', '麻鞋轻便'), g('皮靴', 120, 'present', '皮靴上脚，日行百里')] },
  { id: 'B7', name: '果子鋪', x: 180, z: 64, kind: 'buy', desc: '鲜果蜜煎', goods: [g('鮮果', 2, 'eat', '时新鲜果'), g('蜜煎', 3, 'eat', '蜜煎渍果，甜而不腻')] },
  { id: 'B8', name: '东市绢帛行', x: 2880, z: 820, kind: 'buy', desc: '绢帛批发', goods: [g('絹·匹', 60, 'present', '绢帛一匹，官作价六十')] },
  { id: 'B9', name: '西市金银铺', x: -2660, z: 820, kind: 'buy', desc: '打制银器', goods: [g('銀鐲', 200, 'present', '银镯一对，錾花细腻')] },
  { id: 'B10', name: '西市雕版书坊', x: -2960, z: 860, kind: 'buy', desc: '购书', goods: [g('話本', 20, 'present', '话本一册，灯下消夜'), g('經卷', 50, 'present', '经卷一函，楷墨精刊')] },
  { id: 'B11', name: '东市香药行栈', x: 2960, z: 860, kind: 'buy', desc: '香药批发', goods: [g('龍腦·兩', 500, 'present', '龙脑一两，价比千金')] },
  { id: 'B12', name: '码头鱼市', x: -250, z: 40, kind: 'buy', desc: '鲜鱼竞买', goods: [g('鯉魚', 8, 'eat', '活水鲤鱼'), g('河蟹', 15, 'eat', '满膏河蟹')] },
  { id: 'B13', name: '南岸杂货担', x: -100, z: -70, kind: 'buy', desc: '针线杂货', goods: [g('針線包', 5, 'present', '针头线脑，居家必备'), g('花手繩', 2, 'present', '花手绳一根，小儿欢喜')] },
  { id: 'B14', name: '柳林弓矢摊', x: -450, z: 90, kind: 'buy', desc: '租弓买箭', goods: [g('租弓', 5, 'present', '弓一张，箭三支'), g('箭·支', 1, 'present', '添箭一支')] },
  { id: 'B15', name: '御街马市鞍具铺', x: 60, z: -1200, kind: 'buy', desc: '鞍鞯辔头', goods: [g('馬鞍', 200, 'present', '好鞍配好马'), g('轡頭', 30, 'present', '辔头一副')] },
  { id: 'B16', name: '金耀门漕仓粜米', x: 4700, z: 120, kind: 'buy', desc: '粮米', goods: [g('米·升', 3, 'eat', '官仓新米一升')] },
  // ---- R 骑 8（挂既有坐骑系统） ----
  { id: 'R1', name: '御街马市', x: 60, z: -1200, kind: 'ride', desc: '购马 500；皇甫端刷资质', system: 'mount' },
  { id: 'R2', name: '金耀门马厩', x: 4900, z: 60, kind: 'ride', desc: '军马寄养换乘 10/时辰', system: 'mount' },
  { id: 'R3', name: '草原捕马点', x: 1500, z: -11000, kind: 'ride', desc: '野马驯服（免费·难）', system: 'mount' },
  { id: 'R4', name: '上清观鹤舍', x: 548, z: 130, kind: 'ride', desc: '仙鹤（步罡任务）', system: 'mount' },
  { id: 'R5', name: '瑶池青鸾架', x: 150, z: 34, kind: 'ride', desc: '青鸾（蟠桃大会解锁）', system: 'mount' },
  { id: 'R6', name: '巨泽龙埠', x: 11200, z: 5600, kind: 'ride', desc: '泽龙（水战三胜解锁）', system: 'mount' },
  { id: 'R7', name: '昆仑龙脊', x: -26400, z: 4300, kind: 'ride', desc: '云龙（渡劫终奖）', system: 'mount' },
  { id: 'R8', name: '宣德门麟厩', x: 100, z: -2900, kind: 'ride', desc: '麒麟（万国来朝限定）', system: 'mount' },
  // ---- W 船 4（挂既有开船系统） ----
  { id: 'W1', name: '汴河码头漕船', x: -238, z: 32, kind: 'boat', desc: '随船 15；包船 300/日', system: 'boat' },
  { id: 'W2', name: '州桥小舟', x: 20, z: 0, kind: 'boat', desc: '租舴艋舟 30/时辰', system: 'boat' },
  { id: 'W3', name: '巨泽渡船', x: 10800, z: 5300, kind: 'boat', desc: '泽上渡运 15/程', system: 'boat' },
  { id: 'W4', name: '西河渡口', x: -16000, z: 3800, kind: 'boat', desc: '张横官渡 5（或请酒免渡）', system: 'boat' },
];

// B10 补录：瑶池蟠桃赏赐（天宫点位；61 表外单列——20 卷 5.2 无天宫点，归属总纲三币律）
export const PEACH_GRANT = { id: 'T1', name: '瑤池·蟠桃賞賜', x: 150, z: 20, goods: [{ name: '蟠桃賞賜', price: 1, act: 'peachgrant', say: '蟠桃点一枚，换铜钱百文' }] };

export const POINTS_BY_KIND: Record<string, number> = POINTS.reduce((m, p) => { m[p.kind] = (m[p.kind] ?? 0) + 1; return m; }, {} as Record<string, number>);
