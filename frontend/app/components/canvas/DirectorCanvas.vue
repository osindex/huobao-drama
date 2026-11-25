<template>
  <div class="dc-root" ref="rootRef">
    <!-- Top Floating Director Toolbar -->
    <div class="dc-toolbar">
      <div class="dc-toolbar-group">
        <button
          type="button"
          class="dc-tool-btn"
          :class="{ on: showAssetShelf }"
          @click="showAssetShelf = !showAssetShelf"
          title="展开/收起可拖拽到分镜卡的角色·场景·道具资产架"
        >
          📦 资产架 ({{ readyAssetCount }})
        </button>
        <span class="dc-sep" />
        <button type="button" class="dc-tool-btn" @click="applyAutoLayout('timeline')" title="按镜头顺序横向一字排开">
          ↔ 横向故事流
        </button>
        <button type="button" class="dc-tool-btn" @click="applyAutoLayout('lanes')" title="按所在场景分行排列，便于统合同一场景光影与机位">
          ☰ 场次泳道
        </button>
        <button type="button" class="dc-tool-btn" @click="applyAutoLayout('matrix')" title="紧凑双排故事板矩阵">
          ⊞ 故事板矩阵
        </button>
      </div>

      <div class="dc-toolbar-group">
        <button type="button" class="dc-tool-btn" @click="addStickyNote">
          📝 + 导演便签
        </button>
        <button type="button" class="dc-tool-btn" @click="createBlankShot">
          ➕ + 新增镜头
        </button>
        <button
          type="button"
          class="dc-tool-btn"
          :disabled="!storyboards.length || batchingKeyframes"
          @click="emit('batchFirstFrames')"
          title="为所有尚未设置首帧的分镜批量生成 AI 首帧定格图"
        >
          <Loader2 v-if="batchingKeyframes" :size="12" class="animate-spin" />
          ✨ 批量补齐首帧
        </button>
        <button
          type="button"
          class="dc-tool-btn is-animatic"
          :disabled="!storyboards.length"
          @click="openAnimatic(0)"
          title="无需等视频全部出完：混合播放已出视频 + 首尾关键帧动态预演全片节奏"
        >
          ▶ 动态故事板预演 (Animatic)
        </button>
      </div>

      <div class="dc-toolbar-group dc-zoom-bar">
        <span class="dc-cap-pill" :title="capability.shortHint">
          🎯 {{ capability.label }}
        </span>
        <button type="button" class="dc-icon-btn" @click="zoomBy(-0.15)" title="缩小">−</button>
        <button type="button" class="dc-zoom-readout" @click="resetZoom" title="重置 100%">
          {{ Math.round(viewport.zoom * 100) }}%
        </button>
        <button type="button" class="dc-icon-btn" @click="zoomBy(0.15)" title="放大">+</button>
        <button type="button" class="dc-tool-btn" @click="fitToScreen" title="适应画布视野">
          适应视野
        </button>
      </div>
    </div>

    <!-- Capability resolution warning banner if applicable -->
    <div v-if="capability.resolutionWarning" class="dc-warning-pill">
      ⚠️ {{ capability.resolutionWarning }}
    </div>

    <!-- Collapsible Floating Asset Shelf (Drag & Drop onto Shot Cards) -->
    <aside v-if="showAssetShelf" class="dc-asset-shelf" @pointerdown.stop @wheel.stop>
      <div class="dc-shelf-head">
        <strong>本集设定资产库</strong>
        <span class="dc-shelf-sub">拖拽到分镜卡即可绑定参考</span>
      </div>
      <div class="dc-shelf-scroll">
        <div class="dc-shelf-sec">
          <div class="dc-shelf-label">场景 ({{ scenes.length }})</div>
          <div v-if="scenes.length" class="dc-shelf-grid">
            <div
              v-for="s in scenes"
              :key="'sc-' + s.id"
              class="dc-shelf-item"
              draggable="true"
              @dragstart="onAssetDragStart($event, 'scene', s.id, s.location)"
              @click="s.image_url || s.imageUrl ? emit('previewImage', { src: mediaUrl(s.image_url || s.imageUrl), title: s.location }) : undefined"
            >
              <img v-if="s.image_url || s.imageUrl" :src="mediaUrl(s.image_url || s.imageUrl)" :alt="s.location" />
              <div v-else class="dc-shelf-placeholder">景</div>
              <span>{{ s.location }}</span>
            </div>
          </div>
          <div v-else class="dc-shelf-empty">暂无场景</div>
        </div>

        <div class="dc-shelf-sec">
          <div class="dc-shelf-label">角色 ({{ characters.length }})</div>
          <div v-if="characters.length" class="dc-shelf-grid">
            <div
              v-for="c in characters"
              :key="'ch-' + c.id"
              class="dc-shelf-item"
              draggable="true"
              @dragstart="onAssetDragStart($event, 'character', c.id, c.name)"
              @click="c.image_url || c.imageUrl ? emit('previewImage', { src: mediaUrl(c.image_url || c.imageUrl), title: c.name }) : undefined"
            >
              <img v-if="c.image_url || c.imageUrl" :src="mediaUrl(c.image_url || c.imageUrl)" :alt="c.name" />
              <div v-else class="dc-shelf-placeholder">人</div>
              <span>{{ c.name }}</span>
            </div>
          </div>
          <div v-else class="dc-shelf-empty">暂无角色</div>
        </div>

        <div v-if="propsList.length" class="dc-shelf-sec">
          <div class="dc-shelf-label">道具 ({{ propsList.length }})</div>
          <div class="dc-shelf-grid">
            <div
              v-for="p in propsList"
              :key="'pr-' + p.id"
              class="dc-shelf-item"
              draggable="true"
              @dragstart="onAssetDragStart($event, 'prop', p.id, p.name)"
              @click="p.image_url || p.imageUrl ? emit('previewImage', { src: mediaUrl(p.image_url || p.imageUrl), title: p.name }) : undefined"
            >
              <img v-if="p.image_url || p.imageUrl" :src="mediaUrl(p.image_url || p.imageUrl)" :alt="p.name" />
              <div v-else class="dc-shelf-placeholder">物</div>
              <span>{{ p.name }}</span>
            </div>
          </div>
        </div>
      </div>
    </aside>

    <!-- Infinite Pan/Zoom Viewport -->
    <div
      ref="stageRef"
      class="dc-viewport"
      :class="{ 'is-panning': isPanning, 'is-wiring': !!wiringState }"
      :style="gridBackgroundStyle"
      @pointerdown="onStagePointerDown"
      @wheel.prevent="onStageWheel"
    >
      <div class="dc-world" :style="worldTransformStyle">
        <!-- SVG Connection Layer -->
        <svg class="dc-wires-svg" overflow="visible">
          <defs>
            <marker id="dc-arrow-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="rgba(148, 163, 184, 0.55)" />
            </marker>
            <marker id="dc-arrow-relay" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#f97316" />
            </marker>
          </defs>

          <!-- Default story sequence dashed curves -->
          <path
            v-for="edge in sequenceEdges"
            :key="edge.id"
            :d="edge.d"
            class="dc-seq-wire"
            marker-end="url(#dc-arrow-muted)"
          />

          <!-- Explicit Continuity Relay Wires -->
          <g v-for="conn in renderedConnections" :key="conn.id" class="dc-relay-group">
            <path :d="conn.d" class="dc-relay-wire-hit" @click.stop="removeConnection(conn.id)" />
            <path :d="conn.d" class="dc-relay-wire" marker-end="url(#dc-arrow-relay)" />
            <g
              :transform="`translate(${conn.midX}, ${conn.midY})`"
              class="dc-wire-badge"
              @click.stop="triggerWireRelay(conn)"
            >
              <rect x="-46" y="-11" width="92" height="22" rx="11" />
              <text x="0" y="4" text-anchor="middle">⚡ 尾帧接力同步</text>
            </g>
          </g>

          <!-- Live dragging wire -->
          <path
            v-if="wiringPreviewPath"
            :d="wiringPreviewPath"
            class="dc-live-wire"
            marker-end="url(#dc-arrow-relay)"
          />
        </svg>

        <!-- Scene Lane Headers (when in lanes mode) -->
        <div
          v-for="lane in laneBanners"
          :key="lane.id"
          class="dc-lane-banner"
          :style="{ transform: `translate(${lane.x}px, ${lane.y}px)` }"
        >
          <span class="dc-lane-dot" />
          <strong>{{ lane.title }}</strong>
          <span class="dc-lane-count">{{ lane.count }} 镜</span>
        </div>

        <!-- Director Sticky Notes -->
        <div
          v-for="note in stickyNotes"
          :key="note.id"
          class="dc-sticky"
          :class="'is-' + (note.color || 'amber')"
          :style="{ transform: `translate(${note.x}px, ${note.y}px)` }"
          @pointerdown.stop="startNodeDrag(note.id, $event)"
        >
          <div class="dc-sticky-head">
            <span>导演批注</span>
            <div class="dc-sticky-colors" @pointerdown.stop>
              <button
                v-for="c in ['amber', 'blue', 'rose', 'emerald']"
                :key="c"
                type="button"
                class="dc-sticky-dot"
                :class="['c-' + c, { on: (note.color || 'amber') === c }]"
                @click="setStickyColor(note.id, c)"
              />
              <button type="button" class="dc-sticky-del" @click="removeStickyNote(note.id)" title="删除便签">×</button>
            </div>
          </div>
          <textarea
            :value="note.text"
            class="dc-sticky-input"
            placeholder="记录场次调度、情绪转折、备选方案..."
            @pointerdown.stop
            @input="updateStickyText(note.id, ($event.target as HTMLTextAreaElement).value)"
          />
        </div>

        <!-- Storyboard Shot Cards -->
        <article
          v-for="(sb, idx) in storyboards"
          :key="sb.id"
          class="dc-shot-card"
          :class="{
            selected: selectedSbId === sb.id,
            'is-drop-hover': dropHoverSbId === sb.id,
            'has-video': !!shotVideoUrl(sb),
            'is-pending': isShotVideoPending(sb.id),
          }"
          :style="shotCardStyle(sb.id, idx)"
          @pointerdown.stop="onCardPointerDown(sb, $event)"
          @dragover.prevent="dropHoverSbId = sb.id"
          @dragleave="dropHoverSbId === sb.id && (dropHoverSbId = null)"
          @drop.prevent="onAssetDropOnShot($event, sb)"
        >
          <!-- Left Input Port (First-frame continuity target) -->
          <button
            type="button"
            class="dc-port dc-port-in"
            :class="{ 'is-ready': !!shotFirstFrame(sb) }"
            title="首帧接力输入端：从上一镜右侧橙色输出点拖线至此，即可将上一镜尾帧无缝接力为本镜首帧"
            @pointerup.stop="finishWiringToShot(sb)"
          >
            <span />
          </button>

          <!-- Right Output Port (Tail-frame / Video continuity source) -->
          <button
            type="button"
            class="dc-port dc-port-out"
            :class="{ 'is-ready': !!(shotVideoUrl(sb) || shotLastFrame(sb)) }"
            title="拖拽连线到任意下一镜左侧端口，建立「尾帧→首帧」连续接力"
            @pointerdown.stop.prevent="startWiringFromShot(sb, idx, $event)"
          >
            <span />
          </button>

          <!-- Card Header (Drag Handle) -->
          <header class="dc-card-head" @pointerdown.stop="startShotDrag(sb, idx, $event)">
            <span class="dc-shot-num">#{{ String(idx + 1).padStart(2, '0') }}</span>
            <span class="dc-shot-title" :title="sb.title || ''">{{ sb.title || `镜头 ${idx + 1}` }}</span>
            <div class="dc-shot-tags">
              <span v-if="sb.shot_type || sb.shotType" class="dc-mini-tag">{{ sb.shot_type || sb.shotType }}</span>
              <span v-if="sb.movement" class="dc-mini-tag">{{ sb.movement }}</span>
              <span class="dc-mini-tag mono">{{ sb.duration || 5 }}s</span>
            </div>
            <div class="dc-head-actions" @pointerdown.stop>
              <button
                type="button"
                class="dc-head-btn"
                title="在画布旁侧派生一个平行变体镜头（用于对比不同机位/台词/首尾帧方案）"
                @click.stop="forkVariantShot(sb, idx)"
              >
                ⎘ 变体
              </button>
              <button
                type="button"
                class="dc-head-btn"
                title="打开右侧完整分镜检查器编辑台词与 @素材 提示词"
                @click.stop="emit('openInspector', sb)"
              >
                ✎ 详情
              </button>
              <button
                type="button"
                class="dc-head-btn is-danger"
                title="删除该分镜"
                @click.stop="deleteShot(sb)"
              >
                ×
              </button>
            </div>
          </header>

          <!-- Bound Assets Bar (Drop zone + chips) -->
          <div class="dc-bound-strip" @pointerdown.stop>
            <template v-if="shotBoundChips(sb).length">
              <span
                v-for="chip in shotBoundChips(sb)"
                :key="chip.key"
                class="dc-asset-chip"
                :class="'is-' + chip.kind"
                :title="`点击移除绑定：${chip.label}`"
                @click.stop="unbindChipFromShot(sb, chip)"
              >
                <img v-if="chip.img" :src="chip.img" :alt="chip.label" />
                <em>{{ chip.prefix }}</em>
                <span>{{ chip.label }}</span>
              </span>
            </template>
            <span v-else class="dc-bound-empty">从左侧资产架拖入场景/角色，或点「详情」绑定</span>
          </div>

          <!-- 3-Slot Filmstrip: [First Frame] -> [Video] -> [Last Frame] -->
          <div class="dc-filmstrip" @pointerdown.stop>
            <!-- SLOT 1: FIRST FRAME -->
            <div class="dc-slot">
              <div class="dc-slot-top">
                <span class="dc-slot-label">① 首帧定格</span>
                <button
                  v-if="idx > 0 && canRelayFromPrev(idx)"
                  type="button"
                  class="dc-micro-link is-relay"
                  :disabled="extractingKey === `${storyboards[idx - 1].id}:next`"
                  title="抽取上一镜结尾画面作为本镜首帧，实现跨镜头动作无缝衔接"
                  @click.stop="handleRelayFromPrev(idx)"
                >
                  {{ extractingKey === `${storyboards[idx - 1].id}:next` ? '抽取中…' : '⏮ 接上镜尾' }}
                </button>
              </div>

              <div class="dc-media-box" :style="mediaAspectStyle">
                <img
                  v-if="shotFirstFrame(sb)"
                  :src="mediaUrl(shotFirstFrame(sb))"
                  class="dc-slot-img"
                  loading="lazy"
                  @click.stop="emit('previewImage', { src: mediaUrl(shotFirstFrame(sb)), title: `#${idx + 1} 首帧` })"
                />
                <div v-else-if="isKeyframePending(sb.id, 'first_frame')" class="dc-slot-placeholder is-loading">
                  <Loader2 :size="16" class="animate-spin" />
                  <span>首帧绘制中…</span>
                </div>
                <div v-else class="dc-slot-placeholder">
                  <span>未设首帧</span>
                  <small>{{ capability.mode === 'first_only' ? '生视频时自动合成' : '建议先锁首帧' }}</small>
                </div>

                <button
                  v-if="shotFirstFrame(sb)"
                  type="button"
                  class="dc-clear-badge"
                  title="清空首帧"
                  @click.stop="emit('clearKeyframe', { storyboard: sb, slot: 'first_frame' })"
                >
                  ×
                </button>
              </div>

              <div class="dc-slot-actions">
                <button
                  type="button"
                  class="dc-mini-btn is-accent"
                  :disabled="isKeyframePending(sb.id, 'first_frame')"
                  @click.stop="emit('generateKeyframe', { storyboard: sb, slot: 'first_frame' })"
                >
                  ✨ AI首帧
                </button>
                <button
                  type="button"
                  class="dc-mini-btn"
                  title="场景+立绘自由摆位拼贴并精绘为首帧"
                  @click.stop="emit('openCollage', { storyboard: sb, shotNumber: idx + 1, slot: 'first_frame' })"
                >
                  🎨 拼贴
                </button>
                <button
                  type="button"
                  class="dc-mini-btn"
                  title="上传本地图片作为首帧"
                  @click.stop="emit('uploadKeyframe', { storyboard: sb, slot: 'first_frame' })"
                >
                  ↑
                </button>
              </div>
            </div>

            <!-- SLOT 2: CENTER VIDEO -->
            <div class="dc-slot dc-slot-video">
              <div class="dc-slot-top">
                <span class="dc-slot-label">② 镜头成片</span>
                <span v-if="shotVideoTakes(sb.id).length > 1" class="dc-takes-pill" @click.stop="cycleShotTake(sb)">
                  🎞 {{ shotVideoTakes(sb.id).length }}版候选 ↻
                </span>
                <span v-else class="dc-drive-badge" :class="{ active: hasAnyKeyframe(sb) }">
                  {{ videoDriveBadgeText(sb) }}
                </span>
              </div>

              <div class="dc-media-box is-video-box" :style="mediaAspectStyle">
                <video
                  v-if="shotVideoUrl(sb)"
                  :key="shotVideoUrl(sb)"
                  :src="mediaUrl(shotVideoUrl(sb))"
                  class="dc-slot-video-el"
                  controls
                  playsinline
                  preload="metadata"
                />
                <div v-else-if="isShotVideoPending(sb.id)" class="dc-slot-placeholder is-loading">
                  <Loader2 :size="18" class="animate-spin" />
                  <span>视频渲染中…</span>
                </div>
                <div v-else-if="failedVideoMessages[sb.id]" class="dc-slot-placeholder is-error" :title="failedVideoMessages[sb.id]">
                  <span>生成失败</span>
                  <small>{{ failedVideoMessages[sb.id].slice(0, 36) }}</small>
                </div>
                <div v-else class="dc-slot-placeholder">
                  <span>待生成视频</span>
                  <small>{{ hasAnyKeyframe(sb) ? '已就绪：按关键帧驱动' : '可先锁首尾帧或直接出片' }}</small>
                </div>
              </div>

              <div class="dc-slot-actions">
                <button
                  v-if="isShotVideoPending(sb.id)"
                  type="button"
                  class="dc-mini-btn is-danger-solid"
                  @click.stop="emit('stopVideo', sb)"
                >
                  ■ 停止生成
                </button>
                <button
                  v-else
                  type="button"
                  class="dc-mini-btn is-primary-solid"
                  @click.stop="emit('generateVideo', sb)"
                >
                  🎬 {{ shotVideoUrl(sb) ? '重出视频' : (hasAnyKeyframe(sb) ? '按关键帧生视频' : '生成视频') }}
                </button>
                <button
                  v-if="shotVideoUrl(sb) && idx < storyboards.length - 1"
                  type="button"
                  class="dc-mini-btn"
                  :disabled="extractingKey === `${sb.id}:next`"
                  title="从当前已生成视频提取最后一帧，直接设为下一镜的首帧"
                  @click.stop="handleRelayToNext(sb, storyboards[idx + 1])"
                >
                  ⚡ 传下镜
                </button>
              </div>
            </div>

            <!-- SLOT 3: LAST FRAME -->
            <div class="dc-slot" :class="{ 'is-muted-slot': !capability.supportsLast && capability.mode === 'first_only' }">
              <div class="dc-slot-top">
                <span class="dc-slot-label">③ 尾帧落幅</span>
                <button
                  v-if="shotVideoUrl(sb)"
                  type="button"
                  class="dc-micro-link"
                  :disabled="extractingKey === `${sb.id}:self`"
                  title="从本镜已出视频抽取最后一帧定格存档"
                  @click.stop="handleExtractSelfLast(sb)"
                >
                  {{ extractingKey === `${sb.id}:self` ? '抽取…' : '🎞 抽视频尾' }}
                </button>
              </div>

              <div class="dc-media-box" :style="mediaAspectStyle">
                <img
                  v-if="shotLastFrame(sb)"
                  :src="mediaUrl(shotLastFrame(sb))"
                  class="dc-slot-img"
                  loading="lazy"
                  @click.stop="emit('previewImage', { src: mediaUrl(shotLastFrame(sb)), title: `#${idx + 1} 尾帧` })"
                />
                <div v-else-if="isKeyframePending(sb.id, 'last_frame')" class="dc-slot-placeholder is-loading">
                  <Loader2 :size="16" class="animate-spin" />
                  <span>尾帧绘制中…</span>
                </div>
                <div v-else class="dc-slot-placeholder">
                  <span>未设尾帧</span>
                  <small>{{ capability.mode === 'first_only' ? '当前视频模型仅用首帧' : '可选：锁定动作终点' }}</small>
                </div>

                <button
                  v-if="shotLastFrame(sb)"
                  type="button"
                  class="dc-clear-badge"
                  title="清空尾帧"
                  @click.stop="emit('clearKeyframe', { storyboard: sb, slot: 'last_frame' })"
                >
                  ×
                </button>
              </div>

              <div class="dc-slot-actions">
                <button
                  type="button"
                  class="dc-mini-btn is-accent"
                  :disabled="isKeyframePending(sb.id, 'last_frame')"
                  title="基于首帧与剧本描述生成时空一致的动作落幅尾帧"
                  @click.stop="emit('generateKeyframe', { storyboard: sb, slot: 'last_frame' })"
                >
                  ✨ AI尾帧
                </button>
                <button
                  type="button"
                  class="dc-mini-btn"
                  title="空间拼贴构图并设为尾帧"
                  @click.stop="emit('openCollage', { storyboard: sb, shotNumber: idx + 1, slot: 'last_frame' })"
                >
                  🎨 拼贴
                </button>
                <button
                  type="button"
                  class="dc-mini-btn"
                  title="上传本地图片作为尾帧"
                  @click.stop="emit('uploadKeyframe', { storyboard: sb, slot: 'last_frame' })"
                >
                  ↑
                </button>
              </div>
            </div>
          </div>

          <!-- Prompt / Script Footer -->
          <footer class="dc-card-foot" @pointerdown.stop @dblclick.stop="emit('openInspector', sb)">
            <p class="dc-prompt-snippet" :title="sb.video_prompt || sb.videoPrompt || sb.description || ''">
              {{ sb.video_prompt || sb.videoPrompt || sb.description || '双击或点右上角「详情」编写运镜与台词提示词…' }}
            </p>
          </footer>
        </article>
      </div>
    </div>

    <!-- Bottom Canvas HUD Hint -->
    <div class="dc-hud-hint">
      <span>拖拽空白处平移 · 滚轮缩放 · 从镜头右侧橙点拖线至下一镜左点可建立「尾帧→首帧」无缝接力</span>
      <span v-if="savingCanvas" class="dc-save-status">正在保存画布布局…</span>
    </div>

    <!-- Animatic Storyboard Cinema Modal -->
    <Teleport to="body">
      <div v-if="animatic.open" class="dc-animatic-mask" @click="closeAnimatic">
        <div class="dc-animatic-box" @click.stop>
          <header class="dc-animatic-head">
            <div>
              <strong>🎞 全片动态故事板连播 (Animatic)</strong>
              <span class="dc-animatic-sub">
                镜头 #{{ String(animatic.index + 1).padStart(2, '0') }} / {{ storyboards.length }}
                · {{ currentAnimaticShot?.title || '' }}
                · {{ animaticModeLabel }}
              </span>
            </div>
            <button type="button" class="btn btn-icon btn-sm" @click="closeAnimatic">✕</button>
          </header>

          <div class="dc-animatic-stage">
            <video
              v-if="currentAnimaticVideo"
              ref="animaticVideoRef"
              :key="'av-' + currentAnimaticShot?.id"
              :src="mediaUrl(currentAnimaticVideo)"
              autoplay
              playsinline
              controls
              class="dc-animatic-video"
              @ended="advanceAnimatic"
            />
            <div v-else-if="currentAnimaticPrimaryImg" class="dc-animatic-keyframe-stage">
              <img
                :key="'af1-' + currentAnimaticShot?.id"
                :src="mediaUrl(currentAnimaticPrimaryImg)"
                class="dc-animatic-kf is-first"
                :class="{ 'fade-out': animatic.showTail && !!currentAnimaticSecondaryImg }"
              />
              <img
                v-if="currentAnimaticSecondaryImg"
                :key="'af2-' + currentAnimaticShot?.id"
                :src="mediaUrl(currentAnimaticSecondaryImg)"
                class="dc-animatic-kf is-last"
                :class="{ 'fade-in': animatic.showTail }"
              />
            </div>
            <div v-else class="dc-animatic-textcard">
              <div class="dc-animatic-shotbadge">#{{ String(animatic.index + 1).padStart(2, '0') }} · 尚未生图/生视频</div>
              <p>{{ currentAnimaticShot?.description || currentAnimaticShot?.video_prompt || '暂无画面描述' }}</p>
            </div>

            <div v-if="currentAnimaticShot" class="dc-animatic-subtitle">
              {{ currentAnimaticShot.description || currentAnimaticShot.video_prompt || currentAnimaticShot.title }}
            </div>
          </div>

          <footer class="dc-animatic-controls">
            <button type="button" class="btn btn-sm" :disabled="animatic.index <= 0" @click="jumpAnimatic(animatic.index - 1)">
              ⏮ 上一镜
            </button>
            <button type="button" class="btn btn-sm btn-primary" @click="toggleAnimaticPause">
              {{ animatic.paused ? '▶ 继续播放' : '⏸ 暂停' }}
            </button>
            <button type="button" class="btn btn-sm" :disabled="animatic.index >= storyboards.length - 1" @click="jumpAnimatic(animatic.index + 1)">
              下一镜 ⏭
            </button>
            <div class="dc-animatic-timeline">
              <button
                v-for="(s, i) in storyboards"
                :key="'at-' + s.id"
                type="button"
                class="dc-animatic-tick"
                :class="{
                  active: i === animatic.index,
                  'has-vid': !!shotVideoUrl(s),
                  'has-kf': !shotVideoUrl(s) && hasAnyKeyframe(s),
                }"
                :title="`#${i + 1} ${s.title || ''}`"
                @click="jumpAnimatic(i)"
              >
                {{ i + 1 }}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { episodeAPI, storyboardAPI } from '~/composables/useApi'
