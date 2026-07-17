/*
 * Time Tomatoer — A simple Obsidian Pomodoro timer.
 *
 *   Start / Pause / Skip / Reset
 *   Adjustable duration 1–120 min
 *   Today: count of completed sessions
 */

const { Plugin, ItemView, PluginSettingTab, Setting, Notice } = require("obsidian");

// ──────────────────────────────────────────────
// 1. Timer engine
// ──────────────────────────────────────────────

const VIEW_TYPE = "time-tomatoer-view";

class TomatoTimer {
    constructor(durationMinutes) {
        this.durationMinutes = durationMinutes;
        this.remainingSeconds = durationMinutes * 60;
        this.state = "idle"; // idle | running | paused
        this.intervalId = null;
        this.onTick = null;
        this.onComplete = null;
    }

    getDurationSeconds() {
        return this.durationMinutes * 60;
    }

    setDuration(minutes) {
        this.durationMinutes = minutes;
        if (this.state === "idle") {
            this.remainingSeconds = this.getDurationSeconds();
            this._notifyTick();
        }
    }

    start() {
        if (this.state === "running") return;
        if (this.state === "idle") {
            this.remainingSeconds = this.getDurationSeconds();
        }
        this.state = "running";
        this._startInterval();
        this._notifyTick();
    }

    pause() {
        if (this.state !== "running") return;
        this.state = "paused";
        this._stopInterval();
        this._notifyTick();
    }

    resume() {
        if (this.state !== "paused") return;
        if (this.remainingSeconds <= 0) return;
        this.state = "running";
        this._startInterval();
        this._notifyTick();
    }

    reset() {
        this._stopInterval();
        this.state = "idle";
        this.remainingSeconds = this.getDurationSeconds();
        this._notifyTick();
    }

    skip() {
        this._stopInterval();
        this.state = "idle";
        this.remainingSeconds = this.getDurationSeconds();
        this._notifyTick();
    }

    getState() {
        return {
            state: this.state,
            remainingSeconds: this.remainingSeconds,
            durationMinutes: this.durationMinutes,
        };
    }

    destroy() {
        this._stopInterval();
        this.onTick = null;
        this.onComplete = null;
    }

    // ── internals ────────────────────────────

    _startInterval() {
        this._stopInterval();
        this.intervalId = setInterval(() => this._tick(), 1000);
    }

    _stopInterval() {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }

    _tick() {
        if (this.state !== "running") return;
        this.remainingSeconds -= 1;
        this._notifyTick();
        if (this.remainingSeconds <= 0) {
            this.remainingSeconds = 0;
            this._stopInterval();
            this.state = "idle";
            this._notifyTick();
            if (this.onComplete) this.onComplete();
        }
    }

    _notifyTick() {
        if (this.onTick) this.onTick(this.getState());
    }
}

// ──────────────────────────────────────────────
// 2. Sidebar view
// ──────────────────────────────────────────────

class TimeTomatoerView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return VIEW_TYPE; }
    getDisplayText() { return "Time Tomatoer"; }
    getIcon() { return "timer"; }

    async onOpen() {
        this.buildUI();
        this.refreshUI();
    }

    async onClose() {}

    // ── UI ───────────────────────────────────

    buildUI() {
        const el = this.contentEl;
        el.empty();
        el.addClass("tomatoer-container");

        // Timer display
        const timerArea = el.createDiv({ cls: "tomatoer-timer-area" });
        this.timerEl = timerArea.createDiv({ cls: "tomatoer-timer-display", text: "25:00" });
        this.statusEl = timerArea.createDiv({ cls: "tomatoer-status-text", text: "Ready" });

        // Controls
        const controls = el.createDiv({ cls: "tomatoer-controls" });

        this.startPauseBtn = controls.createEl("button", {
            cls: "tomatoer-btn tomatoer-btn-primary",
            text: "Start",
        });
        this.registerDomEvent(this.startPauseBtn, "click", () => this.onStartPause());

        this.skipBtn = controls.createEl("button", {
            cls: "tomatoer-btn tomatoer-btn-secondary",
            text: "Skip",
        });
        this.skipBtn.disabled = true;
        this.registerDomEvent(this.skipBtn, "click", () => this.plugin.timer.skip());

        this.resetBtn = controls.createEl("button", {
            cls: "tomatoer-btn tomatoer-btn-danger",
            text: "Reset",
        });
        this.registerDomEvent(this.resetBtn, "click", () => this.plugin.timer.reset());

        // Today stats
        this.todayEl = el.createDiv({ cls: "tomatoer-today" });
    }

    onStartPause() {
        const { state } = this.plugin.timer.getState();
        if (state === "idle") this.plugin.timer.start();
        else if (state === "running") this.plugin.timer.pause();
        else if (state === "paused") this.plugin.timer.resume();
    }

    refreshUI() {
        const s = this.plugin.timer.getState();

        // Timer display
        const mm = String(Math.floor(s.remainingSeconds / 60)).padStart(2, "0");
        const ss = String(s.remainingSeconds % 60).padStart(2, "0");
        this.timerEl.setText(`${mm}:${ss}`);

        // Status
        if (s.state === "running") {
            this.statusEl.setText("Focusing");
        } else if (s.state === "paused") {
            this.statusEl.setText("Paused");
        } else {
            this.statusEl.setText("Ready");
        }

        this.contentEl.setAttribute("data-phase", s.state);

        // Buttons
        if (s.state === "idle") {
            this.startPauseBtn.setText("Start");
            this.skipBtn.disabled = true;
        } else if (s.state === "running") {
            this.startPauseBtn.setText("Pause");
            this.skipBtn.disabled = false;
        } else if (s.state === "paused") {
            this.startPauseBtn.setText("Resume");
            this.skipBtn.disabled = false;
        }

        // Today panel
        this.refreshToday();
    }

    refreshToday() {
        const today = getDateString();
        const sessions = this.plugin.settings.sessions || {};
        const todaySessions = sessions[today] || [];
        const count = todaySessions.length;

        const el = this.todayEl;
        el.empty();

        const heading = el.createDiv({ cls: "tomatoer-today-heading" });
        heading.createSpan({ text: "Today", cls: "tomatoer-today-label" });

        const summary = count > 0
            ? `🍅 × ${count}`
            : "Start now!";
        heading.createSpan({ text: summary, cls: "tomatoer-today-count" });
    }
}

