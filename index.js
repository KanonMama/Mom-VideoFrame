/**
 * Mom Video Frame — a purely local floating screen for SillyTavern.
 * No SillyTavern API access, no key access. External requests only when the user starts an embedded player (YouTube, Vimeo or direct file).
 */
const MVF_VERSION = '1.3.1';
const MVF_STORAGE_KEY = 'mom-video-frame:v1';
const MVF_MIN_W = 270;
const MVF_MIN_H = 190;
const MVF_MARGIN = 8;
const MVF_THEMES = ['dispatch', 'crt', 'vhs', 'metro', 'noir', 'tavern'];

const MVF_DEFAULTS = {
    x: null, y: 98, w: 364, h: 252,
    theme: 'dispatch', mode: 'frame',
    title: 'ЭФИР 01',
    labelVisible: true,
    frameWidth: 10,
    savedUrl: '',
    visible: true,
    enabled: true,
    locked: false,
    volume: 65, muted: false, queue: [], queueIndex: 0,
};

function mvfClamp(value, low, high) {
    return Math.min(Math.max(value, low), high);
}
function mvfLoadSettings() {
    try {
        const raw = JSON.parse(localStorage.getItem(MVF_STORAGE_KEY) || '{}');
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...MVF_DEFAULTS };
        const data = { ...MVF_DEFAULTS, ...raw };
        data.theme = MVF_THEMES.includes(data.theme) ? data.theme : 'dispatch';
        data.mode = data.mode === 'embed' ? 'embed' : 'frame';
        data.title = typeof data.title === 'string' ? data.title.slice(0, 30) : MVF_DEFAULTS.title;
        data.savedUrl = typeof data.savedUrl === 'string' ? data.savedUrl.slice(0, 2048) : '';
        data.labelVisible = data.labelVisible !== false;
        data.visible = data.visible !== false;
        data.enabled = data.enabled !== false;
        data.locked = data.locked === true;
        data.volume = mvfClamp(Number(data.volume) || 0, 0, 100);
        data.muted = data.muted === true;
        data.queue = Array.isArray(data.queue) ? data.queue.filter(u => typeof u === 'string' && u.length <= 2048 && mvfGetVideoSource(u)).slice(0, 60) : [];
        data.queueIndex = data.queue.length ? mvfClamp(Number(data.queueIndex) || 0, 0, data.queue.length - 1) : 0;
        for (const name of ['x', 'y', 'w', 'h', 'frameWidth']) {
            if (data[name] !== null && !Number.isFinite(data[name])) data[name] = MVF_DEFAULTS[name];
        }
        data.frameWidth = mvfClamp(data.frameWidth, 4, 22);
        return data;
    } catch (error) {
        console.warn('[Mom Video Frame] Could not read saved settings:', error);
        return { ...MVF_DEFAULTS };
    }
}

function mvfParseStart(value) {
    if (!value) return 0;
    if (/^\d+$/.test(value)) return Math.min(Number(value), 86400);
    const match = /^((\d+)h)?((\d+)m)?((\d+)s?)?$/.exec(value);
    if (!match) return 0;
    return Math.min((Number(match[2] || 0) * 3600) + (Number(match[4] || 0) * 60) + Number(match[6] || 0), 86400);
}

/** Only known player types / direct video files; arbitrary websites are NOT embedded. */
function mvfGetVideoSource(rawUrl) {
    let url;
    try { url = new URL(rawUrl.trim()); } catch (_) { return null; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let youtubeId = '';
    if (host === 'youtu.be') youtubeId = url.pathname.split('/')[1] || '';
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
        const path = url.pathname.split('/').filter(Boolean);
        if (path[0] === 'watch') youtubeId = url.searchParams.get('v') || '';
        if (['shorts', 'live', 'embed', 'v'].includes(path[0])) youtubeId = path[1] || '';
        const list = url.searchParams.get('list') || '';
        if (!youtubeId && /^[A-Za-z0-9_-]{10,120}$/.test(list)) {
            return { type: 'iframe', provider: 'youtube-playlist', src: `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(list)}`, name: 'YouTube плейлист' };
        }
    }
    if (/^[A-Za-z0-9_-]{11}$/.test(youtubeId)) {
        const t = mvfParseStart(url.searchParams.get('t') || url.searchParams.get('start'));
        const params = new URLSearchParams({ rel: '0', playsinline: '1' });
        if (t) params.set('start', String(t));
        return { type: 'iframe', provider: 'youtube', youtubeId, startSeconds: t, src: `https://www.youtube-nocookie.com/embed/${youtubeId}?${params.toString()}`, name: 'YouTube' };
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
        const match = url.pathname.match(/(?:^|\/)(?:video\/)?(\d+)(?:\/|$)/);
        if (match) return { type: 'iframe', provider: 'vimeo', src: `https://player.vimeo.com/video/${match[1]}`, name: 'Vimeo' };
    }
    if (/\.(mp4|webm|ogg)$/i.test(url.pathname)) {
        return { type: 'video', provider: 'file', src: url.href, name: 'Видео по ссылке' };
    }
    return null;
}