import { toastError } from '~/composables/useToast'
import { getVideoKeyframeCapability } from './keyframeCapabilities'

interface ShotNodePos {
  x: number
  y: number
}

interface StickyNoteNode {
  id: string
  kind: 'sticky'
  x: number
  y: number
  text: string
  color: string
}

interface CanvasConnection {
  id: string
  fromSbId: number
  toSbId: number
  kind: 'tail_to_first'
}

const CARD_W = 540
const CARD_H = 324
const GAP_X = 96
const GAP_Y = 74

const props = defineProps<{
  episodeId: number
  dramaId: number
  aspectRatio: string
  storyboards: any[]
  selectedSbId: number | null
  scenes: any[]
  characters: any[]
  propsList: any[]
  genTasks: any[]
  pendingVideoIds: number[]
  pendingKeyframeKeys: string[]
  batchingKeyframes?: boolean
  failedVideoMessages: Record<number, string>
  videoProvider?: string | null
  videoModel?: string | null
  videoResolution?: string | null
}>()

const emit = defineEmits<{
  (e: 'select', sb: any): void
  (e: 'openInspector', sb: any): void
  (e: 'openCollage', payload: { storyboard: any; shotNumber: number; slot: 'first_frame' | 'last_frame' | 'composed' }): void
  (e: 'generateKeyframe', payload: { storyboard: any; slot: 'first_frame' | 'last_frame' }): void
  (e: 'uploadKeyframe', payload: { storyboard: any; slot: 'first_frame' | 'last_frame' }): void
  (e: 'clearKeyframe', payload: { storyboard: any; slot: 'first_frame' | 'last_frame' }): void
  (e: 'relayTailToNext', payload: { fromStoryboard: any; toStoryboard: any }): void
  (e: 'extractSelfLastFrame', storyboard: any): void
  (e: 'generateVideo', storyboard: any): void
  (e: 'stopVideo', storyboard: any): void
  (e: 'batchFirstFrames'): void
  (e: 'previewImage', payload: { src: string; title: string }): void
  (e: 'refresh'): void
}>()

