export type AtomDomain =
  | 'architecture' | 'interior' | 'furniture' | 'object' | 'plant' | 'creature'
  | 'character' | 'transport' | 'terrain' | 'material' | 'pattern' | 'lighting';

export interface AtomPart {
  id: string;
  label: string;
  geometry: string;
  materials: string[];
  texture: string;
  lod: string;
  evidence: string;
}

export const ATOM_ANATOMY: Record<AtomDomain, AtomPart[]> = {
  architecture: [
    { id: 'base', label: '台基与踏跺', geometry: '收分台身、压阑石、阶条石、垂带踏跺、门槛石', materials: ['青石', '汉白玉', '金砖', '夯土'], texture: '按材质卡分别生成 albedo/normal/roughness；阶面踩亮带与车辙单独遮罩', lod: '近景实体踏跺；中景合并为三段盒体；远景只留台基轮廓', evidence: '45/46 卷逐座台基字段；47 卷逐间地面字段' },
    { id: 'floor', label: '地面与铺装', geometry: '方砖/条石/夯土/木地板/卵石路径与缝线', materials: ['青砖', '金砖', '青石', '木地板', '夯土', '卵石'], texture: '砖缝、磨亮、油渍、血渍、苔线与湿足印均为独立可平铺层', lod: '近景分块几何拼缝；中景整面；远景材质近似', evidence: '45/46/47 卷铺装尺寸、缝宽、磨光与污染条' },
    { id: 'wall', label: '墙体', geometry: '下碱、墙芯、墙皮、收分侧脚、壁柱、检修口', materials: ['青砖', '夯土', '灰泥', '板壁', '石墙', '骨粉夯土'], texture: '砖缝/版筑层理/粉刷云斑/返潮/烟熏/手泽分包', lod: '近景砖缝与破口；中景墙皮；远景按体块', evidence: '45/46 卷墙体字段；44 卷 M-03/M-04/M-06' },
    { id: 'column', label: '柱网与柱础', geometry: '收溜柱身、柱础、柱脚糟朽、铜箍、贴金蟠龙', materials: ['桐油木', '阴沉木', '汉白玉', '铜', '朱漆'], texture: '顺纹木纹、包浆、干裂、铜绿/血锈、贴金残缺分别控制', lod: '近景多段圆柱与箍；中景单圆柱；远景合并柱列', evidence: '45/46 卷柱径/收分/老化；47 卷逐间柱列' },
    { id: 'beam', label: '梁枋与檩椽', geometry: '额枋、金柱、脊瓜柱、叉手、檩、椽、望板', materials: ['桐油木', '彩画木', '阴沉木', '竹木'], texture: '梁架彩画按箍头/藻头/枋心三段展开；木纹方向随构件', lod: '近景露明椽逐根；中景合并梁架；远景封檐板', evidence: '45/46 卷梁架；47 卷露明椽/平闇/藻井字段' },
    { id: 'bracket', label: '斗拱', geometry: '栌斗、散斗、华拱、泥道拱、昂、耍头', materials: ['彩画木', '黑漆木', '铜箍'], texture: '斗拱彩画使用共享纹样图集，金线按阶段遮罩', lod: '近景完整斗拱；中景两跳简化；远景檐下暗带', evidence: 'architecture.ts dougongBand；45/46 卷斗拱字段' },
    { id: 'door', label: '门与格扇', geometry: '板门、门钉、铺首、门簪、格扇、裙板、绦环板', materials: ['木', '朱漆', '铜', '铁', '纸', '绢'], texture: '门钉阵列、铺首錾花、格心花纹、纸/绢透光分层', lod: '近景可开合与格心；中景平板；远景门洞暗面', evidence: '45/46/47 卷门窗字段；44 卷 M-05/M-10/M-15' },
    { id: 'window', label: '窗与帘', geometry: '直棂窗、冰纹窗、支摘窗、铁栅、纸窗、竹帘、纱帘', materials: ['木', '纸', '绢', '竹', '铁'], texture: '棂条与纸/绢透光分开；铁栅与竹帘 alpha 遮罩', lod: '近景棂条与卷帘档位；中景发光窗面；远景窗点', evidence: '45/46/47 卷窗制；44 卷 M-12/M-15/M-16' },
    { id: 'ceiling', label: '天花与藻井', geometry: '彻上明造、平闇、平棋、斗四/斗八藻井、雷公柱、明镜', materials: ['木', '彩画木', '玉', '铜', '纸'], texture: '井格、宝相花、云雷、星宿、蟠龙分别成图集', lod: '近景层级藻井；中景单层井格；远景仰视暗顶', evidence: '47 卷天花列；44 卷 P-01/P-03/P-04/P-20' },
    { id: 'roof', label: '屋面', geometry: '反宇曲面、筒瓦/合瓦垄、勾头滴水、瓦当、檐口', materials: ['筒瓦', '合瓦', '琉璃瓦', '茅草', '石板'], texture: '瓦垄 normal/roughness/AO、苔斑、崩釉、露胎分包', lod: '近景瓦垄几何；中景曲面+法线；远景剪影', evidence: 'bake.ts curvedRoofUnit/createCityTextures；44 卷 M-01/M-02' },
    { id: 'ridge', label: '脊饰与走兽', geometry: '正脊、垂脊、鸱吻、脊兽、宝顶、骨饰', materials: ['瓦', '铁', '铜', '骨', '琉璃'], texture: '走兽轮廓为几何；金/骨/铁材质按界域', lod: '近景逐兽；中景三兽剪影；远景脊线', evidence: '45/46 卷屋顶字段；architecture.ts roofBeasts' },
    { id: 'eave', label: '檐口与飞椽', geometry: '飞椽、檐椽、连檐、瓦口、滴水、风铎、檐灯', materials: ['木', '瓦', '铜', '纸', '铁'], texture: '檐下阴影、烟熏、雨渍、风铎金属与灯纸分包', lod: '近景逐椽；中景檐板；远景檐口线', evidence: '47 卷檐口/露明椽；45 卷檐口误差与风铎' },
    { id: 'sign', label: '匾额楹联招牌', geometry: '匾框、凸字、楹联、灯箱、幌子、霓虹字管', materials: ['木', '金漆', '纸', '绢', '霓虹管'], texture: '文字图集按实号绘制；凸字法线、金箔残缺、灯箱透光', lod: '近景凸字与边框；中景招牌面；远景发光点', evidence: 'bake.ts SignAtlas/SignMesher；45/46 卷匾联' },
    { id: 'surface', label: '彩画贴金与老化', geometry: '额枋彩画带、贴金线、护壁、纹样嵌板', materials: ['矿物彩', '金箔', '漆', '灰泥'], texture: '箍头/藻头/枋心三段图集；粉化、残金、烟熏、手泽独立层', lod: '近景完整纹样；中景主色带；远景材质色', evidence: '44 卷 P-01..P-22；45/46 卷彩画与老化字段' },
  ],
  interior: [
    { id: 'shell', label: '房间壳体', geometry: '地面、墙体、柱网、梁架、天花六面闭合；开口与门洞真实贯通', materials: ['按房间表'], texture: '逐房间材质表生成，禁止通用室内贴图', lod: '进入室内全细节；窗外只保留轮廓与灯点', evidence: '47 卷逐房间地面/墙体/天花/门窗列' },
    { id: 'partition', label: '隔断与槅扇', geometry: '板壁、槅扇、门洞、活动隔断、暗门', materials: ['木板', '纸', '绢', '玉版'], texture: '格心纹样与透光纸分开', lod: '近景可开合；中景静态隔断；远景不看', evidence: '47 卷各房间隔断与槅扇条' },
    { id: 'screen', label: '屏风帐幔', geometry: '座屏、围屏、芙蓉屏、纱幔、竹帘、门帘', materials: ['绢', '纸', '木', '竹', '纱'], texture: '通景画、织物经纬、透光率和褶皱法线', lod: '近景褶皱与画面；中景平面；远景略', evidence: '47 卷屏风帐幔列；44 卷 M-13/M-14/M-16' },
    { id: 'furniture', label: '家具', geometry: '桌、椅、案、榻、柜、架、柜台、龛、灶、衣桁', materials: ['榆木', '楠木', '紫檀', '竹', '石', '铜'], texture: '木纹、漆面、铜活、坐痕与手泽分层', lod: '近景榫卯与铜活；中景轮廓；远景合并', evidence: '47 卷 174 件陈设精描；各房间家具条' },
    { id: 'vessel', label: '器皿酒茶具', geometry: '壶、注子、温碗、盏、碗、盘、瓮、缸、瓶、炉', materials: ['瓷', '陶', '银', '铜', '玉', '漆'], texture: '釉色、开片、錾花、封泥、标签与使用痕', lod: '近景口沿与纹饰；中景器形；远景光点', evidence: '47 卷十六材质族与逐件物品字段' },
    { id: 'stationery', label: '文房四宝', geometry: '案、笔、墨、砚、纸、笔架、印匣、算盘、账簿', materials: ['木', '玉', '石', '纸', '墨', '铜'], texture: '纸纹、墨色、砚台石理、印泥与磨损', lod: '近景可读纸面/笔毫；中景组合；远景略', evidence: '47 卷账台/书画间/六房等条' },
    { id: 'life', label: '生活与商业用品', geometry: '炊具、货担、货物、酒瓮、药柜、兵器架、仪仗、香炉', materials: ['木', '陶', '铁', '铜', '竹', '布'], texture: '货物标签、油渍、烟熏、库存与使用痕', lod: '近景逐件；中景组合；远景成组', evidence: '47 卷商业/工作用品逐条；20/30 卷物品表' },
    { id: 'plant', label: '室内植物与花器', geometry: '瓶花、盆景、花篮、药草束、树池', materials: ['瓷', '陶', '木', '叶', '花'], texture: '花瓣/叶脉透光、土面与露水', lod: '近景叶片；中景花团；远景色块', evidence: '10/20/30 卷植物表；47 卷房间植物条' },
    { id: 'light', label: '室内灯具', geometry: '烛台、吊灯、宫灯、壁灯、灯笼、灯箱、香炉火光', materials: ['铜', '木', '纸', '纱', '琉璃'], texture: '灯纸透光、金属錾花、烟熏与火焰自发光', lod: '近景灯具；中景光源；远景光晕', evidence: '47 卷照明列；world.ts INTERIOR_LIGHTS' },
    { id: 'occupant', label: '室内人物站位', geometry: '座席、站位、工作位、侍立位与对应动作锚', materials: ['不适用'], texture: '不适用', lod: '近景人物全细节；远景人数与轮廓', evidence: '42 卷角色卡；20 卷行为表；47 卷动线' },
  ],
  furniture: [
    { id: 'top', label: '台面与座面', geometry: '独板、攒边、圆角、磨亮与压痕', materials: ['榆木', '楠木', '紫檀', '石', '竹'], texture: '木纹、漆面、杯痕、坐痕', lod: '近景倒角与压痕；中景盒体；远景轮廓', evidence: '47 卷 C-ITM-0084 等家具条' },
    { id: 'frame', label: '腿足与榫卯', geometry: '四腿、霸王枨、牙板、横枨、榫卯节点', materials: ['硬木'], texture: '顺纹木纹、包浆、磨损', lod: '近景节点；中景四腿；远景盒体', evidence: '47 卷家具工艺条' },
    { id: 'hardware', label: '铜活与包角', geometry: '合页、面叶、包角、锁扣、拉手', materials: ['铜', '铁', '鎏金'], texture: '錾花、铜绿、血锈、磨亮', lod: '近景錾花；中景色块；远景略', evidence: '47 卷金属件列；44 卷 M-10/M-12' },
    { id: 'soft', label: '坐垫与织物', geometry: '坐垫、靠背、桌围、帘幕', materials: ['棉', '绸', '绢', '纱'], texture: '织纹、绣纹、褶距与透光', lod: '近景织物；中景平面；远景色块', evidence: '47 卷坐垫/屏风/帐幔条' },
  ],
  object: [
    { id: 'body', label: '器物主体', geometry: '旋转体、焊接件、编结件、琢玉件', materials: ['瓷', '陶', '铜', '银', '玉', '木', '竹'], texture: '釉/锈/玉理/木纹/编织分包', lod: '近景口沿与底足；中景器形；远景光点', evidence: '47 卷 174 件陈设精描' },
    { id: 'detail', label: '附件与标签', geometry: '盖、流、柄、系、底座、封签、提梁', materials: ['同主体或金属/纸帛'], texture: '标签文字、封泥、磨损位', lod: '近景附件独立；中景合并；远景略', evidence: '10/20/30 卷 ITM 行' },
    { id: 'use', label: '使用痕', geometry: '磨口、凹痕、油渍、烟熏、缺口', materials: ['表面层'], texture: '独立 AO/roughness/decal 层', lod: '近景可见；中景保留主要痕；远景无', evidence: '47 卷磨损位列' },
  ],
  plant: [
    { id: 'trunk', label: '主干与根', geometry: '分叉主干、根盘、树皮裂纹、藤蔓', materials: ['树皮', '木质', '竹'], texture: '树皮 normal、苔、湿痕', lod: '近景枝干；中景锥体；远景剪影', evidence: '10/20/30 卷 PLT 表；flora.ts' },
    { id: 'branch', label: '枝与叶', geometry: '分枝、叶簇、叶脉、垂枝、竹节', materials: ['叶', '枝'], texture: '叶色变化、透光、风摆顶点动画', lod: '近景叶片卡片；中景叶簇；远景团块', evidence: 'props.ts willow/buildTrees；flora.ts' },
    { id: 'bloom', label: '花与果', geometry: '花瓣、花蕊、花簇、果实、莲蓬', materials: ['花瓣', '果实'], texture: '花色、透光、斑点、露水', lod: '近景花形；中景花团；远景色点', evidence: '10/30 卷植物花部条' },
    { id: 'ground', label: '种植界面', geometry: '树池、花坛、盆、土面、卵石', materials: ['石', '陶', '土', '木'], texture: '土面、苔、落叶、水痕', lod: '近景边界；中景土面；远景略', evidence: '47 卷植物条；20 卷铺地律' },
  ],
  creature: [
    { id: 'body', label: '躯干与头', geometry: '体型、头骨、口鼻、耳角、鬃毛轮廓', materials: ['皮毛', '鳞甲', '骨', '羽'], texture: '毛流/鳞片/羽片 normal 与色差', lod: '近景头部；中景躯干；远景剪影', evidence: '10/30 卷 CRT 表；creatures.ts' },
    { id: 'limb', label: '四肢/翼鳍/尾', geometry: '关节链、爪蹄、翼膜、鳍、尾节', materials: ['皮毛', '鳞', '羽'], texture: '关节褶皱、膜透光、爪甲', lod: '近景关节；中景整肢；远景略', evidence: '10/30 卷生物行为条' },
    { id: 'rig', label: '绑定与动作', geometry: '骨架、蒙皮权重、动作剪辑、根运动', materials: ['不适用'], texture: '不适用', lod: '近景全帧；远景降频', evidence: 'creatures.ts runner；角色卷动作签名' },
    { id: 'state', label: '状态与特效', geometry: '受击、腾云、火焰、鬼火、蹄光', materials: ['VFX'], texture: '事件驱动材质与粒子', lod: '近景全特效；远景简化为光点', evidence: 'creatures.ts；vfx.ts' },
  ],
  character: [
    { id: 'body', label: '身体与比例', geometry: '头身比、肩腰胯、四肢关节、手指脚趾', materials: ['肤', '衣'], texture: '皮肤色差、手部老茧、纹身', lod: '近景关节；中景整体；远景剪影', evidence: '40/41/42/43 卷角色卡' },
    { id: 'head', label: '头面与发冠', geometry: '脸型、五官、发髻、幞头、斗笠、冠、面具', materials: ['肤', '发', '布', '金属'], texture: '面部、发丝、头衣纹样', lod: '近景五官；中景头形；远景帽形', evidence: '42 卷头衣/形貌记忆点' },
    { id: 'garment', label: '服装与鞋履', geometry: '内外衣、袍摆、宽袖、绑腿、腰带、鞋靴', materials: ['麻', '绸', '锦', '皮', '草'], texture: '织纹、补丁、油渍、磨损', lod: '近景衣褶；中景服装体块；远景配色', evidence: '42 卷服装/鞋袜/配饰' },
    { id: 'prop', label: '兵器与随身物', geometry: '刀枪剑戟、扁担、酒桶、药箱、书卷、法器', materials: ['钢', '木', '铜', '竹', '布'], texture: '刃线、木纹、缠绳、血迹与包浆', lod: '近景刃口；中景轮廓；远景省略', evidence: '42 卷兵器/随身道具' },
    { id: 'action', label: '动作签名', geometry: '骨架动作、手部 IK、道具接触点', materials: ['不适用'], texture: '不适用', lod: '近景全帧；远景抽帧', evidence: '42 卷动作签名；actions.ts' },
    { id: 'voice', label: '口头禅与声线', geometry: '不适用', texture: '不适用', materials: ['不适用'], lod: '近景空间声；远景环境声', evidence: '42 卷声音语气/口头禅' },
  ],
  transport: [
    { id: 'chassis', label: '车体/船体', geometry: '车箱、车辕、船壳、龙骨、甲板、舱篷', materials: ['木', '竹', '铁', '布'], texture: '船板/车木纹、桐油、水线、磨损', lod: '近景板缝；中景体块；远景剪影', evidence: '20 卷 5.1 交通；units.ts/river.ts' },
    { id: 'running', label: '轮轴/橹桨/挽具', geometry: '车轮、车轴、橹、桨、纤绳、马具', materials: ['木', '铁', '麻绳', '皮'], texture: '磨亮、泥、绳纹', lod: '近景机构；中景整体；远景略', evidence: '20 卷 5.1；units.ts' },
    { id: 'load', label: '货物与乘客', geometry: '粮包、箱笼、酒瓮、乘客坐位', materials: ['麻', '木', '陶', '布'], texture: '标签、封条、绑绳', lod: '近景逐件；中景组合；远景略', evidence: '20 卷交通/交互点' },
    { id: 'mark', label: '旗号灯饰', geometry: '旗、灯笼、船号、铃铛', materials: ['布', '纸', '铜'], texture: '字旗、灯纸、铜锈', lod: '近景文字；中景色块；远景光点', evidence: '20 卷船旗/夜市灯' },
  ],
  terrain: [
    { id: 'macro', label: '大地形', geometry: '高度场、山体、河谷、湖岸、沙丘', materials: ['土', '岩', '沙', '草'], texture: '宏观色斑、坡向、侵蚀纹理', lod: '近景分块；中景高度场；远景远景层', evidence: 'world.ts terrainHeight；10/20/30 卷地貌' },
    { id: 'road', label: '道路与铺装', geometry: '街道、巷、桥面、石板、夯土、车辙', materials: ['石', '土', '木'], texture: '石板缝、车辙、油渍、湿痕', lod: '近景铺块；中景整面；远景路网', evidence: 'layout.ts/props.ts；45 卷量纲' },
    { id: 'water', label: '河流湖泊', geometry: '水面、岸坡、码头、桥拱、倒影', materials: ['水', '石', '木'], texture: '水波 normal、浑浊、倒影、泡沫', lod: '近景反射；中景水面；远景色带', evidence: 'river.ts/world.ts Reflector' },
    { id: 'scatter', label: '地表散置', geometry: '石块、草簇、落叶、垃圾、货物', materials: ['石', '草', '纸', '木'], texture: '共享小纹理与随机旋转', lod: '近景实例；中景稀疏；远景无', evidence: 'pavement.ts/props.ts' },
  ],
  material: [
    { id: 'albedo', label: '基础色', geometry: '不适用', texture: '按 M 卡生成可平铺 albedo', materials: ['全部材质族'], lod: '全距离', evidence: '44 卷 25 材质卡' },
    { id: 'normal', label: '法线', geometry: '不适用', texture: '砖缝/瓦垄/木纹/织物/鳞片法线', materials: ['全部材质族'], lod: '近中景', evidence: 'bake.ts makeNormal' },
    { id: 'rough', label: '粗糙度', geometry: '不适用', texture: '磨亮、油、湿、金属与纸绢粗糙度', materials: ['全部材质族'], lod: '近中景', evidence: '44 卷反光度/粗糙度' },
    { id: 'ao', label: 'AO 与接触暗部', geometry: '不适用', texture: '缝、角、底足、墙脚 AO', materials: ['全部材质族'], lod: '近景', evidence: 'bake.ts deriveAux' },
    { id: 'decay', label: '老化与使用痕', geometry: '不适用', texture: '苔、烟熏、血渍、手泽、残金、裂纹', materials: ['全部材质族'], lod: '近景', evidence: '45/46/47 卷老化字段' },
  ],
  pattern: [
    { id: 'motif', label: '纹样单元', geometry: '可复用 SVG/Canvas 图形单元', materials: ['彩画/织锦/砖雕/金属錾花'], texture: 'P 卡图集，透明或灰度遮罩', lod: '近景完整；中景主纹；远景不显', evidence: '44 卷 22 纹样卡' },
    { id: 'placement', label: '部位映射', geometry: '额枋/裙板/格心/栏板/地毯 UV 映射', materials: ['按构件'], texture: '按部位缩放、旋转、镜像', lod: '近中景', evidence: '45/46/47 卷纹样部位' },
    { id: 'signal', label: '发光纹样', geometry: '刻槽/霓虹/磷光槽', materials: ['霓虹管', '磷光', '金线'], texture: '发光遮罩与动画相位', lod: '全距离保留色点', evidence: '44 卷 P 卡霓虹叠加规则' },
  ],
  lighting: [
    { id: 'fixture', label: '灯具实体', geometry: '宫灯、灯笼、烛台、壁灯、灯箱、灯柱', materials: ['铜', '木', '纸', '纱', '琉璃', '铁'], texture: '灯纸、金属、纱、烟熏', lod: '近景灯具；中景灯体；远景光点', evidence: '47 卷照明列；world.ts 三类灯表' },
    { id: 'source', label: '光源与光域', geometry: '点光/面光/发光材质', materials: ['光'], texture: '不适用', lod: '近景点光；中景近似；远景发光', evidence: 'world.ts INTERIOR/HELL/SKY_LIGHTS' },
    { id: 'behavior', label: '光照行为', geometry: '不适用', materials: ['不适用'], texture: '不适用', lod: '随距离降频', evidence: 'time.neon；夜/昼/深更光节律' },
  ],
};