// ──────────────────────────────────────────────
// 3. Settings tab
// ──────────────────────────────────────────────

const DEFAULT_SETTINGS = {
    duration: 25,
    sessions: {},
};

class TimeTomatoerSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setHeading()
            .setName("Time Tomatoer");

        new Setting(containerEl)
            .setName("Duration (minutes)")
            .setDesc("Countdown length for each session (1–120 min).")
            .addSlider((slider) =>
                slider
                    .setLimits(1, 120, 1)
                    .setValue(this.plugin.settings.duration)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.duration = value;
                        await this.plugin.saveSettings();
                        this.plugin.timer.setDuration(value);
                        this.plugin.refreshAllViews();
                    })
            );
    }
}

// ──────────────────────────────────────────────
// 4. Plugin class
// ──────────────────────────────────────────────

class TimeTomatoerPlugin extends Plugin {
    async onload() {
        await this.loadSettings();

        // Timer
        this.timer = new TomatoTimer(this.settings.duration);
        this.timer.onTick = (state) => this.onTimerTick(state);
        this.timer.onComplete = () => this.onSessionComplete();

        // View
        this.registerView(VIEW_TYPE, (leaf) => new TimeTomatoerView(leaf, this));

        // Ribbon
        this.addRibbonIcon("timer", "Open Time Tomatoer", () => this.activateView());

        // Status bar
        this.statusBarEl = this.addStatusBarItem();
        this.statusBarEl.addClass("tomatoer-statusbar");
        this.statusBarEl.setText("🍅 --:--");
        this.registerDomEvent(this.statusBarEl, "click", () => this.activateView());

        // Commands
        this.addCommand({
            id: "tomatoer-start-pause",
            name: "Start / Pause",
            callback: () => {
                const { state } = this.timer.getState();
                if (state === "idle") this.timer.start();
                else if (state === "running") this.timer.pause();
                else if (state === "paused") this.timer.resume();
            },
        });
        this.addCommand({
            id: "tomatoer-skip",
            name: "Skip",
            callback: () => this.timer.skip(),
        });
        this.addCommand({
            id: "tomatoer-reset",
            name: "Reset",
            callback: () => this.timer.reset(),
        });
        this.addCommand({
            id: "tomatoer-open",
            name: "Open timer panel",
            callback: () => this.activateView(),
        });

        // Settings
        this.addSettingTab(new TimeTomatoerSettingTab(this.app, this));
    }

    onunload() {
        this.timer.destroy();
    }

    // ── Data ─────────────────────────────────

    async loadSettings() {
        const data = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data || {});
        if (!this.settings.sessions) this.settings.sessions = {};
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // ── Timer callbacks ──────────────────────

    onTimerTick(state) {
        this.refreshStatusBar(state);
        this.refreshAllViews();
    }

    async onSessionComplete() {
        const today = getDateString();
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

        if (!this.settings.sessions[today]) {
            this.settings.sessions[today] = [];
        }
        this.settings.sessions[today].push({
            time: time,
            duration: this.settings.duration,
        });

        await this.saveSettings();

        new Notice(`🍅 Done! (${this.settings.duration} min)`);

        this.refreshAllViews();
    }

    // ── Status bar ───────────────────────────

    refreshStatusBar(state) {
        if (state.state === "idle" && state.remainingSeconds === this.timer.getDurationSeconds()) {
            this.statusBarEl.setText("🍅 --:--");
            return;
        }
        const mm = String(Math.floor(state.remainingSeconds / 60)).padStart(2, "0");
        const ss = String(state.remainingSeconds % 60).padStart(2, "0");
        const icon = state.state === "running" ? "🍅" : "⏸";
        this.statusBarEl.setText(`${icon} ${mm}:${ss}`);
    }

    // ── View management ──────────────────────

    async activateView() {
        const { workspace } = this.app;
        const leaves = workspace.getLeavesOfType(VIEW_TYPE);
        if (leaves.length > 0) {
            workspace.revealLeaf(leaves[0]);
            return;
        }
        const leaf = workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: VIEW_TYPE, active: true });
            workspace.revealLeaf(leaf);
        }
    }

    refreshAllViews() {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
            if (leaf.view instanceof TimeTomatoerView) {
                leaf.view.refreshUI();
            }
        }
    }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function getDateString() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

module.exports = TimeTomatoerPlugin;