const rootRef = ref<HTMLElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)
const showAssetShelf = ref(true)
const savingCanvas = ref(false)
const extractingKey = ref('')
const dropHoverSbId = ref<number | null>(null)

const viewport = reactive({ x: 310, y: 86, zoom: 0.85 })
const shotPositions = ref<Record<string, ShotNodePos>>({})
const stickyNotes = ref<StickyNoteNode[]>([])
const connections = ref<CanvasConnection[]>([])
const laneBanners = ref<Array<{ id: string; title: string; count: number; x: number; y: number }>>([])

const isPanning = ref(false)
const wiringState = ref<{ fromSb: any; startX: number; startY: number; curX: number; curY: number } | null>(null)

const capability = computed(() =>
  getVideoKeyframeCapability(props.videoProvider, props.videoModel, props.videoResolution),
)

const readyAssetCount = computed(() =>
  props.scenes.filter(s => s.image_url || s.imageUrl).length
  + props.characters.filter(c => c.image_url || c.imageUrl).length
  + props.propsList.filter(p => p.image_url || p.imageUrl).length,
)

const mediaAspectStyle = computed(() => {
  const r = props.aspectRatio || '16:9'
  if (r === '9:16') return { aspectRatio: '9 / 13' } // slightly compact vertical so 3 slots fit comfortably
  if (r === '1:1') return { aspectRatio: '1 / 1' }
  return { aspectRatio: '16 / 10' }
})