let mvfYoutubeAPI = null;
function mvfGetYouTubeAPI() {
    if (globalThis.YT?.Player) return Promise.resolve(globalThis.YT);
    if (mvfYoutubeAPI) return mvfYoutubeAPI;
    mvfYoutubeAPI = new Promise((resolve, reject) => {
        const previous = globalThis.onYouTubeIframeAPIReady;
        let settled = false;
        function finish(ok) {
            if (settled) return;
            settled = true;
            clearInterval(check);
            clearTimeout(timeout);
            if (globalThis.onYouTubeIframeAPIReady === callback) globalThis.onYouTubeIframeAPIReady = previous;
            if (ok && globalThis.YT?.Player) resolve(globalThis.YT);
            else reject(new Error('YouTube API unavailable'));
        }
        const callback = () => {
            try { if (typeof previous === 'function') previous(); }
            catch (error) { console.warn('[Mom Video Frame] Other YouTube callback:', error); }
            finish(true);
        };
        globalThis.onYouTubeIframeAPIReady = callback;
        const check = setInterval(() => { if (globalThis.YT?.Player) finish(true); }, 250);
        const timeout = setTimeout(() => finish(false), 12000);
        // Reuse the YouTube API if another extension already requested it.
        if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
            const script = document.createElement('script');
            script.src = 'https://www.youtube.com/iframe_api';
            script.async = true;
            script.onerror = () => finish(false);
            document.head.append(script);
        }
    }).catch(error => {
        console.warn('[Mom Video Frame] YouTube API not ready:', error);
        mvfYoutubeAPI = null;
        return null;
    });
    return mvfYoutubeAPI;
}

