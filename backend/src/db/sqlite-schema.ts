/**
 * SQLite 启动建表 DDL + 种子数据（自 mysql-schema.ts 翻译）
 * - AUTO_INCREMENT → AUTOINCREMENT；删除 ENGINE/CHARSET；TINYINT(1) → INTEGER
 * - MySQL 内联 INDEX 拆为独立 CREATE INDEX IF NOT EXISTS
 * - 种子语句去掉 FROM DUAL（SQLite 非法），幂等语义（WHERE NOT EXISTS）保留
 */
import type Database from 'better-sqlite3'

export const sqliteSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS dramas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    genre TEXT,
    style TEXT DEFAULT '3d',
    aspect_ratio TEXT DEFAULT '16:9',
    total_episodes INTEGER DEFAULT 1,
    total_duration INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    thumbnail TEXT,
    tags TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    episode_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    script_content TEXT,
    description TEXT,
    duration INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',
    video_url TEXT,
    thumbnail TEXT,
    image_config_id INTEGER,
    video_config_id INTEGER,
    resolution TEXT DEFAULT '720p',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    role TEXT,
    description TEXT,
    appearance TEXT,
    styling TEXT,
    final_prompt TEXT,
    personality TEXT,
    image_url TEXT,
    voice_audio_url TEXT,
    voice_audio_name TEXT,
    reference_images TEXT,
    seed_value TEXT,
    sort_order INTEGER,
    local_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    episode_id INTEGER,
    location TEXT NOT NULL,
    time TEXT NOT NULL,
    prompt TEXT NOT NULL,
    lighting TEXT,
    final_prompt TEXT,
    storyboard_count INTEGER DEFAULT 1,
    image_url TEXT,
    status TEXT DEFAULT 'pending',
    local_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS storyboards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    scene_id INTEGER,
    storyboard_number INTEGER NOT NULL,
    title TEXT,
    location TEXT,
    time TEXT,
    shot_type TEXT,
    angle TEXT,
    movement TEXT,
    result TEXT,
    atmosphere TEXT,
    image_prompt TEXT,
    video_prompt TEXT,
    bgm_prompt TEXT,
    sound_effect TEXT,
    description TEXT,
    duration INTEGER DEFAULT 0,
    composed_image TEXT,
    first_frame_image TEXT,
    last_frame_image TEXT,
    reference_images TEXT,
    video_url TEXT,
    subtitle_url TEXT,
    composed_video_url TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS episode_characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_episode_characters_episode_id ON episode_characters (episode_id)`,
  `CREATE INDEX IF NOT EXISTS idx_episode_characters_character_id ON episode_characters (character_id)`,

  `CREATE TABLE IF NOT EXISTS episode_scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    scene_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_episode_scenes_episode_id ON episode_scenes (episode_id)`,
  `CREATE INDEX IF NOT EXISTS idx_episode_scenes_scene_id ON episode_scenes (scene_id)`,

  `CREATE TABLE IF NOT EXISTS episode_props (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    prop_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_episode_props_episode_id ON episode_props (episode_id)`,
  `CREATE INDEX IF NOT EXISTS idx_episode_props_prop_id ON episode_props (prop_id)`,

  `CREATE TABLE IF NOT EXISTS storyboard_characters (
    storyboard_id INTEGER NOT NULL,
    character_id INTEGER NOT NULL,
    PRIMARY KEY (storyboard_id, character_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_storyboard_characters_character_id ON storyboard_characters (character_id)`,

  `CREATE TABLE IF NOT EXISTS storyboard_props (
    storyboard_id INTEGER NOT NULL,
    prop_id INTEGER NOT NULL,
    PRIMARY KEY (storyboard_id, prop_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_storyboard_props_prop_id ON storyboard_props (prop_id)`,

  `CREATE TABLE IF NOT EXISTS ai_service_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_type TEXT NOT NULL,
    provider TEXT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model TEXT,
    endpoint TEXT,
    query_endpoint TEXT,
    priority INTEGER DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    settings TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS ai_service_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    display_name TEXT,
    service_type TEXT NOT NULL,
    provider TEXT NOT NULL,
    default_url TEXT,
    preset_models TEXT,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS style_presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    prompt TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (value)
  )`,

  `CREATE TABLE IF NOT EXISTS sys_task (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    storyboard_id INTEGER,
    drama_id INTEGER,
    scene_id INTEGER,
    character_id INTEGER,
    prop_id INTEGER,
    provider TEXT,
    prompt TEXT,
    model TEXT,
    params TEXT,
    task_id TEXT,
    result_url TEXT,
    local_path TEXT,
    status TEXT DEFAULT 'processing',
    error_msg TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sys_task_type ON sys_task (type)`,
  `CREATE INDEX IF NOT EXISTS idx_sys_task_drama_id ON sys_task (drama_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sys_task_storyboard_id ON sys_task (storyboard_id)`,

  `CREATE TABLE IF NOT EXISTS video_merges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER,
    drama_id INTEGER,
    title TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    scenes TEXT,
    merged_url TEXT,
    duration INTEGER,
    task_id TEXT,
    error_msg TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS props (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT,
    description TEXT,
    prompt TEXT,
    final_prompt TEXT,
    image_url TEXT,
    reference_images TEXT,
    local_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER,
    episode_id INTEGER,
    storyboard_id INTEGER,
    storyboard_num INTEGER,
    name TEXT,
    description TEXT,
    type TEXT,
    category TEXT,
    url TEXT,
    thumbnail_url TEXT,
    local_path TEXT,
    file_size INTEGER,
    mime_type TEXT,
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    format TEXT,
    image_gen_id INTEGER,
    video_gen_id INTEGER,
    is_favorite INTEGER DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  // 应用级全局设置（key-value，如 AI 内容语言 content_language）
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // ─── 多用户 / 多团队 / 算力计费体系 ───────────────────────────────
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_source TEXT NOT NULL DEFAULT 'user',
    is_super_admin INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    current_team_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    owner_id INTEGER NOT NULL,
    project_visibility TEXT NOT NULL DEFAULT 'team_shared',
    credit_balance INTEGER NOT NULL DEFAULT 0,
    frozen_credits INTEGER NOT NULL DEFAULT 0,
    total_recharged INTEGER NOT NULL DEFAULT 0,
    total_consumed INTEGER NOT NULL DEFAULT 0,
    api_key_hash TEXT,
    api_key_prefix TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_teams_owner_id ON teams (owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_teams_api_key_hash ON teams (api_key_hash)`,

  `CREATE TABLE IF NOT EXISTS team_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    credit_limit INTEGER,
    credit_used INTEGER NOT NULL DEFAULT 0,
    joined_at TEXT NOT NULL,
    UNIQUE (team_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members (team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members (user_id)`,

  `CREATE TABLE IF NOT EXISTS drama_shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drama_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    permission TEXT NOT NULL DEFAULT 'edit',
    created_at TEXT NOT NULL,
    UNIQUE (drama_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_drama_shares_drama_id ON drama_shares (drama_id)`,
  `CREATE INDEX IF NOT EXISTS idx_drama_shares_user_id ON drama_shares (user_id)`,

  `CREATE TABLE IF NOT EXISTS team_invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    code TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'member',
    credit_limit INTEGER,
    max_uses INTEGER NOT NULL DEFAULT 10,
    used_count INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_team_invitations_team_id ON team_invitations (team_id)`,

  `CREATE TABLE IF NOT EXISTS user_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    active_team_id INTEGER,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions (expires_at)`,

  `CREATE TABLE IF NOT EXISTS credit_pricing (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_type TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT '*',
    model_pattern TEXT NOT NULL DEFAULT '*',
    billing_unit TEXT NOT NULL,
    unit_credits INTEGER NOT NULL,
    resolution_multiplier_json TEXT,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS credit_packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    credits INTEGER NOT NULL,
    bonus_credits INTEGER NOT NULL DEFAULT 0,
    price_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'CNY',
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS redeem_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    credits INTEGER NOT NULL,
    batch_note TEXT,
    status TEXT NOT NULL DEFAULT 'unused',
    redeemed_by_team_id INTEGER,
    redeemed_by_user_id INTEGER,
    redeemed_at TEXT,
    expires_at TEXT,
    created_by INTEGER,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_redeem_codes_status ON redeem_codes (status)`,

  `CREATE TABLE IF NOT EXISTS recharge_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT NOT NULL UNIQUE,
    team_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    package_id INTEGER,
    credits INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    payment_channel TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    external_trade_no TEXT,
    note TEXT,
    paid_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_recharge_orders_team_id ON recharge_orders (team_id)`,

  `CREATE TABLE IF NOT EXISTS credit_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    user_id INTEGER,
    type TEXT NOT NULL,
    amount INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    task_id INTEGER,
    order_id INTEGER,
    description TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_credit_ledger_team_id ON credit_ledger (team_id)`,
  `CREATE INDEX IF NOT EXISTS idx_credit_ledger_task_id ON credit_ledger (task_id)`,
]

/**
 * 风格预设种子数据 — value 存入 dramas.style，prompt 注入生图提示词（作为前缀拼接）
 *
 * prompt 统一按多维结构书写，保证跨模型/跨镜头的风格控制力：
 *   核心媒介与渲染 → 线条/造型 → 上色/材质 → 光影 → 色彩调性 → 背景处理 → 画质锚点 → avoid 禁忌项
 */
export const stylePresetSeeds = [
  {
    name: '3D 漫剧', value: '3d', sortOrder: 1,
    prompt: 'high-quality 3D CG animation still, modern game-engine cinematic render, Unreal Engine and Pixar grade quality, semi-realistic stylized characters with refined facial features, clean sculpted anatomy, detailed skin shader with subtle subsurface scattering, PBR materials with crisp detailed textures, volumetric cinematic lighting with soft rim light, rich depth of field, polished film color grading, detailed environment art, sharp focus, consistent character design across shots, avoid flat lighting, avoid plastic waxy skin, avoid low-poly blurry look, avoid 2D flat cel shading, avoid anime line art',
    description: '游戏引擎级 3D 渲染，半写实角色，当前短剧主流的 3D 漫剧质感',
  },
  {
    name: '日漫赛璐璐', value: 'anime', sortOrder: 2,
    prompt: 'Japanese TV anime style, clean cel shading with hard-edged shadow shapes, crisp uniform black line art, vivid saturated color palette, expressive large-eyed character design with on-model proportions, detailed hand-painted anime backgrounds, dramatic anime key lighting with screentone highlights, key-visual poster quality, consistent character design across shots, avoid 3D CGI look, avoid painterly soft blending, avoid watercolor texture, avoid photorealism, avoid thick western comic outlines',
    description: '日式赛璐璐动画风格',
  },
  {
    name: '吉卜力手绘', value: 'ghibli', sortOrder: 3,
    prompt: 'Studio Ghibli hand-drawn animation style, soft painterly brushwork with organic hand-crafted line quality, lush warm watercolor painted backgrounds, gentle natural daylight with nostalgic warm glow, muted earthy natural color palette, whimsical cozy storybook atmosphere, subtle film-grain softness, theatrical background art quality, consistent character design across shots, avoid hard cel shading, avoid 3D render look, avoid neon over-saturated colors, avoid sharp digital edges, avoid photorealism',
    description: '吉卜力手绘治愈风',
  },
  {
    name: '水彩绘本', value: 'watercolor', sortOrder: 4,
    prompt: 'delicate watercolor storybook illustration, soft translucent color washes, visible cold-press paper texture, fluid hand-painted brushstrokes with gentle pigment bleeds, light airy atmosphere, harmonious pastel palette, whimsical children book charm, loose expressive edges, consistent character design across shots, avoid bold black outlines, avoid digital airbrush look, avoid harsh contrast, avoid 3D rendering, avoid photorealism',
    description: '水彩插画质感',
  },
  {
    name: '美式漫画', value: 'comic', sortOrder: 5,
    prompt: 'Western graphic-novel comic book style, bold confident black ink outlines, halftone dot shading and screentone gradients, dynamic saturated colors with dramatic contrast, dramatic spotlight lighting, flat graphic print look, sharp inking details, dynamic cinematic composition, consistent character design across shots, avoid painterly soft blending, avoid watercolor washes, avoid photorealistic rendering, avoid 3D CGI look, avoid anime cel shading',
    description: '美式漫画粗线条风格',
  },
  {
    name: '国风 2.5D', value: 'guofeng', sortOrder: 7,
    prompt: 'Chinese guofeng 2.5D illustration style, semi-realistic donghua-quality character art, elegant flowing line work, rich traditional Chinese aesthetic elements, layered ink-wash inspired atmospheric backgrounds, refined silk and fabric textures, soft luminous lighting with gentle haze, sophisticated muted jewel-tone palette, xianxia drama poster quality, consistent character design across shots, avoid flat cel shading, avoid western comic ink style, avoid photorealism, avoid plastic 3D look, avoid modern clothing and props unless specified',
    description: '国风动画/仙侠剧质感，2.5D 半写实',
  },
  {
    name: '韩系网漫', value: 'webtoon', sortOrder: 8,
    prompt: 'Korean webtoon manhwa style, clean digital painting with soft gradient shading, slim elegant character proportions, large expressive eyes with detailed highlights, soft glowing skin rendering, romantic dreamy lighting, modern pastel-to-vivid color palette, detailed fashion and fabric rendering, webtoon key visual quality, consistent character design across shots, avoid heavy black ink outlines, avoid halftone dots, avoid 3D render look, avoid watercolor paper texture, avoid chibi proportions',
    description: '韩国条漫/网漫精致上色风',
  },
  {
    name: '黑白漫画', value: 'noir', sortOrder: 9,
    prompt: 'black and white manga illustration, high-contrast monochrome ink work, dynamic hatching and cross-hatching shading, bold solid blacks with dramatic negative space, screentone gray gradation, expressive confident ink linework, cinematic noir lighting, professional manga page quality, consistent character design across shots, strictly no color, avoid grayscale blur smudging, avoid painterly soft edges, avoid photorealism, avoid 3D render look',
    description: '黑白漫/ Noir 高对比墨水风',
  },
]

/**
 * 旧版种子 prompt（v1 一句话风格描述）— 用于内容寻址升级：
 * 仅当库中行的 prompt 仍等于旧种子值（未被用户在设置页编辑过）才覆盖为新 prompt
 */
const LEGACY_SEED_PROMPTS: Record<string, string> = {
  '3d': '3D CG animation style, game-engine quality render, semi-realistic stylized characters, refined facial features, detailed materials and textures, cinematic lighting, high detail',
  anime: 'Japanese anime style, cel shading, clean crisp line art, vivid saturated colors, expressive character designs, detailed painted backgrounds',
  ghibli: 'Studio Ghibli style, hand-drawn animation, soft watercolor painted backgrounds, warm nostalgic lighting, gentle natural palette, whimsical cozy atmosphere',
  watercolor: 'watercolor illustration style, soft translucent washes, visible paper texture, delicate fluid brushwork, light airy atmosphere, hand-painted storybook feel',
  comic: 'Western comic book style, bold black ink outlines, halftone dot shading, dynamic saturated colors, dramatic contrast lighting, flat graphic novel look',
}

/**
 * 已下架的种子预设 — 内容寻址删除：仅当库中行的 prompt 仍是种子原文
 * （未被用户编辑过）才删除；用户改过的同名行视为用户数据保留。
 * live（真人写实）：真人影像过不了平台真人内容审核，下架。
 */
const REMOVED_SEED_PROMPTS: Record<string, string> = {
  live: 'ultra-realistic cinematic live-action look, professional film photography, natural skin tones with detailed pores and realistic texture, true human anatomy and proportions, shallow depth of field with creamy bokeh, cinematic three-point lighting, subtle film grain, 35mm lens cinematic framing, true-to-life color grading, detailed real-world environments, consistent actor appearance across shots, avoid cartoon or anime features, avoid 3D render look, avoid illustration style, avoid plastic waxy skin, avoid over-smoothing beauty filter',
}

// INSERT ... SELECT WHERE NOT EXISTS → 幂等：只补缺失行，不覆盖用户编辑
// （SQLite 无 FROM DUAL，无 FROM 的 SELECT 合法）
const SEED_SQL = 'INSERT INTO style_presets ("name", "value", "prompt", "description", "sort_order", "is_active", "created_at", "updated_at") SELECT ?, ?, ?, ?, ?, 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM style_presets WHERE value = ?)'
// 内容寻址升级：命中旧种子原文才更新（用户在设置页改过的行不动）
const UPGRADE_SQL = 'UPDATE style_presets SET "name" = ?, "prompt" = ?, "description" = ?, "sort_order" = ?, "updated_at" = ? WHERE "value" = ? AND "prompt" = ?'
// 内容寻址下架：命中下架种子原文才删除
const REMOVE_SQL = 'DELETE FROM style_presets WHERE "value" = ? AND "prompt" = ?'

export const creditPricingSeeds = [
  { serviceType: 'text', provider: '*', modelPattern: '*', billingUnit: 'per_call', unitCredits: 2, resolutionMultiplierJson: null, description: '文本模型调用（剧本改写 / 资产提取 / 分镜拆解 / 提示词）' },
  { serviceType: 'image', provider: 'comfyui', modelPattern: '*', billingUnit: 'per_image', unitCredits: 5, resolutionMultiplierJson: null, description: '本地算力 · 图片生成' },
  { serviceType: 'image', provider: '*', modelPattern: '*', billingUnit: 'per_image', unitCredits: 10, resolutionMultiplierJson: null, description: '云端模型 · 高清图片生成' },
  { serviceType: 'video', provider: 'comfyui', modelPattern: '*', billingUnit: 'per_second', unitCredits: 8, resolutionMultiplierJson: '{"480p":0.8,"720p":1,"1080p":1.5}', description: '本地算力 · 视频生成（按秒计费）' },
  { serviceType: 'video', provider: 'grok', modelPattern: '*', billingUnit: 'per_second', unitCredits: 15, resolutionMultiplierJson: '{"480p":0.8,"720p":1,"1080p":1.5}', description: 'Grok 视频生成（按秒计费）' },
  { serviceType: 'video', provider: 'nihapi', modelPattern: '*', billingUnit: 'per_second', unitCredits: 15, resolutionMultiplierJson: '{"480p":0.8,"720p":1,"1080p":1.5}', description: '商业大模型视频生成（MiniMax / Kling / Wan / Seedance 按秒）' },
  { serviceType: 'video', provider: '*', modelPattern: '*', billingUnit: 'per_second', unitCredits: 15, resolutionMultiplierJson: '{"480p":0.8,"720p":1,"1080p":1.5}', description: '通用云端视频生成（按秒计费）' },
]

export const creditPackageSeeds = [
  { name: '体验算力包', credits: 1000, bonusCredits: 0, priceCents: 990, description: '适合个人轻量试玩，约可生成 100 张图或 13 段视频', sortOrder: 1 },
  { name: '标准创作包', credits: 5000, bonusCredits: 500, priceCents: 4900, description: '独立创作者推荐，额外赠送 500 算力点', sortOrder: 2 },
  { name: '团队专业包', credits: 20000, bonusCredits: 3000, priceCents: 19900, description: '小型短剧团队主力套餐，额外赠送 3,000 算力点', sortOrder: 3 },
  { name: '工作室旗舰包', credits: 100000, bonusCredits: 20000, priceCents: 89900, description: '批量量产工作室专享，额外赠送 20,000 算力点', sortOrder: 4 },
]

function ensureColumns(sqlite: Database.Database, table: string, defs: Record<string, string>) {
  const existing = new Set((sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name))
  for (const [name, ddl] of Object.entries(defs)) {
    if (!existing.has(name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`)
  }
}

export function initSqliteSchema(sqlite: Database.Database) {
  for (const statement of sqliteSchemaStatements) {
    sqlite.exec(statement)
  }
  // 兼容已安装的桌面版与存量库；仅增加扩展元数据，不改写历史生成结果。
  ensureColumns(sqlite, 'sys_task', {
    config_id: 'INTEGER',
    config_base_url: 'TEXT',
    stage: 'TEXT',
    error_code: 'TEXT',
    team_id: 'INTEGER',
    user_id: 'INTEGER',
    frozen_credits: 'INTEGER DEFAULT 0',
    settled_credits: 'INTEGER DEFAULT 0',
    billing_status: "TEXT DEFAULT 'none'",
  })
  ensureColumns(sqlite, 'dramas', {
    team_id: 'INTEGER',
    created_by: 'INTEGER',
    visibility: 'TEXT',
  })
  ensureColumns(sqlite, 'ai_service_configs', {
    team_id: 'INTEGER',
  })
  ensureColumns(sqlite, 'video_merges', {
    team_id: 'INTEGER',
    created_by: 'INTEGER',
  })
  ensureColumns(sqlite, 'assets', {
    team_id: 'INTEGER',
    created_by: 'INTEGER',
  })
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_dramas_team_id ON dramas (team_id)')
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_sys_task_team_id ON sys_task (team_id)')
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_ai_service_configs_team_id ON ai_service_configs (team_id)')

  // 角色音色由用户上传；旧库补充可空字段，不修改已有角色和图片。
  ensureColumns(sqlite, 'characters', {
    voice_audio_url: 'TEXT',
    voice_audio_name: 'TEXT',
  })
  const insertSeed = sqlite.prepare(SEED_SQL)
  for (const table of ['characters', 'scenes', 'props']) {
    ensureColumns(sqlite, table, {
      reference_asset_id: 'INTEGER',
      reference_note: 'TEXT',
    })
  }
  const upgradeSeed = sqlite.prepare(UPGRADE_SQL)
  const removeSeed = sqlite.prepare(REMOVE_SQL)
  for (const s of stylePresetSeeds) {
    const ts = new Date().toISOString()
    insertSeed.run(s.name, s.value, s.prompt, s.description, s.sortOrder, ts, ts, s.value)
    const legacyPrompt = LEGACY_SEED_PROMPTS[s.value]
    if (legacyPrompt) {
      const res = upgradeSeed.run(s.name, s.prompt, s.description, s.sortOrder, ts, s.value, legacyPrompt)
      if (res.changes > 0) console.log(`🎨 风格预设「${s.name}」已升级为结构化提示词`)
    }
  }
  for (const [value, prompt] of Object.entries(REMOVED_SEED_PROMPTS)) {
    const res = removeSeed.run(value, prompt)
    if (res.changes > 0) console.log(`🗑️ 风格预设「${value}」已下架`)
  }

  const ts = new Date().toISOString()
  // 初始化默认注册与计费开关（仅缺失时写入，不覆盖管理员在线修改）
  const insertSetting = sqlite.prepare('INSERT OR IGNORE INTO app_settings ("key", "value", "updated_at") VALUES (?, ?, ?)')
  insertSetting.run('auth.allow_open_register', 'true', ts)
  insertSetting.run('auth.allow_invite_register', 'true', ts)
  insertSetting.run('auth.register_bonus_credits', '200', ts)
  insertSetting.run('billing.enabled', 'true', ts)

  // 初始化默认计费规则与套餐（仅空表时种入）
  const pricingCount = (sqlite.prepare('SELECT COUNT(*) AS c FROM credit_pricing').get() as { c: number }).c
  if (pricingCount === 0) {
    const insPricing = sqlite.prepare(
      'INSERT INTO credit_pricing (service_type, provider, model_pattern, billing_unit, unit_credits, resolution_multiplier_json, description, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)'
    )
    for (const p of creditPricingSeeds) {
      insPricing.run(p.serviceType, p.provider, p.modelPattern, p.billingUnit, p.unitCredits, p.resolutionMultiplierJson, p.description, ts)
    }
  }

  const pkgCount = (sqlite.prepare('SELECT COUNT(*) AS c FROM credit_packages').get() as { c: number }).c
  if (pkgCount === 0) {
    const insPkg = sqlite.prepare(
      'INSERT INTO credit_packages (name, credits, bonus_credits, price_cents, currency, description, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, \'CNY\', ?, ?, 1, ?, ?)'
    )
    for (const pkg of creditPackageSeeds) {
      insPkg.run(pkg.name, pkg.credits, pkg.bonusCredits, pkg.priceCents, pkg.description, pkg.sortOrder, ts, ts)
    }
  }

  // 初始化默认超管账号与默认工作空间，并将存量单用户数据平滑归入默认团队
  sqlite.transaction(() => {
    let admin = sqlite.prepare('SELECT id, current_team_id FROM users WHERE is_super_admin = 1 ORDER BY id ASC LIMIT 1').get() as { id: number; current_team_id: number | null } | undefined
    if (!admin) {
      const res = sqlite.prepare(
        'INSERT INTO users (username, display_name, password_hash, password_source, is_super_admin, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)'
      ).run('admin', '系统管理员', 'env-managed', 'env', ts, ts)
      admin = { id: Number(res.lastInsertRowid), current_team_id: null }
    }

    let defaultTeam = sqlite.prepare('SELECT id FROM teams ORDER BY id ASC LIMIT 1').get() as { id: number } | undefined
    if (!defaultTeam) {
      const initialCredits = 100000
      const res = sqlite.prepare(
        'INSERT INTO teams (name, description, owner_id, project_visibility, credit_balance, frozen_credits, total_recharged, total_consumed, created_at, updated_at) VALUES (?, ?, ?, \'team_shared\', ?, 0, ?, 0, ?, ?)'
      ).run('默认工作空间', '系统初始化默认团队空间', admin.id, initialCredits, initialCredits, ts, ts)
      defaultTeam = { id: Number(res.lastInsertRowid) }
      sqlite.prepare(
        'INSERT OR IGNORE INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, \'owner\', ?)'
      ).run(defaultTeam.id, admin.id, ts)
      sqlite.prepare(
        'INSERT INTO credit_ledger (team_id, user_id, type, amount, balance_after, description, created_at) VALUES (?, ?, \'recharge\', ?, ?, ?, ?)'
      ).run(defaultTeam.id, admin.id, initialCredits, initialCredits, '系统初始化默认团队赠送算力', ts)
    } else {
      sqlite.prepare(
        'INSERT OR IGNORE INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, \'owner\', ?)'
      ).run(defaultTeam.id, admin.id, ts)
    }

    if (!admin.current_team_id) {
      sqlite.prepare('UPDATE users SET current_team_id = ? WHERE id = ?').run(defaultTeam.id, admin.id)
    }

    // 存量无归属数据平滑迁移至默认团队与管理员名下
    sqlite.prepare('UPDATE dramas SET team_id = ?, created_by = coalesce(created_by, ?) WHERE team_id IS NULL').run(defaultTeam.id, admin.id)
    sqlite.prepare('UPDATE assets SET team_id = ?, created_by = coalesce(created_by, ?) WHERE team_id IS NULL').run(defaultTeam.id, admin.id)
    sqlite.prepare('UPDATE video_merges SET team_id = ?, created_by = coalesce(created_by, ?) WHERE team_id IS NULL').run(defaultTeam.id, admin.id)
    sqlite.prepare('UPDATE sys_task SET team_id = ?, user_id = coalesce(user_id, ?) WHERE team_id IS NULL').run(defaultTeam.id, admin.id)
  })()
}