const worldTransformStyle = computed(() => ({
  transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
  transformOrigin: '0 0',
}))

const gridBackgroundStyle = computed(() => {
  const step = Math.max(12, Math.round(24 * viewport.zoom))
  const ox = ((viewport.x % step) + step) % step
  const oy = ((viewport.y % step) + step) % step
  return {
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: `${ox}px ${oy}px`,
  }
})

function mediaUrl(raw?: string | null): string {
  if (!raw) return ''
  if (/^(https?:\/\/|data:|blob:)/i.test(raw)) return raw
  return raw.startsWith('/') ? raw : `/${raw}`
}

function shotFirstFrame(sb: any): string {
  return sb?.first_frame_image || sb?.firstFrameImage || ''
}

function shotLastFrame(sb: any): string {
  return sb?.last_frame_image || sb?.lastFrameImage || ''
}

function shotVideoUrl(sb: any): string {
  return sb?.video_url || sb?.videoUrl || ''
}

function hasAnyKeyframe(sb: any): boolean {
  return Boolean(shotFirstFrame(sb) || shotLastFrame(sb))
}

function isShotVideoPending(sbId: number): boolean {
  return props.pendingVideoIds.includes(sbId)
}

function isKeyframePending(sbId: number, slot: 'first_frame' | 'last_frame'): boolean {
  if (props.pendingKeyframeKeys.includes(`${sbId}:${slot}`)) return true
  // Also check active sys_task image records for this storyboard
  return props.genTasks.some((t) => {
    if (t.type !== 'image' || t.storyboard_id !== sbId || t.status !== 'processing') return false
    try {
      const p = typeof t.params === 'string' ? JSON.parse(t.params) : t.params
      return (p?.frameType || 'first_frame') === slot
    } catch {
      return slot === 'first_frame'
    }
  })
}

function videoDriveBadgeText(sb: any): string {
  const f = !!shotFirstFrame(sb)
  const l = !!shotLastFrame(sb)
  if (f && l && capability.value.supportsLast) return '🔒 首尾双帧锁死'
  if (f && capability.value.supportsFirst) return '🔒 首帧驱动'
  if ((f || l) && capability.value.mode === 'refs_only') return '📎 关键帧参考'
  return '素材参考'
}

function shotVideoTakes(sbId: number): any[] {
  return props.genTasks.filter(
    t => t.type === 'video' && t.storyboard_id === sbId && t.status === 'completed' && (t.video_url || t.videoUrl),
  )
}

async function cycleShotTake(sb: any) {
  const takes = shotVideoTakes(sb.id)
  if (takes.length < 2) return
  const current = shotVideoUrl(sb)
  const paths = takes
    .map(t => String(t.video_url || t.videoUrl || '').replace(/^\/+/, ''))
    .filter(p => p.startsWith('static/'))
  if (paths.length < 2) return
  const idx = paths.indexOf(current.replace(/^\/+/, ''))
  const nextPath = paths[(idx + 1) % paths.length]
  try {
    await storyboardAPI.update(sb.id, { video_url: nextPath })
    toast.success(`已切换候选版本 (${((idx + 1) % paths.length) + 1}/${paths.length})`)
    emit('refresh')
  } catch (err) {
    toastError(err)
  }
}

// ===== Layout & Persistence =====
function defaultPosForIndex(idx: number): ShotNodePos {
  return {
    x: idx * (CARD_W + GAP_X),
    y: 0,
  }
}

function getShotPos(sbId: number, idx: number): ShotNodePos {
  const key = `sb:${sbId}`
  if (!shotPositions.value[key]) {
    shotPositions.value[key] = defaultPosForIndex(idx)
  }
  return shotPositions.value[key]
}

function shotCardStyle(sbId: number, idx: number) {
  const p = getShotPos(sbId, idx)
  return {
    width: `${CARD_W}px`,
    transform: `translate(${p.x}px, ${p.y}px)`,
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSaveCanvas() {
  if (!props.episodeId) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    savingCanvas.value = true
    try {
      const nodesPayload: Record<string, any> = { ...shotPositions.value }
      for (const note of stickyNotes.value) {
        nodesPayload[note.id] = note
      }
      await episodeAPI.saveCanvas(props.episodeId, {
        viewport: { x: Math.round(viewport.x), y: Math.round(viewport.y), zoom: Number(viewport.zoom.toFixed(3)) },
        nodes: nodesPayload,
        connections: connections.value,
      })
    } catch {
      // Non-blocking layout persistence
    } finally {
      savingCanvas.value = false
    }
  }, 650)
}

async function loadCanvasState() {
  if (!props.episodeId) return
  try {
    const res = await episodeAPI.getCanvas(props.episodeId)
    if (res?.viewport && typeof res.viewport.zoom === 'number') {
      viewport.x = Number(res.viewport.x ?? 310)
      viewport.y = Number(res.viewport.y ?? 86)
      viewport.zoom = Math.min(1.8, Math.max(0.35, Number(res.viewport.zoom || 0.85)))
    }
    const posMap: Record<string, ShotNodePos> = {}
    const notes: StickyNoteNode[] = []
    if (res?.nodes && typeof res.nodes === 'object') {
      for (const [k, val] of Object.entries(res.nodes)) {
        if (!val || typeof val !== 'object') continue
        if ((val as any).kind === 'sticky') {
          notes.push(val as StickyNoteNode)
        } else if (typeof (val as any).x === 'number' && typeof (val as any).y === 'number') {
          posMap[k] = { x: (val as any).x, y: (val as any).y }
        }
      }
    }
    shotPositions.value = posMap
    stickyNotes.value = notes
    connections.value = Array.isArray(res?.connections) ? res.connections : []
    ensureShotPositionsInitialized()
  } catch {
    ensureShotPositionsInitialized()
  }
}

function ensureShotPositionsInitialized() {
  props.storyboards.forEach((sb, idx) => {
    const key = `sb:${sb.id}`
    if (!shotPositions.value[key]) {
      shotPositions.value[key] = defaultPosForIndex(idx)
    }
  })
}