function mvfInit() {
    if (document.getElementById('mom-video-frame-root')) return;
    const host = document.createElement('div');
    host.id = 'mom-video-frame-root';
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = new URL(`./style.css?v=${MVF_VERSION}`, import.meta.url).href;
    shadow.append(stylesheet);

    const content = document.createElement('div');
    content.className = 'mvf-layer';
    content.innerHTML = `
      <section class="mvf-dock mvf-theme-dispatch" id="mvf-dock" aria-label="Mom Video Frame">
        <header class="mvf-header" id="mvf-drag" title="Тяни за панель, чтобы переместить">
          <div class="mvf-heading">
            <span class="mvf-led"></span>
            <span class="mvf-title" id="mvf-title"></span>
          </div>
          <div class="mvf-buttons">
            <button type="button" class="mvf-tool" id="mvf-toggle-mode" title="Сменить режим: рамка / плеер" aria-label="Сменить режим">▣</button>
            <button type="button" class="mvf-tool" id="mvf-prev" title="Предыдущее видео" aria-label="Предыдущее видео" hidden>⏮</button>
            <button type="button" class="mvf-tool" id="mvf-next" title="Следующее видео" aria-label="Следующее видео" hidden>⏭</button>
            <button type="button" class="mvf-tool mvf-volume-button" id="mvf-volume-open" title="Громкость" aria-label="Громкость" aria-expanded="false" hidden>♪</button>
            <button type="button" class="mvf-tool mvf-lock-button" id="mvf-lock" title="Заблокировать управление видео" aria-label="Заблокировать управление видео" aria-pressed="false" hidden>🔓</button>
            <button type="button" class="mvf-tool" id="mvf-open-settings" title="Настройки" aria-label="Настройки">⚙</button>
            <button type="button" class="mvf-tool mvf-close" id="mvf-minimize" title="Скрыть рамку" aria-label="Скрыть рамку">×</button>
          </div>
        </header>
        <div class="mvf-screen mvf-frame-mode" id="mvf-screen">
          <div class="mvf-markings" aria-hidden="true"><span>◤</span><span>◥</span><span>◣</span><span>◢</span></div>
          <div class="mvf-placeholder" id="mvf-placeholder">
            <div class="mvf-screen-symbol">▹</div>
            <div id="mvf-placeholder-primary">ПРИЛОЖИ ОКНО С ВИДЕО</div>
            <small id="mvf-placeholder-secondary">перетащи видео сюда и подгони размер рамки</small>
          </div>
          <div class="mvf-player" id="mvf-player" hidden></div>
          <div class="mvf-overlay" aria-hidden="true"></div>
          <div class="mvf-input-shield" id="mvf-input-shield" aria-hidden="true" hidden></div>
        </div>
        <div class="mvf-volume-popover" id="mvf-volume-popover" hidden>
          <button class="mvf-volume-mute" id="mvf-volume-mute" type="button" title="Вкл./выкл. звук" aria-label="Вкл./выкл. звук">🔊</button>
          <input type="range" id="mvf-volume-range" min="0" max="100" step="1" aria-label="Громкость видео" />
          <output id="mvf-volume-value">65%</output>
        </div>
        <footer class="mvf-footer"><span id="mvf-footer-left">КАНАЛ 01 / ВНЕШНИЙ ЭКРАН</span><span id="mvf-footer-right">● ОЖИДАНИЕ</span></footer>
        <div class="mvf-grip" id="mvf-grip" role="button" tabindex="0" title="Тяни угол, чтобы изменить размер" aria-label="Изменить размер рамки">◢</div>
      </section>
      <section class="mvf-panel" id="mvf-panel" aria-label="Настройки видеорамки" hidden>
        <div class="mvf-panel-heading"><span>НАСТРОЙКА МОНИТОРА</span><button type="button" class="mvf-tool" id="mvf-panel-close" aria-label="Закрыть настройки">×</button></div>
        <div class="mvf-panel-body">
          <div class="mvf-field-title">КОРПУС / ОФОРМЛЕНИЕ</div>
          <div class="mvf-theme-grid" id="mvf-theme-grid">
            <button type="button" data-theme="dispatch"><i class="mvf-preview mvf-preview-dispatch"></i><span>Диспетчерская</span></button>
            <button type="button" data-theme="crt"><i class="mvf-preview mvf-preview-crt"></i><span>ЭЛТ · 2005</span></button>
            <button type="button" data-theme="vhs"><i class="mvf-preview mvf-preview-vhs"></i><span>VHS</span></button>
            <button type="button" data-theme="metro"><i class="mvf-preview mvf-preview-metro"></i><span>Метро</span></button>
            <button type="button" data-theme="noir"><i class="mvf-preview mvf-preview-noir"></i><span>Ночной</span></button>
            <button type="button" data-theme="tavern"><i class="mvf-preview mvf-preview-tavern"></i><span>Под тему ST</span></button>
          </div>
          <div class="mvf-hint" id="mvf-tavern-hint" hidden>Подхватывает цвета, фон и шрифт SillyTavern. При смене темы рамка обновится сама.</div>
          <div class="mvf-field-title">РЕЖИМ ЭКРАНА</div>
          <div class="mvf-switches" id="mvf-modes">
            <button type="button" data-mode="frame">ВНЕШНЕЕ ОКНО</button>
            <button type="button" data-mode="embed">ПЛЕЕР ПО ССЫЛКЕ</button>
          </div>
          <div class="mvf-hint" id="mvf-mode-hint"></div>
          <div class="mvf-url-box" id="mvf-url-box" hidden>
            <label for="mvf-url">ССЫЛКА НА ВИДЕО</label>
            <input id="mvf-url" type="url" spellcheck="false" placeholder="YouTube, Vimeo или .mp4 / .webm" autocomplete="off" maxlength="2048" />
            <div class="mvf-url-actions">
              <button type="button" id="mvf-play">▶ ОТКРЫТЬ</button>
              <button type="button" id="mvf-stop">■ СТОП</button>
            </div>
            <div class="mvf-queue-heading">ОЧЕРЕДЬ ВОСПРОИЗВЕДЕНИЯ <span id="mvf-queue-count">0</span></div>
            <div class="mvf-queue-list" id="mvf-queue-list"></div>
            <label for="mvf-queue-input">ДОБАВИТЬ ССЫЛКИ (ПО ОДНОЙ НА СТРОКУ)</label>
            <textarea id="mvf-queue-input" rows="3" spellcheck="false" placeholder="https://youtu.be/…&#10;https://www.youtube.com/watch?v=…" maxlength="16000"></textarea>
            <button type="button" id="mvf-queue-add" class="mvf-queue-add">＋ ДОБАВИТЬ В ОЧЕРЕДЬ</button>
            <p class="mvf-video-hint" id="mvf-video-status" role="status">Плеер загрузится только после нажатия «Открыть».</p>
          </div>
          <div class="mvf-settings-line">
            <label for="mvf-name">НАДПИСЬ НА РАМКЕ</label>
            <input id="mvf-name" type="text" maxlength="30" spellcheck="false" />
          </div>
          <div class="mvf-settings-line">
            <label for="mvf-border-range">ТОЛЩИНА КОРПУСА <output id="mvf-border-value">10 px</output></label>
            <input type="range" id="mvf-border-range" min="4" max="22" step="1" />
          </div>
          <label class="mvf-checkbox"><input type="checkbox" id="mvf-show-label" checked />Показывать метки на пустом экране</label>
          <button type="button" class="mvf-reset" id="mvf-reset">↺ ВЕРНУТЬ РАЗМЕР И ПОЛОЖЕНИЕ</button>
          <div class="mvf-panel-foot">Mom Video Frame · v1.3.1 · настройки сохраняются в этом браузере</div>
        </div>
      </section>
      <button class="mvf-launcher" id="mvf-launcher" type="button" hidden title="Показать Mom Video Frame">▣ <span>ВИДЕОРАМКА</span></button>
    `;
    shadow.append(content);

    const $ = (id) => shadow.getElementById(id);
    const dock = $('mvf-dock');
    const panel = $('mvf-panel');
    const launcher = $('mvf-launcher');
    const screen = $('mvf-screen');
    const player = $('mvf-player');
    const videoStatus = $('mvf-video-status');
    const shield = $('mvf-input-shield');
    const settings = mvfLoadSettings();
    let playing = false;
    let activeSource = null;
    let moving = null;
    let youtubePlayer = null;
    let generation = 0;
    let videoElement = null;

    // A standard SillyTavern inline drawer. Unlike a floating Shadow DOM widget,
    // this lives in the real Extensions settings list (the one shown in ST's menu).
    function addExtensionsSettings() {
        const container = document.querySelector('#extensions_settings2');
        if (!container || document.getElementById('mvf-extension-settings')) return;
        const section = document.createElement('div');
        section.id = 'mvf-extension-settings';
        section.innerHTML = `
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>MOM VIDEO FRAME <small style="font-weight: normal;opacity:.65;">v1.3.1</small></b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <label class="checkbox_label" for="mvf-extension-enabled">
                        <input type="checkbox" id="mvf-extension-enabled" />
                        <span>Включить видеорамку</span>
                    </label>
                    <label class="checkbox_label" for="mvf-extension-locked">
                        <input type="checkbox" id="mvf-extension-locked" />
                        <span>Блокировать управление плеером</span>
                    </label>
                    <div style="font-size: 0.86em; opacity: .8; margin: 7px 0 10px;">Когда плеер заблокирован, наведение мыши не вызывает кнопки YouTube. Разблокировать можно значком замка на рамке.</div>
                    <button type="button" id="mvf-extension-show" class="menu_button" style="width: 100%;">Показать рамку / настройки</button>
                </div>
            </div>`;
        container.append(section);
        const enabledBox = section.querySelector('#mvf-extension-enabled');
        const lockedBox = section.querySelector('#mvf-extension-locked');
        enabledBox.checked = settings.enabled;
        lockedBox.checked = settings.locked;
        enabledBox.addEventListener('change', () => applyEnabled(enabledBox.checked));
        lockedBox.addEventListener('change', () => setLocked(lockedBox.checked));
        section.querySelector('#mvf-extension-show').addEventListener('click', () => {
            if (!settings.enabled) applyEnabled(true);
            toggleVisible(true);
            setPanelOpen(true);
        });
    }
    function syncExtensionsSettings() {
        const enabledBox = document.getElementById('mvf-extension-enabled');
        const lockedBox = document.getElementById('mvf-extension-locked');
        if (enabledBox) enabledBox.checked = settings.enabled;
        if (lockedBox) lockedBox.checked = settings.locked;
    }
    function applyEnabled(enabled) {
        settings.enabled = Boolean(enabled);
        if (!settings.enabled) {
            stopVideo();
            setPanelOpen(false);
        }
        host.style.display = settings.enabled ? '' : 'none';
        syncExtensionsSettings();
        save();
    }
    function setLocked(locked) {
        settings.locked = Boolean(locked);
        renderLockState();
        syncExtensionsSettings();
        save();
    }
    function renderLockState() {
        const isEmbed = settings.mode === 'embed';
        const isLocked = isEmbed && playing && settings.locked;
        shield.hidden = !isLocked;
        screen.classList.toggle('mvf-controls-locked', isLocked);
        const button = $('mvf-lock');
        button.hidden = !isEmbed;
        button.textContent = settings.locked ? '🔒' : '🔓';
        button.title = settings.locked ? 'Разблокировать управление видео' : 'Заблокировать управление видео';
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-pressed', String(settings.locked));
        button.classList.toggle('mvf-lock-active', settings.locked);
    }
    function save() {
        try { localStorage.setItem(MVF_STORAGE_KEY, JSON.stringify(settings)); }
        catch (error) { console.warn('[Mom Video Frame] Save failed:', error); }
    }
    function sizeLimits() {
        return {
            w: Math.max(180, window.innerWidth - 2 * MVF_MARGIN),
            h: Math.max(160, window.innerHeight - 2 * MVF_MARGIN),
        };
    }
    function clampGeometry() {
        const lim = sizeLimits();
        settings.w = mvfClamp(settings.w, Math.min(MVF_MIN_W, lim.w), lim.w);
        settings.h = mvfClamp(settings.h, Math.min(MVF_MIN_H, lim.h), lim.h);
        if (settings.x === null) settings.x = Math.max(MVF_MARGIN, window.innerWidth - settings.w - 22);
        settings.x = mvfClamp(settings.x, MVF_MARGIN, Math.max(MVF_MARGIN, window.innerWidth - settings.w - MVF_MARGIN));
        settings.y = mvfClamp(settings.y, MVF_MARGIN, Math.max(MVF_MARGIN, window.innerHeight - settings.h - MVF_MARGIN));
    }
    function panelPosition() {
        if (panel.hidden) return;
        const width = Math.min(344, Math.max(220, window.innerWidth - 20));
        let x = settings.x + settings.w - width;
        x = mvfClamp(x, 10, Math.max(10, window.innerWidth - width - 10));
        const belowY = settings.y + settings.h + 10;
        const spaceBelow = Math.max(0, window.innerHeight - belowY - 10);
        const spaceAbove = Math.max(0, settings.y - 20);
        const placeBelow = spaceBelow >= 300 || spaceBelow >= spaceAbove;
        const panelHeight = Math.min(540, placeBelow ? spaceBelow : spaceAbove);
        const y = placeBelow ? belowY : Math.max(8, settings.y - panelHeight - 10);
        panel.style.left = `${x}px`;
        panel.style.top = `${y}px`;
        panel.style.width = `${width}px`;
        panel.style.maxHeight = `${Math.max(100, Math.min(panelHeight, window.innerHeight - y - 8))}px`;
    }
    function geometry() {
        clampGeometry();
        dock.style.left = `${settings.x}px`;
        dock.style.top = `${settings.y}px`;
        dock.style.width = `${settings.w}px`;
        dock.style.height = `${settings.h}px`;
        dock.style.setProperty('--mvf-edge-size', `${settings.frameWidth}px`);
        panelPosition();
    }
    function setPanelOpen(open) {
        panel.hidden = !open;
        $('mvf-open-settings').setAttribute('aria-expanded', String(open));
        panelPosition();
    }
    function setStatus(message) {
        videoStatus.textContent = message;
    }
    function stopVideo() {
        generation++;
        // Destroy the player before removing its iframe; stale callbacks are ignored.
        const previousPlayer = youtubePlayer;
        youtubePlayer = null;
        if (previousPlayer) {
            try { previousPlayer.destroy(); } catch (_) { /* iframe may already be gone */ }
        }
        if (videoElement) {
            videoElement.pause();
            videoElement.removeAttribute('src');
            videoElement.load();
            videoElement = null;
        }
        player.replaceChildren();
        player.hidden = true;
        playing = false;
        activeSource = null;
        renderVideoStatus();
    }
    function setVolume(volume) {
        settings.volume = mvfClamp(Number(volume) || 0, 0, 100);
        if (settings.volume > 0 && settings.muted) settings.muted = false;
        applyVolume();
        renderVolume();
        save();
    }
    function setMuted(muted) {
        settings.muted = Boolean(muted);
        applyVolume();
        renderVolume();
        save();
    }
    function applyVolume() {
        if (youtubePlayer) {
            try {
                youtubePlayer.setVolume(settings.volume);
                if (settings.muted || settings.volume === 0) youtubePlayer.mute();
                else youtubePlayer.unMute();
            } catch (error) { console.warn('[Mom Video Frame] Volume:', error); }
        }
        if (videoElement) {
            videoElement.volume = settings.volume / 100;
            videoElement.muted = settings.muted || settings.volume === 0;
        }
    }
    function renderVolume() {
        $('mvf-volume-range').value = String(settings.volume);
        $('mvf-volume-value').textContent = `${settings.volume}%`;
        $('mvf-volume-mute').textContent = settings.muted || settings.volume === 0 ? '🔇' : '🔊';
        $('mvf-volume-open').textContent = settings.muted || settings.volume === 0 ? '♩' : '♫';
        $('mvf-volume-open').title = `Громкость: ${settings.muted ? 'выключено' : settings.volume + '%'}`;
    }
    function closeVolume() {
        $('mvf-volume-popover').hidden = true;
        $('mvf-volume-open').setAttribute('aria-expanded', 'false');
    }
    function renderQueue() {
        const list = $('mvf-queue-list');
        list.replaceChildren();
        $('mvf-queue-count').textContent = `${settings.queue.length}/60`;
        for (const [index, url] of settings.queue.entries()) {
            const source = mvfGetVideoSource(url);
            const line = document.createElement('div');
            line.className = 'mvf-queue-item';
            if (index === settings.queueIndex) line.classList.add('mvf-queue-current');
            const label = document.createElement('span');
            label.className = 'mvf-queue-item-label';
            label.textContent = `${index + 1}. ${source?.name || 'Видео'} · ${url}`;
            label.title = url;
            line.append(label);
            for (const [action, symbol, title] of [
                ['play', '▶', 'Воспроизвести'], ['up', '↑', 'Поднять'],
                ['down', '↓', 'Опустить'], ['remove', '×', 'Удалить']
            ]) {
                const button = document.createElement('button');
                button.type = 'button';
                button.dataset.action = action;
                button.dataset.index = String(index);
                button.title = title;
                button.setAttribute('aria-label', `${title}: видео ${index + 1}`);
                button.textContent = symbol;
                if (action === 'up' && index === 0 || action === 'down' && index === settings.queue.length - 1) button.disabled = true;
                line.append(button);
            }
            list.append(line);
        }
        const isEmbed = settings.mode === 'embed';
        $('mvf-prev').hidden = !isEmbed || settings.queue.length < 2;
        $('mvf-next').hidden = !isEmbed || settings.queue.length < 2;
        $('mvf-prev').disabled = settings.queueIndex === 0;
        $('mvf-next').disabled = settings.queueIndex >= settings.queue.length - 1;
    }
    function renderVideoStatus() {
        const isFrame = settings.mode === 'frame';
        screen.classList.toggle('mvf-frame-mode', isFrame);
        screen.classList.toggle('mvf-embed-mode', !isFrame);
        screen.classList.toggle('mvf-video-running', playing);
        renderLockState();
        $('mvf-placeholder').hidden = playing || (!settings.labelVisible && isFrame);
        $('mvf-placeholder-primary').textContent = isFrame ? 'МЕСТО ДЛЯ ВИДЕО' : 'НЕТ СИГНАЛА';
        $('mvf-placeholder-secondary').textContent = isFrame ? 'подгони рамку под плавающее окно' : 'вставь ссылку на ролик в настройках';
        $('mvf-footer-left').textContent = isFrame ? 'КАНАЛ 01 / ВНЕШНИЙ ЭКРАН' :
            settings.queue.length > 1 ? `КАНАЛ 02 / ОЧЕРЕДЬ ${settings.queueIndex + 1} ИЗ ${settings.queue.length}` : 'КАНАЛ 02 / ВСТРОЕННЫЙ ПЛЕЕР';
        $('mvf-footer-right').textContent = playing ? '● В ЭФИРЕ' : '○ ОЖИДАНИЕ';
        $('mvf-url-box').hidden = isFrame;
        $('mvf-mode-hint').textContent = isFrame
            ? 'Для обычного плавающего окна YouTube: помести его поверх прозрачной середины. Рамка остаётся в SillyTavern.'
            : 'YouTube / Vimeo / прямой .mp4 или .webm. Автопереход: YouTube и видеофайлы; для Vimeo — кнопка следующего. Автовоспроизведение может блокироваться браузером.';
        $('mvf-toggle-mode').textContent = isFrame ? '▣' : '▶';
        $('mvf-toggle-mode').title = isFrame ? 'Сейчас: внешнее окно. Переключить на плеер' : 'Сейчас: плеер. Переключить на рамку';
        $('mvf-volume-open').hidden = isFrame;
        if (isFrame) closeVolume();
        renderQueue();
        for (const button of $('mvf-modes').querySelectorAll('button[data-mode]')) {
            const active = button.dataset.mode === settings.mode;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        }
    }
    function setMode(mode) {
        if (!['frame', 'embed'].includes(mode)) return;
        if (settings.mode !== mode) stopVideo();
        settings.mode = mode;
        renderVideoStatus();
        save();
    }
    function renderSettings() {
        dock.className = `mvf-dock mvf-theme-${settings.theme}`;
        $('mvf-title').textContent = settings.title || 'ЭФИР 01';
        $('mvf-name').value = settings.title;
        $('mvf-border-range').value = String(settings.frameWidth);
        $('mvf-border-value').textContent = `${settings.frameWidth} px`;
        $('mvf-show-label').checked = settings.labelVisible;
        $('mvf-tavern-hint').hidden = settings.theme !== 'tavern';
        $('mvf-url').value = settings.savedUrl;
        for (const button of $('mvf-theme-grid').querySelectorAll('[data-theme]')) {
            const active = button.dataset.theme === settings.theme;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', String(active));
        }
        renderVolume();
        renderVideoStatus();
        geometry();
    }
    function toggleVisible(show) {
        settings.visible = show;
        if (!show) {
            stopVideo();
            setPanelOpen(false);
        }
        dock.hidden = !show;
        launcher.hidden = show;
        save();
    }
    function onVideoEnded(token) {
        if (token !== generation || !playing) return;
        if (settings.queueIndex < settings.queue.length - 1) {
            startQueueIndex(settings.queueIndex + 1, true);
        } else {
            setStatus('Очередь закончилась. Можно выбрать ролик из списка или добавить новые.');
        }
    }
    function startQueueIndex(index, auto = false) {
        if (index < 0 || index >= settings.queue.length) return;
        const url = settings.queue[index];
        const source = mvfGetVideoSource(url);
        if (!source) { setStatus('Эта ссылка больше не поддерживается.'); return; }
        stopVideo();
        settings.queueIndex = index;
        settings.savedUrl = url;
        if (settings.mode !== 'embed') settings.mode = 'embed';
        $('mvf-url').value = url;
        save();
        const token = generation;
        const element = document.createElement(source.type === 'iframe' ? 'iframe' : 'video');
        if (source.type === 'iframe') {
            element.setAttribute('allow', 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share');
            element.setAttribute('allowfullscreen', '');
            element.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            element.title = `${source.name} — Mom Video Frame`;
            if (source.provider === 'youtube') {
                const urlObject = new URL(source.src);
                urlObject.searchParams.set('enablejsapi', '1');
                if (location.protocol === 'http:' || location.protocol === 'https:') urlObject.searchParams.set('origin', location.origin);
                if (auto) urlObject.searchParams.set('autoplay', '1');
                element.src = urlObject.href;
            } else {
                element.src = source.src + (auto ? (source.src.includes('?') ? '&' : '?') + 'autoplay=1' : '');
            }
        } else {
            element.controls = true;
            element.playsInline = true;
            element.preload = 'metadata';
            element.src = source.src;
            videoElement = element;
            element.addEventListener('ended', () => onVideoEnded(token));
            element.addEventListener('error', () => { if (token === generation) setStatus('Не удалось загрузить видеофайл.'); });
            applyVolume();
        }
        player.replaceChildren(element);
        player.hidden = false;
        playing = true;
        activeSource = source;
        renderVideoStatus();
        syncExtensionsSettings();
        setStatus(`Видео ${index + 1} из ${settings.queue.length}: ${source.name}. ${source.provider === 'vimeo' ? 'Для Vimeo переход вручную.' : ''}`);
        if (source.provider === 'youtube') {
            mvfGetYouTubeAPI().then(api => {
                if (token !== generation || !api || !element.isConnected) {
                    if (token === generation && !api) setStatus('Видео работает, но YouTube API недоступен: внешняя громкость и автопереход могут не работать.');
                    return;
                }
                try {
                    youtubePlayer = new api.Player(element, {
                        events: {
                            onReady: () => { if (token === generation) applyVolume(); },
                            onStateChange: ev => { if (ev.data === api.PlayerState.ENDED) onVideoEnded(token); },
                            onError: () => { if (token === generation) setStatus('YouTube не разрешает воспроизвести этот ролик или произошла ошибка.'); },
                            onAutoplayBlocked: () => { if (token === generation) setStatus('Браузер остановил автозапуск. Нажми ▶ на видео.'); },
                        },
                    });
                } catch (error) {
                    console.warn('[Mom Video Frame] Cannot connect YouTube controls:', error);
                    if (token === generation) setStatus('YouTube загрузился без внешнего управления.');
                }
            });
        } else if (source.type === 'video' && auto) {
            element.play().catch(() => { if (token === generation) setStatus('Браузер остановил автозапуск. Нажми ▶ на видео.'); });
        }
    }
    function playUrl() {
        const url = $('mvf-url').value.trim();
        if (!url) { setStatus('Вставь ссылку на видео.'); return; }
        if (!mvfGetVideoSource(url)) { setStatus('Не могу встроить эту ссылку. Поддерживаются YouTube, Vimeo и прямые .mp4 / .webm / .ogg.'); return; }
        settings.queue = [url];
        settings.queueIndex = 0;
        startQueueIndex(0);
    }
    function addToQueue() {
        const lines = $('mvf-queue-input').value.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
        if (!lines.length) { setStatus('Вставь ссылки в поле очереди — по одной на строку.'); return; }
        let accepted = 0, invalid = 0;
        for (const url of lines) {
            if (settings.queue.length >= 60) break;
            if (url.length <= 2048 && mvfGetVideoSource(url)) { settings.queue.push(url); accepted++; }
            else invalid++;
        }
        if (!accepted) { setStatus('Нет поддерживаемых ссылок или очередь уже заполнена (60 видео).'); return; }
        $('mvf-queue-input').value = '';
        const shouldStart = !playing && settings.queue.length === accepted;
        save();
        if (shouldStart) startQueueIndex(0);
        else renderVideoStatus();
        setStatus(`Добавлено ${accepted} видео. ${invalid ? `Пропущено неподдерживаемых: ${invalid}. ` : ''}${playing ? 'Очередь продолжит играть по порядку.' : 'Выбери ▶ рядом с видео.'}`);
    }

    // Dragging / resizing: only header and corner react; the transparent middle never eats chat clicks.
    function beginPointer(event, action) {
        if (event.button !== 0) return;
        if (event.target.closest('button, input, a')) return;
        event.preventDefault();
        moving = {
            action, pointerId: event.pointerId,
            clientX: event.clientX, clientY: event.clientY,
            x: settings.x, y: settings.y, w: settings.w, h: settings.h,
            target: event.currentTarget,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        document.documentElement.classList.add('mvf-user-dragging');
    }
    function pointerMove(event) {
        if (!moving || moving.pointerId !== event.pointerId) return;
        event.preventDefault();
        const dx = event.clientX - moving.clientX;
        const dy = event.clientY - moving.clientY;
        if (moving.action === 'drag') {
            settings.x = moving.x + dx;
            settings.y = moving.y + dy;
        } else {
            const lim = sizeLimits();
            settings.w = mvfClamp(moving.w + dx, Math.min(MVF_MIN_W, lim.w), lim.w);
            settings.h = mvfClamp(moving.h + dy, Math.min(MVF_MIN_H, lim.h), lim.h);
        }
        geometry();
    }
    function pointerEnd(event) {
        if (!moving || moving.pointerId !== event.pointerId) return;
        moving = null;
        document.documentElement.classList.remove('mvf-user-dragging');
        save();
    }
    const dragHandle = $('mvf-drag');
    const grip = $('mvf-grip');
    dragHandle.addEventListener('pointerdown', event => beginPointer(event, 'drag'));
    grip.addEventListener('pointerdown', event => beginPointer(event, 'resize'));
    for (const el of [dragHandle, grip]) {
        el.addEventListener('pointermove', pointerMove);
        el.addEventListener('pointerup', pointerEnd);
        el.addEventListener('pointercancel', pointerEnd);
        el.addEventListener('lostpointercapture', (event) => pointerEnd(event));
    }
    grip.addEventListener('keydown', (event) => {
        const amount = event.shiftKey ? 20 : 10;
        if (event.key === 'ArrowRight') settings.w += amount;
        else if (event.key === 'ArrowLeft') settings.w -= amount;
        else if (event.key === 'ArrowDown') settings.h += amount;
        else if (event.key === 'ArrowUp') settings.h -= amount;
        else return;
        event.preventDefault();
        geometry(); save();
    });

    $('mvf-open-settings').addEventListener('click', () => setPanelOpen(panel.hidden));
    $('mvf-panel-close').addEventListener('click', () => setPanelOpen(false));
    $('mvf-minimize').addEventListener('click', () => toggleVisible(false));
    $('mvf-lock').addEventListener('click', () => setLocked(!settings.locked));
    $('mvf-volume-open').addEventListener('click', () => {
        const show = $('mvf-volume-popover').hidden;
        $('mvf-volume-popover').hidden = !show;
        $('mvf-volume-open').setAttribute('aria-expanded', String(show));
    });
    $('mvf-volume-range').addEventListener('input', e => setVolume(e.target.value));
    $('mvf-volume-mute').addEventListener('click', () => setMuted(!settings.muted));
    $('mvf-next').addEventListener('click', () => startQueueIndex(settings.queueIndex + 1, true));
    $('mvf-prev').addEventListener('click', () => startQueueIndex(settings.queueIndex - 1, true));
    $('mvf-queue-add').addEventListener('click', addToQueue);
    $('mvf-queue-list').addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const index = Number(button.dataset.index);
        if (!Number.isInteger(index) || index < 0 || index >= settings.queue.length) return;
        const action = button.dataset.action;
        if (action === 'play') { startQueueIndex(index); return; }
        if (action === 'up' || action === 'down') {
            const other = index + (action === 'up' ? -1 : 1);
            if (other < 0 || other >= settings.queue.length) return;
            [settings.queue[index], settings.queue[other]] = [settings.queue[other], settings.queue[index]];
            if (settings.queueIndex === index) settings.queueIndex = other;
            else if (settings.queueIndex === other) settings.queueIndex = index;
        }
        if (action === 'remove') {
            const isCurrent = index === settings.queueIndex;
            settings.queue.splice(index, 1);
            if (index < settings.queueIndex) settings.queueIndex--;
            if (isCurrent) {
                stopVideo();
                settings.queueIndex = Math.min(settings.queueIndex, Math.max(0, settings.queue.length - 1));
                if (settings.queue.length) startQueueIndex(settings.queueIndex);
            } else if (settings.queue.length === 0) settings.queueIndex = 0;
        }
        renderVideoStatus(); save();
    });
    launcher.addEventListener('click', () => toggleVisible(true));
    $('mvf-toggle-mode').addEventListener('click', () => setMode(settings.mode === 'frame' ? 'embed' : 'frame'));
    $('mvf-theme-grid').addEventListener('click', (event) => {
        const button = event.target.closest('[data-theme]');
        if (!button || !MVF_THEMES.includes(button.dataset.theme)) return;
        settings.theme = button.dataset.theme;
        renderSettings(); save();
    });
    $('mvf-modes').addEventListener('click', (event) => {
        const button = event.target.closest('[data-mode]');
        if (button) setMode(button.dataset.mode);
    });
    $('mvf-name').addEventListener('input', (event) => {
        settings.title = event.target.value.slice(0, 30);
        $('mvf-title').textContent = settings.title || 'ЭФИР 01';
        save();
    });
    $('mvf-border-range').addEventListener('input', (event) => {
        settings.frameWidth = mvfClamp(Number(event.target.value), 4, 22);
        $('mvf-border-value').textContent = `${settings.frameWidth} px`;
        geometry(); save();
    });
    $('mvf-show-label').addEventListener('change', (event) => {
        settings.labelVisible = event.target.checked;
        renderVideoStatus(); save();
    });
    $('mvf-url').addEventListener('change', (event) => {
        settings.savedUrl = event.target.value.trim().slice(0, 2048);
        save();
    });
    $('mvf-url').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); playUrl(); }
    });
    $('mvf-play').addEventListener('click', playUrl);
    $('mvf-stop').addEventListener('click', () => {
        stopVideo();
        setStatus('Плеер остановлен. Ссылка сохранена.');
    });
    $('mvf-reset').addEventListener('click', () => {
        const d = MVF_DEFAULTS;
        settings.x = null; settings.y = d.y; settings.w = d.w; settings.h = d.h;
        geometry(); save();
    });
    window.addEventListener('resize', () => { geometry(); save(); }, { passive: true });

    // Esc only closes our own settings, not ST popups.
    shadow.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !panel.hidden) { setPanelOpen(false); event.stopPropagation(); }
    });
    renderSettings();
    toggleVisible(settings.visible);
    applyEnabled(settings.enabled);
    addExtensionsSettings();
    if (!document.getElementById('mvf-extension-settings')) {
        // Wait for ST to add its settings panel, without a polling timer.
        const registrationObserver = new MutationObserver(() => {
            addExtensionsSettings();
            if (document.getElementById('mvf-extension-settings')) registrationObserver.disconnect();
        });
        registrationObserver.observe(document.body, { childList: true, subtree: true });
    }
    // In certain ST startup sequences the Extensions pane is populated after DOMContentLoaded.
    // APP_INITIALIZED is replayed to late listeners in modern ST releases.
    try {
        const context = globalThis.SillyTavern?.getContext?.();
        if (context?.eventSource && context?.event_types?.APP_INITIALIZED) {
            context.eventSource.on(context.event_types.APP_INITIALIZED, addExtensionsSettings);
        }
    } catch (error) {
        console.warn('[Mom Video Frame] Could not register APP_INITIALIZED fallback:', error);
    }
    setStatus('Плеер загрузится только после нажатия «Открыть».');
    console.info(`[Mom Video Frame] v${MVF_VERSION} loaded. Volume and queue controls ready.`);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mvfInit, { once: true });
} else {
    mvfInit();
}