export const REQUIRED_ROOM_FIELDS = ['ground', 'walls', 'ceiling', 'doorsWindows', 'lighting', 'screens'] as const;

export interface WorldAtomTotals {
  regions: number;
  buildings: number;
  organismSpecies: number;
  landforms: number;
  items: number;
  characterCards: number;
  characterIndividuals: number;
  materialCards: number;
  patternCards: number;
}

export interface BuildingIndexEntry {
  id: string;
  realm: 'sky' | 'human' | 'underworld';
  kind: 'building' | 'template';
  name: string;
  sources: string[];
  hasMaterialDetail: boolean;
}

export interface DetailedBuilding {
  id: string;
  name: string;
  realm: 'sky' | 'human' | 'underworld';
  source: string;
  fields: Record<string, string>;
}

export interface InteriorRoom {
  buildingId: string;
  id: string;
  name: string;
  ground: string;
  walls: string;
  ceiling: string;
  doorsWindows: string;
  lighting: string;
  screens: string;
  source: string;
}

export interface InteriorBuilding {
  id: string;
  name: string;
  realm: 'sky' | 'human' | 'underworld';
  roomCount: number;
  rooms: InteriorRoom[];
  source: string;
}

export interface DetailedItem {
  id: string;
  name: string;
  material: string;
  textureDirection: string;
  metalwork: string;
  wear: string;
  light: string;
  source: string;
}