function applyAutoLayout(mode: 'timeline' | 'lanes' | 'matrix') {
  const nextPos: Record<string, ShotNodePos> = {}
  laneBanners.value = []

  if (mode === 'timeline') {
    props.storyboards.forEach((sb, idx) => {
      nextPos[`sb:${sb.id}`] = { x: idx * (CARD_W + GAP_X), y: 40 }
    })
  } else if (mode === 'matrix') {
    const cols = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(props.storyboards.length))))
    props.storyboards.forEach((sb, idx) => {
      const col = idx % cols
      const row = Math.floor(idx / cols)
      nextPos[`sb:${sb.id}`] = {
        x: col * (CARD_W + GAP_X),
        y: row * (CARD_H + GAP_Y),
      }
    })
  } else if (mode === 'lanes') {
    const groups = new Map<string, { title: string; list: any[] }>()
    for (const sb of props.storyboards) {
      const scId = sb.scene_id ?? sb.sceneId
      const sc = props.scenes.find(s => s.id === scId)
      const key = sc ? `sc-${sc.id}` : (sb.location ? `loc-${sb.location}` : 'unassigned')
      const title = sc ? `场景：${sc.location}${sc.time ? ` · ${sc.time}` : ''}` : (sb.location ? `场景：${sb.location}` : '未归属场景镜头')
      if (!groups.has(key)) groups.set(key, { title, list: [] })
      groups.get(key)!.list.push(sb)
    }
    let rowIdx = 0
    for (const [gid, g] of groups.entries()) {
      const y = rowIdx * (CARD_H + 110) + 52
      laneBanners.value.push({ id: gid, title: g.title, count: g.list.length, x: 0, y: y - 40 })
      g.list.forEach((sb, colIdx) => {
        nextPos[`sb:${sb.id}`] = { x: colIdx * (CARD_W + GAP_X), y }
      })
      rowIdx++
    }
  }

  shotPositions.value = nextPos
  fitToScreen()
  scheduleSaveCanvas()
}

function zoomBy(delta: number) {
  const stage = stageRef.value
  const cx = stage ? stage.clientWidth / 2 : 600
  const cy = stage ? stage.clientHeight / 2 : 400
  zoomAroundPoint(viewport.zoom + delta, cx, cy)
}

function resetZoom() {
  viewport.zoom = 0.85
  scheduleSaveCanvas()
}

function zoomAroundPoint(targetZoom: number, clientXInStage: number, clientYInStage: number) {
  const clamped = Math.min(1.8, Math.max(0.32, targetZoom))
  const worldX = (clientXInStage - viewport.x) / viewport.zoom
  const worldY = (clientYInStage - viewport.y) / viewport.zoom
  viewport.zoom = clamped
  viewport.x = clientXInStage - worldX * clamped
  viewport.y = clientYInStage - worldY * clamped
  scheduleSaveCanvas()
}

function fitToScreen() {
  const stage = stageRef.value
  if (!stage || !props.storyboards.length) return
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  props.storyboards.forEach((sb, idx) => {
    const p = getShotPos(sb.id, idx)
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + CARD_W)
    maxY = Math.max(maxY, p.y + CARD_H)
  })
  const shelfOffset = showAssetShelf.value ? 250 : 32
  const availW = Math.max(320, stage.clientWidth - shelfOffset - 56)
  const availH = Math.max(260, stage.clientHeight - 120)
  const contentW = Math.max(CARD_W, maxX - minX)
  const contentH = Math.max(CARD_H, maxY - minY)
  const z = Math.min(1.0, Math.max(0.35, Math.min(availW / contentW, availH / contentH)))
  viewport.zoom = z
  viewport.x = shelfOffset + Math.round((availW - contentW * z) / 2 - minX * z)
  viewport.y = 66 + Math.round((availH - contentH * z) / 2 - minY * z)
  scheduleSaveCanvas()
}

// ===== Panning & Dragging =====
function onStageWheel(e: WheelEvent) {
  const stage = stageRef.value
  if (!stage) return
  const rect = stage.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const factor = e.deltaY < 0 ? 1.09 : 0.91
  zoomAroundPoint(viewport.zoom * factor, mx, my)
}

function onStagePointerDown(e: PointerEvent) {
  if (e.button !== 0 && e.button !== 1) return
  isPanning.value = true
  const startX = e.clientX
  const startY = e.clientY
  const origX = viewport.x
  const origY = viewport.y

  const onMove = (ev: PointerEvent) => {
    viewport.x = origX + (ev.clientX - startX)
    viewport.y = origY + (ev.clientY - startY)
  }
  const onUp = () => {
    isPanning.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    scheduleSaveCanvas()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function onCardPointerDown(sb: any, _e: PointerEvent) {
  emit('select', sb)
}

function startShotDrag(sb: any, idx: number, e: PointerEvent) {
  if (e.button !== 0) return
  emit('select', sb)
  const pos = getShotPos(sb.id, idx)
  const startX = e.clientX
  const startY = e.clientY
  const origX = pos.x
  const origY = pos.y

  const onMove = (ev: PointerEvent) => {
    shotPositions.value[`sb:${sb.id}`] = {
      x: Math.round(origX + (ev.clientX - startX) / viewport.zoom),
      y: Math.round(origY + (ev.clientY - startY) / viewport.zoom),
    }
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    scheduleSaveCanvas()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function startNodeDrag(noteId: string, e: PointerEvent) {
  if (e.button !== 0) return
  const note = stickyNotes.value.find(n => n.id === noteId)
  if (!note) return
  const startX = e.clientX
  const startY = e.clientY
  const origX = note.x
  const origY = note.y
  const onMove = (ev: PointerEvent) => {
    note.x = Math.round(origX + (ev.clientX - startX) / viewport.zoom)
    note.y = Math.round(origY + (ev.clientY - startY) / viewport.zoom)
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    scheduleSaveCanvas()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

// ===== Bezier Wires & Continuity Relay =====
function bezierCurve(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(70, Math.abs(x2 - x1) * 0.45)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

const sequenceEdges = computed(() => {
  const edges: Array<{ id: string; d: string }> = []
  for (let i = 0; i < props.storyboards.length - 1; i++) {
    const a = props.storyboards[i]
    const b = props.storyboards[i + 1]
    // Hide default dashed wire if an explicit relay connection already exists between them
    if (connections.value.some(c => c.fromSbId === a.id && c.toSbId === b.id)) continue
    const pa = getShotPos(a.id, i)
    const pb = getShotPos(b.id, i + 1)
    edges.push({
      id: `seq-${a.id}-${b.id}`,
      d: bezierCurve(pa.x + CARD_W, pa.y + CARD_H * 0.52, pb.x, pb.y + CARD_H * 0.52),
    })
  }
  return edges
})

const renderedConnections = computed(() => {
  const list: Array<CanvasConnection & { d: string; midX: number; midY: number }> = []
  for (const conn of connections.value) {
    const idxA = props.storyboards.findIndex(s => s.id === conn.fromSbId)
    const idxB = props.storyboards.findIndex(s => s.id === conn.toSbId)
    if (idxA === -1 || idxB === -1) continue
    const pa = getShotPos(conn.fromSbId, idxA)
    const pb = getShotPos(conn.toSbId, idxB)
    const x1 = pa.x + CARD_W
    const y1 = pa.y + CARD_H * 0.52
    const x2 = pb.x
    const y2 = pb.y + CARD_H * 0.52
    list.push({
      ...conn,
      d: bezierCurve(x1, y1, x2, y2),
      midX: Math.round((x1 + x2) / 2),
      midY: Math.round((y1 + y2) / 2),
    })
  }
  return list
})

const wiringPreviewPath = computed(() => {
  if (!wiringState.value) return ''
  const { startX, startY, curX, curY } = wiringState.value
  return bezierCurve(startX, startY, curX, curY)
})

function startWiringFromShot(sb: any, idx: number, e: PointerEvent) {
  const stage = stageRef.value
  if (!stage) return
  const pos = getShotPos(sb.id, idx)
  const sx = pos.x + CARD_W
  const sy = pos.y + CARD_H * 0.52
  wiringState.value = { fromSb: sb, startX: sx, startY: sy, curX: sx + 40, curY: sy }

  const onMove = (ev: PointerEvent) => {
    if (!wiringState.value || !stageRef.value) return
    const rect = stageRef.value.getBoundingClientRect()
    wiringState.value.curX = (ev.clientX - rect.left - viewport.x) / viewport.zoom
    wiringState.value.curY = (ev.clientY - rect.top - viewport.y) / viewport.zoom
  }
  const onUp = () => {
    setTimeout(() => { wiringState.value = null }, 30)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

function finishWiringToShot(targetSb: any) {
  if (!wiringState.value) return
  const fromSb = wiringState.value.fromSb
  wiringState.value = null
  if (!fromSb || fromSb.id === targetSb.id) return
  const exists = connections.value.some(c => c.fromSbId === fromSb.id && c.toSbId === targetSb.id)
  if (!exists) {
    connections.value.push({
      id: `relay-${fromSb.id}-${targetSb.id}`,
      fromSbId: fromSb.id,
      toSbId: targetSb.id,
      kind: 'tail_to_first',
    })
    scheduleSaveCanvas()
  }
  handleRelayToNext(fromSb, targetSb)
}

function removeConnection(id: string) {
  connections.value = connections.value.filter(c => c.id !== id)
  scheduleSaveCanvas()
  toast.success('已移除尾帧接力连线')
}

function triggerWireRelay(conn: CanvasConnection) {
  const fromSb = props.storyboards.find(s => s.id === conn.fromSbId)
  const toSb = props.storyboards.find(s => s.id === conn.toSbId)
  if (fromSb && toSb) handleRelayToNext(fromSb, toSb)
}

function canRelayFromPrev(idx: number): boolean {
  if (idx <= 0) return false
  const prev = props.storyboards[idx - 1]
  return Boolean(shotVideoUrl(prev) || shotLastFrame(prev) || shotFirstFrame(prev))
}

async function handleRelayFromPrev(idx: number) {
  const prev = props.storyboards[idx - 1]
  const cur = props.storyboards[idx]
  if (!prev || !cur) return
  await handleRelayToNext(prev, cur)
}

async function handleRelayToNext(fromSb: any, toSb: any) {
  extractingKey.value = `${fromSb.id}:next`
  try {
    emit('relayTailToNext', { fromStoryboard: fromSb, toStoryboard: toSb })
    // Ensure visual relay wire is shown on canvas
    if (!connections.value.some(c => c.fromSbId === fromSb.id && c.toSbId === toSb.id)) {
      connections.value.push({
        id: `relay-${fromSb.id}-${toSb.id}`,
        fromSbId: fromSb.id,
        toSbId: toSb.id,
        kind: 'tail_to_first',
      })
      scheduleSaveCanvas()
    }
  } finally {
    setTimeout(() => { extractingKey.value = '' }, 600)
  }
}

async function handleExtractSelfLast(sb: any) {
  extractingKey.value = `${sb.id}:self`
  try {
    emit('extractSelfLastFrame', sb)
  } finally {
    setTimeout(() => { extractingKey.value = '' }, 600)
  }
}

// ===== Bound Assets Drag & Drop =====
function shotBoundChips(sb: any) {
  const chips: Array<{ key: string; kind: 'scene' | 'character' | 'prop'; id: number; prefix: string; label: string; img: string }> = []
  const scId = sb.scene_id ?? sb.sceneId
  if (scId) {
    const sc = props.scenes.find(s => s.id === scId)
    if (sc) {
      chips.push({
        key: `sc-${sc.id}`,
        kind: 'scene',
        id: sc.id,
        prefix: '景',
        label: sc.location,
        img: mediaUrl(sc.image_url || sc.imageUrl),
      })
    }
  }
  const cIds: number[] = sb.character_ids || sb.characters?.map((c: any) => c.id) || []
  for (const cid of cIds) {
    const ch = props.characters.find(c => c.id === cid)
    if (ch) {
      chips.push({
        key: `ch-${ch.id}`,
        kind: 'character',
        id: ch.id,
        prefix: '人',
        label: ch.name,
        img: mediaUrl(ch.image_url || ch.imageUrl),
      })
    }
  }
  const pIds: number[] = sb.prop_ids || sb.props?.map((p: any) => p.id) || []
  for (const pid of pIds) {
    const pr = props.propsList.find(p => p.id === pid)
    if (pr) {
      chips.push({
        key: `pr-${pr.id}`,
        kind: 'prop',
        id: pr.id,
        prefix: '物',
        label: pr.name,
        img: mediaUrl(pr.image_url || pr.imageUrl),
      })
    }
  }
  return chips
}

function onAssetDragStart(e: DragEvent, kind: 'scene' | 'character' | 'prop', id: number, label: string) {
  e.dataTransfer?.setData('application/x-huobao-asset', JSON.stringify({ kind, id, label }))
}

async function onAssetDropOnShot(e: DragEvent, sb: any) {
  dropHoverSbId.value = null
  const raw = e.dataTransfer?.getData('application/x-huobao-asset')
  if (!raw) return
  try {
    const { kind, id, label } = JSON.parse(raw)
    if (kind === 'scene') {
      await storyboardAPI.update(sb.id, { scene_id: id })
    } else if (kind === 'character') {
      const cur: number[] = [...(sb.character_ids || sb.characters?.map((c: any) => c.id) || [])]
      if (!cur.includes(id)) cur.push(id)
      await storyboardAPI.update(sb.id, { character_ids: cur })
    } else if (kind === 'prop') {
      const cur: number[] = [...(sb.prop_ids || sb.props?.map((p: any) => p.id) || [])]
      if (!cur.includes(id)) cur.push(id)
      await storyboardAPI.update(sb.id, { prop_ids: cur })
    }
    toast.success(`已将「${label}」绑定到分镜`)
    emit('refresh')
  } catch (err) {
    toastError(err)
  }
}

async function unbindChipFromShot(sb: any, chip: { kind: string; id: number; label: string }) {
  try {
    if (chip.kind === 'scene') {
      await storyboardAPI.update(sb.id, { scene_id: null })
    } else if (chip.kind === 'character') {
      const cur: number[] = (sb.character_ids || sb.characters?.map((c: any) => c.id) || []).filter((x: number) => x !== chip.id)
      await storyboardAPI.update(sb.id, { character_ids: cur })
    } else if (chip.kind === 'prop') {
      const cur: number[] = (sb.prop_ids || sb.props?.map((p: any) => p.id) || []).filter((x: number) => x !== chip.id)
      await storyboardAPI.update(sb.id, { prop_ids: cur })
    }
    emit('refresh')
  } catch (err) {
    toastError(err)
  }
}

// ===== Shot Creation, Variant Forking & Sticky Notes =====
async function createBlankShot() {
  try {
    const nextNum = props.storyboards.length + 1
    const lastSb = props.storyboards[props.storyboards.length - 1]
    const lastPos = lastSb ? getShotPos(lastSb.id, props.storyboards.length - 1) : { x: -CARD_W - GAP_X, y: 40 }
    const created = await storyboardAPI.create({
      episode_id: props.episodeId,
      storyboard_number: nextNum,
      title: `新增镜头 ${nextNum}`,
      shot_type: '中景',
      movement: '固定',
      duration: props.videoProvider === 'comfyui' ? 5 : 6,
      description: '',
    })
    if (created?.id) {
      shotPositions.value[`sb:${created.id}`] = { x: lastPos.x + CARD_W + GAP_X, y: lastPos.y }
      scheduleSaveCanvas()
    }
    toast.success('已在画布末尾新增分镜卡')
    emit('refresh')
  } catch (err) {
    toastError(err)
  }
}

async function forkVariantShot(sb: any, idx: number) {
  try {
    const basePos = getShotPos(sb.id, idx)
    const created = await storyboardAPI.create({
      episode_id: props.episodeId,
      storyboard_number: (sb.storyboard_number || idx + 1) + 1,
      title: `${sb.title || `镜头 ${idx + 1}`} (平行变体)`,
      shot_type: sb.shot_type || sb.shotType || null,
      angle: sb.angle || null,
      movement: sb.movement || null,
      location: sb.location || null,
      time: sb.time || null,
      atmosphere: sb.atmosphere || null,
      description: sb.description || null,
      video_prompt: sb.video_prompt || sb.videoPrompt || null,
      image_prompt: sb.image_prompt || sb.imagePrompt || null,
      first_frame_image: shotFirstFrame(sb) || null,
      last_frame_image: shotLastFrame(sb) || null,
      composed_image: sb.composed_image || sb.composedImage || null,
      scene_id: sb.scene_id ?? sb.sceneId ?? null,
      duration: sb.duration || 5,
      character_ids: sb.character_ids || sb.characters?.map((c: any) => c.id) || [],
      prop_ids: sb.prop_ids || sb.props?.map((p: any) => p.id) || [],
    })
    if (created?.id) {
      shotPositions.value[`sb:${created.id}`] = { x: basePos.x + 48, y: basePos.y + CARD_H + 56 }
      scheduleSaveCanvas()
    }
    toast.success('已在下方派生平行变体镜头，可自由尝试不同机位或首尾帧')
    emit('refresh')
  } catch (err) {
    toastError(err)
  }
}

async function deleteShot(sb: any) {
  if (!window.confirm(`确定删除分镜「${sb.title || sb.id}」吗？`)) return
  try {
    await storyboardAPI.del(sb.id)
    delete shotPositions.value[`sb:${sb.id}`]
    connections.value = connections.value.filter(c => c.fromSbId !== sb.id && c.toSbId !== sb.id)
    scheduleSaveCanvas()
    toast.success('分镜已删除')
    emit('refresh')
  } catch (err) {
    toastError(err)
  }
}

function addStickyNote() {
  const stage = stageRef.value
  const cx = stage ? (stage.clientWidth / 2 - viewport.x) / viewport.zoom : 200
  const cy = stage ? (stage.clientHeight / 2 - viewport.y) / viewport.zoom : 120
  stickyNotes.value.push({
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    kind: 'sticky',
    x: Math.round(cx - 120),
    y: Math.round(cy - 80),
    text: '',
    color: 'amber',
  })
  scheduleSaveCanvas()
}

function updateStickyText(id: string, text: string) {
  const n = stickyNotes.value.find(item => item.id === id)
  if (n) {
    n.text = text
    scheduleSaveCanvas()
  }
}

function setStickyColor(id: string, color: string) {
  const n = stickyNotes.value.find(item => item.id === id)
  if (n) {
    n.color = color
    scheduleSaveCanvas()
  }
}

function removeStickyNote(id: string) {
  stickyNotes.value = stickyNotes.value.filter(n => n.id !== id)
  scheduleSaveCanvas()
}

// ===== Animatic Storyboard Cinema Player =====
const animaticVideoRef = ref<HTMLVideoElement | null>(null)
const animatic = reactive({
  open: false,
  index: 0,
  paused: false,
  showTail: false,
})
let animaticTimer: ReturnType<typeof setTimeout> | null = null
let animaticCrossfadeTimer: ReturnType<typeof setTimeout> | null = null

const currentAnimaticShot = computed(() => props.storyboards[animatic.index] || null)
const currentAnimaticVideo = computed(() => (currentAnimaticShot.value ? shotVideoUrl(currentAnimaticShot.value) : ''))
const currentAnimaticPrimaryImg = computed(() => {
  const sb = currentAnimaticShot.value
  if (!sb) return ''
  return shotFirstFrame(sb) || sb.composed_image || sb.composedImage || shotLastFrame(sb) || ''
})
const currentAnimaticSecondaryImg = computed(() => {
  const sb = currentAnimaticShot.value
  if (!sb) return ''
  const last = shotLastFrame(sb)
  return last && last !== currentAnimaticPrimaryImg.value ? last : ''
})
const animaticModeLabel = computed(() => {
  if (currentAnimaticVideo.value) return '成片视频实播'
  if (currentAnimaticPrimaryImg.value && currentAnimaticSecondaryImg.value) return '首帧 → 尾帧动态叠化预演'
  if (currentAnimaticPrimaryImg.value) return '关键帧运镜预演'
  return '文字分镜卡占桩'
})

function clearAnimaticTimers() {
  if (animaticTimer) { clearTimeout(animaticTimer); animaticTimer = null }
  if (animaticCrossfadeTimer) { clearTimeout(animaticCrossfadeTimer); animaticCrossfadeTimer = null }
}

function scheduleAnimaticStep() {
  clearAnimaticTimers()
  animatic.showTail = false
  if (!animatic.open || animatic.paused) return
  const sb = currentAnimaticShot.value
  if (!sb) return
  // If shot has real video, <video @ended> handles advancing
  if (shotVideoUrl(sb)) return

  const durMs = Math.max(2000, Number(sb.duration || 4) * 1000)
  if (currentAnimaticSecondaryImg.value) {
    animaticCrossfadeTimer = setTimeout(() => {
      if (animatic.open && !animatic.paused) animatic.showTail = true
    }, Math.round(durMs * 0.52))
  }
  animaticTimer = setTimeout(() => {
    advanceAnimatic()
  }, durMs)
}

function openAnimatic(startIndex = 0) {
  if (!props.storyboards.length) return
  animatic.index = Math.max(0, Math.min(props.storyboards.length - 1, startIndex))
  animatic.paused = false
  animatic.open = true
  scheduleAnimaticStep()
}

function closeAnimatic() {
  animatic.open = false
  clearAnimaticTimers()
}

function jumpAnimatic(idx: number) {
  if (idx < 0 || idx >= props.storyboards.length) return
  animatic.index = idx
  animatic.paused = false
  scheduleAnimaticStep()
}

function advanceAnimatic() {
  if (animatic.index < props.storyboards.length - 1) {
    animatic.index += 1
    scheduleAnimaticStep()
  } else {
    animatic.paused = true
    clearAnimaticTimers()
  }
}

function toggleAnimaticPause() {
  animatic.paused = !animatic.paused
  const vid = animaticVideoRef.value
  if (vid) {
    if (animatic.paused) vid.pause()
    else void vid.play()
    return
  }
  if (animatic.paused) clearAnimaticTimers()
  else scheduleAnimaticStep()
}

watch(() => props.episodeId, () => {
  void loadCanvasState()
})

watch(() => props.storyboards.length, () => {
  ensureShotPositionsInitialized()
})

onMounted(() => {
  void loadCanvasState()
})

onBeforeUnmount(() => {
  clearAnimaticTimers()
  if (saveTimer) clearTimeout(saveTimer)
})
</script>

<style scoped>
.dc-root {
  position: relative;
  flex: 1;
  min-height: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 12px;
  user-select: none;
}

.dc-toolbar {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  pointer-events: none;
}

.dc-toolbar-group {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  background: color-mix(in srgb, var(--surface-raised) 92%, transparent);
  backdrop-filter: blur(10px);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  box-shadow: var(--shadow-sm);
}

.dc-sep {
  width: 1px;
  height: 16px;
  background: var(--border-strong);
  margin: 0 2px;
}

.dc-tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-1);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.14s, color 0.14s;
}
.dc-tool-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-0);
}
.dc-tool-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.dc-tool-btn.on {
  background: var(--accent-bg);
  color: var(--accent-text);
  border-color: rgba(249, 115, 22, 0.28);
  font-weight: 600;
}
.dc-tool-btn.is-animatic {
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}
.dc-tool-btn.is-animatic:hover:not(:disabled) {
  background: var(--action-primary-hover);
  color: #fff;
}

.dc-cap-pill {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--accent-bg);
  color: var(--accent-text);
}

.dc-icon-btn,
.dc-zoom-readout {
  height: 26px;
  min-width: 26px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-1);
  color: var(--text-1);
  font-size: 12px;
  cursor: pointer;
}

.dc-warning-pill {
  position: absolute;
  top: 56px;
  right: 14px;
  z-index: 29;
  padding: 6px 12px;
  border-radius: 8px;
  background: var(--warning-bg);
  color: var(--warning);
  border: 1px solid rgba(217, 119, 6, 0.3);
  font-size: 11px;
  font-weight: 500;
  max-width: 480px;
}

/* Floating Asset Shelf */
.dc-asset-shelf {
  position: absolute;
  top: 58px;
  left: 12px;
  bottom: 38px;
  width: 228px;
  z-index: 25;
  background: color-mix(in srgb, var(--surface-raised) 95%, transparent);
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dc-shelf-head {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dc-shelf-head strong {
  font-size: 12px;
  color: var(--text-0);
}
.dc-shelf-sub {
  font-size: 10.5px;
  color: var(--text-3);
}

.dc-shelf-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dc-shelf-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-2);
  margin-bottom: 6px;
}

.dc-shelf-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.dc-shelf-item {
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-1);
  padding: 4px;
  cursor: grab;
  display: flex;
  flex-direction: column;
  gap: 3px;
  transition: border-color 0.14s, transform 0.12s;
}
.dc-shelf-item:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}
.dc-shelf-item img,
.dc-shelf-placeholder {
  width: 100%;
  aspect-ratio: 16 / 10;
  object-fit: cover;
  border-radius: 4px;
  background: var(--bg-2);
}
.dc-shelf-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
}
.dc-shelf-item span {
  font-size: 10.5px;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dc-shelf-empty {
  font-size: 11px;
  color: var(--text-3);
}

/* Infinite Viewport */
.dc-viewport {
  width: 100%;
  height: 100%;
  overflow: hidden;
  cursor: grab;
  background-image: radial-gradient(circle, var(--border-strong) 1.25px, transparent 1.25px);
}
.dc-viewport.is-panning {
  cursor: grabbing;
}
.dc-viewport.is-wiring {
  cursor: crosshair;
}

.dc-world {
  position: relative;
  width: 1px;
  height: 1px;
  will-change: transform;
}

.dc-wires-svg {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  pointer-events: none;
  z-index: 2;
}

.dc-seq-wire {
  fill: none;
  stroke: rgba(148, 163, 184, 0.45);
  stroke-width: 2;
  stroke-dasharray: 6 6;
}

.dc-relay-wire {
  fill: none;
  stroke: #f97316;
  stroke-width: 3;
  filter: drop-shadow(0 2px 6px rgba(249, 115, 22, 0.35));
}

.dc-relay-wire-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 16;
  pointer-events: stroke;
  cursor: pointer;
}