export interface CharacterEntry {
  id: string;
  name: string;
  realm: 'sky' | 'human' | 'underworld';
  source: string;
}

export interface IndexedAsset {
  id: string;
  name: string;
  source: string;
}

export interface WorldAtomCatalog {
  schemaVersion: 1;
  totals: WorldAtomTotals;
  buildings: BuildingIndexEntry[];
  detailedBuildings: DetailedBuilding[];
  interiors: InteriorBuilding[];
  items: number;
  /** 物品 ID → 资产卷中的名称（838 件全量，缺失为 null） */
  itemIdNames: Record<string, string | null>;
  itemIds: string[];
  detailedItems: DetailedItem[];
  characters: CharacterEntry[];
  plants: IndexedAsset[];
  creatures: IndexedAsset[];
}

export interface WorldAtomAudit {
  buildingMaterialGap: number;
  itemMaterialGap: number;
  missingRoomFields: number;
  missingAnatomyFields: number;
  complete: boolean;
}

export function auditWorldAtoms(catalog: WorldAtomCatalog): WorldAtomAudit {
  let missingRoomFields = 0;
  for (const building of catalog.interiors) {
    for (const room of building.rooms) {
      for (const field of REQUIRED_ROOM_FIELDS) if (!room[field].trim()) missingRoomFields++;
    }
  }
  let missingAnatomyFields = 0;
  for (const parts of Object.values(ATOM_ANATOMY)) {
    for (const part of parts) {
      if (!part.geometry.trim() || part.materials.length === 0 || !part.texture.trim() || !part.evidence.trim()) {
        missingAnatomyFields++;
      }
    }
  }
  const buildingMaterialGap = catalog.buildings.length - catalog.detailedBuildings.length;
  const itemMaterialGap = catalog.totals.items - catalog.detailedItems.length;
  return {
    buildingMaterialGap,
    itemMaterialGap,
    missingRoomFields,
    missingAnatomyFields,
    complete: buildingMaterialGap === 0 && itemMaterialGap === 0 && missingRoomFields === 0 && missingAnatomyFields === 0,
  };
}