.dc-wire-badge {
  pointer-events: auto;
  cursor: pointer;
}
.dc-wire-badge rect {
  fill: #fff7ed;
  stroke: #f97316;
  stroke-width: 1.5;
}
.dc-wire-badge text {
  fill: #c2410c;
  font-size: 10.5px;
  font-weight: 600;
}

.dc-live-wire {
  fill: none;
  stroke: #f97316;
  stroke-width: 2.5;
  stroke-dasharray: 5 4;
}

/* Lane Banners */
.dc-lane-banner {
  position: absolute;
  left: 0;
  top: 0;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
  border-radius: 999px;
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-xs);
  font-size: 12px;
  color: var(--text-0);
  white-space: nowrap;
}
.dc-lane-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}
.dc-lane-count {
  font-size: 11px;
  color: var(--text-3);
}

/* Sticky Notes */
.dc-sticky {
  position: absolute;
  left: 0;
  top: 0;
  width: 230px;
  min-height: 145px;
  border-radius: 10px;
  padding: 8px 10px;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 5;
  cursor: grab;
  border: 1px solid rgba(0, 0, 0, 0.08);
}
.dc-sticky.is-amber { background: #fef3c7; color: #78350f; }
.dc-sticky.is-blue { background: #dbeafe; color: #1e3a8a; }
.dc-sticky.is-rose { background: #ffe4e6; color: #881337; }
.dc-sticky.is-emerald { background: #d1fae5; color: #064e3b; }

.dc-sticky-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 700;
}
.dc-sticky-colors {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dc-sticky-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.25);
  cursor: pointer;
}
.dc-sticky-dot.c-amber { background: #f59e0b; }
.dc-sticky-dot.c-blue { background: #3b82f6; }
.dc-sticky-dot.c-rose { background: #f43f5e; }
.dc-sticky-dot.c-emerald { background: #10b981; }
.dc-sticky-dot.on { transform: scale(1.2); }
.dc-sticky-del {
  border: none;
  background: transparent;
  font-size: 14px;
  font-weight: 700;
  color: inherit;
  cursor: pointer;
  margin-left: 3px;
}
.dc-sticky-input {
  flex: 1;
  min-height: 100px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}

/* Shot Cards */
.dc-shot-card {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 4;
  background: var(--surface-raised);
  border: 1.5px solid var(--border-strong);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.dc-shot-card:hover {
  border-color: rgba(249, 115, 22, 0.55);
}
.dc-shot-card.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow), var(--shadow-lg);
  z-index: 8;
}
.dc-shot-card.is-drop-hover {
  border-color: #10b981;
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.28);
}

/* Connection Ports */
.dc-port {
  position: absolute;
  top: 52%;
  width: 18px;
  height: 18px;
  margin-top: -9px;
  border-radius: 50%;
  background: var(--surface-raised);
  border: 2px solid var(--border-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: crosshair;
  z-index: 10;
  transition: transform 0.14s, border-color 0.14s;
}
.dc-port span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-3);
}
.dc-port.is-ready {
  border-color: #f97316;
}
.dc-port.is-ready span {
  background: #f97316;
}
.dc-port:hover {
  transform: scale(1.28);
  border-color: #f97316;
}
.dc-port-in { left: -10px; }
.dc-port-out { right: -10px; }

.dc-card-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 11px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-0);
  border-radius: 13px 13px 0 0;
  cursor: grab;
}
.dc-card-head:active {
  cursor: grabbing;
}

.dc-shot-num {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--text-0);
  color: var(--bg-1);
}

.dc-shot-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 155px;
}

.dc-shot-tags {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dc-mini-tag {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-2);
  color: var(--text-2);
}

.dc-head-actions {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dc-head-btn {
  border: 1px solid var(--border);
  background: var(--bg-1);
  color: var(--text-1);
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 5px;
  cursor: pointer;
}
.dc-head-btn:hover {
  border-color: var(--accent);
  color: var(--accent-text);
}
.dc-head-btn.is-danger:hover {
  border-color: var(--error);
  color: var(--error);
}

/* Bound Assets Strip */
.dc-bound-strip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--border);
  min-height: 29px;
  overflow-x: auto;
}

.dc-asset-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px 1px 2px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  font-size: 10.5px;
  color: var(--text-1);
  cursor: pointer;
  white-space: nowrap;
}
.dc-asset-chip:hover {
  border-color: var(--error);
  text-decoration: line-through;
}
.dc-asset-chip img {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  object-fit: cover;
}
.dc-asset-chip em {
  font-style: normal;
  font-size: 9.5px;
  font-weight: 700;
  color: var(--accent-text);
}

.dc-bound-empty {
  font-size: 10.5px;
  color: var(--text-3);
}

/* 3-Slot Filmstrip */
.dc-filmstrip {
  display: grid;
  grid-template-columns: 1fr 1.18fr 1fr;
  gap: 8px;
  padding: 9px 10px;
  align-items: start;
}

.dc-slot {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.dc-slot.is-muted-slot {
  opacity: 0.78;
}

.dc-slot-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  min-height: 18px;
}

.dc-slot-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-1);
}

.dc-micro-link {
  border: none;
  background: var(--bg-2);
  color: var(--text-1);
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  cursor: pointer;
}
.dc-micro-link.is-relay {
  background: var(--accent-bg);
  color: var(--accent-text);
}
.dc-micro-link:hover:not(:disabled) {
  filter: brightness(0.95);
}

.dc-drive-badge,
.dc-takes-pill {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg-2);
  color: var(--text-2);
}
.dc-drive-badge.active {
  background: rgba(22, 163, 74, 0.12);
  color: var(--success);
  font-weight: 600;
}
.dc-takes-pill {
  background: var(--info-bg);
  color: var(--info);
  font-weight: 600;
  cursor: pointer;
}

.dc-media-box {
  position: relative;
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-2);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dc-media-box.is-video-box {
  background: #111318;
  border-color: var(--border-strong);
}

.dc-slot-img,
.dc-slot-video-el {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  cursor: pointer;
}

.dc-slot-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 8px;
  text-align: center;
  color: var(--text-3);
  font-size: 11px;
}
.dc-media-box.is-video-box .dc-slot-placeholder {
  color: rgba(255, 255, 255, 0.65);
}
.dc-slot-placeholder small {
  font-size: 9.5px;
  opacity: 0.8;
  line-height: 1.3;
}
.dc-slot-placeholder.is-loading {
  color: var(--accent-text);
}
.dc-slot-placeholder.is-error {
  color: #f87171;
}

.dc-clear-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.dc-slot-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dc-mini-btn {
  flex: 1;
  height: 24px;
  padding: 0 5px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-1);
  color: var(--text-1);
  font-size: 10.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
}
.dc-mini-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--text-0);
}
.dc-mini-btn:disabled {
  opacity: 0.48;
  cursor: not-allowed;
}
.dc-mini-btn.is-accent {
  background: var(--accent-bg);
  color: var(--accent-text);
  border-color: rgba(249, 115, 22, 0.26);
  font-weight: 600;
}
.dc-mini-btn.is-primary-solid {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
  font-weight: 600;
}
.dc-mini-btn.is-primary-solid:hover:not(:disabled) {
  background: var(--action-primary-hover);
  color: #fff;
}
.dc-mini-btn.is-danger-solid {
  background: var(--error);
  color: #fff;
  border-color: var(--error);
  font-weight: 600;
}

/* Card Footer */
.dc-card-foot {
  padding: 6px 11px 9px;
  border-top: 1px solid var(--border);
  background: var(--bg-0);
  border-radius: 0 0 13px 13px;
  cursor: pointer;
}
.dc-prompt-snippet {
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 31px;
}

/* Bottom HUD */
.dc-hud-hint {
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: 8px;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: none;
  font-size: 11px;
  color: var(--text-3);
}
.dc-save-status {
  color: var(--accent-text);
  font-weight: 500;
}

/* Animatic Cinema Modal */
.dc-animatic-mask {
  position: fixed;
  inset: 0;
  z-index: 1250;
  background: rgba(8, 10, 14, 0.84);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.dc-animatic-box {
  width: min(1080px, 95vw);
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.dc-animatic-head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.dc-animatic-head strong {
  font-size: 14px;
  color: var(--text-0);
  margin-right: 10px;
}
.dc-animatic-sub {
  font-size: 12px;
  color: var(--text-2);
}

.dc-animatic-stage {
  position: relative;
  width: 100%;
  height: min(62vh, 560px);
  background: #0b0d12;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.dc-animatic-video {
  max-width: 100%;
  max-height: 100%;
}

.dc-animatic-keyframe-stage {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dc-animatic-kf {
  position: absolute;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transition: opacity 0.85s ease, transform 4s ease-out;
  transform: scale(1.03);
}
.dc-animatic-kf.is-first.fade-out {
  opacity: 0;
}
.dc-animatic-kf.is-last {
  opacity: 0;
}
.dc-animatic-kf.is-last.fade-in {
  opacity: 1;
  transform: scale(1.0);
}

.dc-animatic-textcard {
  padding: 32px;
  max-width: 560px;
  text-align: center;
  color: rgba(255, 255, 255, 0.85);
}
.dc-animatic-shotbadge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(249, 115, 22, 0.25);
  color: #fdba74;
  font-size: 12px;
  margin-bottom: 12px;
}

.dc-animatic-subtitle {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  max-width: 82%;
  padding: 6px 16px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.68);
  color: #fff;
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
  pointer-events: none;
}

.dc-animatic-controls {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.dc-animatic-timeline {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.dc-animatic-tick {
  min-width: 26px;
  height: 24px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  color: var(--text-2);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.dc-animatic-tick.has-kf {
  border-color: rgba(249, 115, 22, 0.45);
  color: var(--accent-text);
}
.dc-animatic-tick.has-vid {
  border-color: rgba(22, 163, 74, 0.5);
  color: var(--success);
}
.dc-animatic-tick.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
</style>
