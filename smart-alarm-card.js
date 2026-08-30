/**
 * Smart-Alarm-Card for Home Assistant
 * -----------------------------------------------------
 * A custom Lovelace card styled after the Control4 security panel:
 * a dark full-bleed panel with a title bar, a Status / Zones / History
 * tab strip, a large circular arm/disarm button with a colour-coded
 * ring, an Emergency button, a Functions button (door lock control),
 * and an on-card PIN keypad.
 *
 * INSTALL:
 * 1. Copy this file to <config>/www/smart-alarm-card.js
 * 2. Settings -> Dashboards -> Resources -> Add Resource
 *      URL: /local/smart-alarm-card.js
 *      Type: JavaScript Module
 * 3. Add a card with type: custom:smart-alarm-card
 *
 * EXAMPLE CONFIG:
 * type: custom:smart-alarm-card
 * entity: alarm_control_panel.home_alarm
 * name: Security System
 * require_code: true
 * code_length: 4
 * arm_modes:
 *   - away
 *   - home
 * zones:
 *   - entity: binary_sensor.front_door
 *     name: Front Door
 *   - entity: binary_sensor.back_door
 *     name: Back Door
 * lock:
 *   entity: lock.front_door
 *   name: Front Door Lock
 */

const ICONS = {
  lockOpenBig: `<svg viewBox="0 0 24 24"><path d="M12 17a2 2 0 0 0 2-2 2 2 0 0 0-2-2 2 2 0 0 0-2 2 2 2 0 0 0 2 2zm6-9h-9V6a3 3 0 0 1 5.83-1h2.13A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2z"/></svg>`,
  lockClosedBig: `<svg viewBox="0 0 24 24"><path d="M12 17a2 2 0 0 0 2-2 2 2 0 0 0-2-2 2 2 0 0 0-2 2 2 2 0 0 0 2 2zm6-9h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM8.9 6a3.1 3.1 0 0 1 6.2 0v2H8.9V6z"/></svg>`,
  alert: `<svg viewBox="0 0 24 24"><path d="M12 2L1 21h22L12 2zm0 3.99L19.53 19H4.47L12 5.99zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/></svg>`,
  hamburger: `<svg viewBox="0 0 24 24"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>`,
  lockClosed: `<svg viewBox="0 0 24 24"><path d="M12 17a2 2 0 0 0 2-2 2 2 0 0 0-2-2 2 2 0 0 0-2 2 2 2 0 0 0 2 2zm6-9h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM8.9 6a3.1 3.1 0 0 1 6.2 0v2H8.9V6z"/></svg>`,
  lockOpen: `<svg viewBox="0 0 24 24"><path d="M12 17a2 2 0 0 0 2-2 2 2 0 0 0-2-2 2 2 0 0 0-2 2 2 2 0 0 0 2 2zm6-9h-9V6a3 3 0 0 1 5.83-1h2.13A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2z"/></svg>`,
  backspace: `<svg viewBox="0 0 24 24"><path d="M22 3H7c-.69 0-1.23.35-1.59.88L0 12l5.41 8.11c.36.53.9.89 1.59.89h15a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm-4.59 12.59L16 17l-3-3-3 3-1.41-1.41L11.59 12 8.59 9 10 7.59l3 3 3-3L17.41 9 14.41 12l3 3z"/></svg>`,
  close: `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
};

const ARM_LABELS = {
  armed_home: "Armed Home",
  armed_away: "Armed Away",
  armed_night: "Armed Night",
  armed_vacation: "Armed Vacation",
  armed_custom_bypass: "Armed Custom",
};

const ARM_SERVICE = {
  home: "alarm_arm_home",
  away: "alarm_arm_away",
  night: "alarm_arm_night",
  vacation: "alarm_arm_vacation",
  custom_bypass: "alarm_arm_custom_bypass",
};

class SmartAlarmCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tab = "status"; // status | zones | history
    this._overlay = null; // null | 'arm-select' | 'keypad' | 'emergency' | 'functions'
    this._enteredCode = "";
    this._pendingService = null;
    this._error = false;
    this._lastMessage = null;
    this._historyItems = null;
    this._historyLoading = false;
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("You must define an entity (alarm_control_panel.*)");
    }
    this.config = {
      name: config.name || "Security System",
      require_code: config.require_code !== false,
      code_length: config.code_length || 4,
      arm_modes: config.arm_modes || ["away", "home"],
      zones: config.zones || [],
      lock: config.lock || null,
      ...config,
    };
  }

  set hass(hass) {
    const prev = this._hass ? this._hass.states[this.config.entity] : undefined;
    this._hass = hass;
    const cur = this._stateObj();
    if (prev && cur && prev.state !== cur.state) {
      this._lastMessage = `State is now: ${cur.state.toUpperCase()}`;
    }
    this._render();
  }

  getCardSize() {
    return 6;
  }

  static getStubConfig(hass) {
    const alarmEntity = Object.keys(hass.states).find((e) => e.startsWith("alarm_control_panel."));
    return {
      entity: alarmEntity || "alarm_control_panel.home_alarm",
      name: "Security System",
      require_code: true,
      code_length: 4,
      arm_modes: ["away", "home"],
      zones: [],
    };
  }

  _stateObj() {
    return this._hass && this.config ? this._hass.states[this.config.entity] : undefined;
  }

  _ringColor(state) {
    if (!state) return "#666";
    if (state === "disarmed") return "#4caf1c";
    if (state === "triggered") return "#e53935";
    if (state === "pending" || state === "arming" || state === "disarming") return "#ffa726";
    if (state.startsWith("armed_")) return "#e53935";
    return "#666";
  }

  _statusText(state) {
    if (!state) return "Unavailable";
    if (state === "disarmed") return "Disarmed Ready";
    if (state === "pending") return "Pending";
    if (state === "arming") return "Arming…";
    if (state === "disarming") return "Disarming…";
    if (state === "triggered") return "Alarm Triggered";
    if (ARM_LABELS[state]) return ARM_LABELS[state];
    return state;
  }

  // ---------- actions ----------

  _ringTap() {
    const state = this._stateObj()?.state;
    if (state === "disarmed") {
      if (this.config.arm_modes.length === 1) {
        this._startAction(ARM_SERVICE[this.config.arm_modes[0]]);
      } else {
        this._overlay = "arm-select";
        this._render();
      }
    } else {
      this._startAction("alarm_disarm");
    }
  }

  _startAction(service) {
    this._pendingService = service;
    this._enteredCode = "";
    this._error = false;
    if (this.config.require_code) {
      this._overlay = "keypad";
      this._render();
    } else {
      this._callAlarmService(service, "");
    }
  }

  _callAlarmService(service, code) {
    this._hass.callService("alarm_control_panel", service, {
      entity_id: this.config.entity,
      ...(code ? { code } : {}),
    });
    const expectFail = this.config.require_code && code.length < this.config.code_length;
    const before = this._stateObj()?.state;
    this._closeOverlay();
    if (this.config.require_code) {
      setTimeout(() => {
        const after = this._stateObj()?.state;
        if (after === before && !expectFail) {
          this._error = true;
          this._overlay = "keypad";
          this._render();
        }
      }, 1500);
    }
  }

  _closeOverlay() {
    this._overlay = null;
    this._enteredCode = "";
    this._pendingService = null;
    this._render();
  }

  _keypadPress(digit) {
    if (this._enteredCode.length >= this.config.code_length) return;
    this._error = false;
    this._enteredCode += digit;
    this._render();
    if (this._enteredCode.length === this.config.code_length) {
      setTimeout(() => this._callAlarmService(this._pendingService, this._enteredCode), 150);
    }
  }

  _keypadBackspace() {
    this._enteredCode = this._enteredCode.slice(0, -1);
    this._error = false;
    this._render();
  }

  _triggerEmergency() {
    this._hass.callService("alarm_control_panel", "alarm_trigger", {
      entity_id: this.config.entity,
    });
    this._closeOverlay();
  }

  _toggleLock(entityId) {
    const lockState = this._hass.states[entityId]?.state;
    this._hass.callService("lock", lockState === "locked" ? "unlock" : "lock", {
      entity_id: entityId,
    });
  }

  _moreInfo(entityId) {
    const event = new Event("hass-more-info", { bubbles: true, composed: true });
    event.detail = { entityId };
    this.shadowRoot.dispatchEvent(event);
  }

  _setTab(tab) {
    this._tab = tab;
    if (tab === "history" && !this._historyItems && !this._historyLoading) {
      this._loadHistory();
    }
    this._render();
  }

  async _loadHistory() {
    this._historyLoading = true;
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const entities = [this.config.entity, ...this.config.zones.map((z) => z.entity)].join(",");
      const items = await this._hass.callApi(
        "GET",
        `logbook/${since}?entity=${entities}`
      );
      this._historyItems = items.reverse().slice(0, 20);
    } catch (e) {
      this._historyItems = [];
    }
    this._historyLoading = false;
    this._render();
  }

  // ---------- render ----------

  _render() {
    if (!this._hass || !this.config) return;
    const stateObj = this._stateObj();
    const state = stateObj?.state;
    const ring = this._ringColor(state);
    const triggered = state === "triggered";
    const pending = state === "pending" || state === "arming" || state === "disarming";
    const icon = state === "disarmed" ? ICONS.lockOpenBig : ICONS.lockClosedBig;

    this.shadowRoot.innerHTML = `
      <style>${this._css(ring, pending, triggered)}</style>
      <ha-card>
        <div class="titlebar">${this.config.name}</div>
        <div class="tabs">
          <div class="tab ${this._tab === "status" ? "active" : ""}" data-tab="status">Status</div>
          <div class="tab ${this._tab === "zones" ? "active" : ""}" data-tab="zones">Zones</div>
          <div class="tab ${this._tab === "history" ? "active" : ""}" data-tab="history">History</div>
        </div>
        <div class="body">
          ${this._tab === "status" ? this._renderStatus(state, ring, icon) : ""}
          ${this._tab === "zones" ? this._renderZones() : ""}
          ${this._tab === "history" ? this._renderHistory() : ""}
        </div>
        ${this._overlay ? this._renderOverlay() : ""}
      </ha-card>
    `;
    this._attachListeners();
  }

  _renderStatus(state, ring, icon) {
    return `
      <div class="status-text" style="color:${ring}">${this._statusText(state)}</div>
      <div class="status-row">
        <div class="side-btn" id="emergency-btn">
          <div class="side-icon">${ICONS.alert}</div>
          <div class="side-label">Emergency</div>
        </div>

        <div class="ring-btn" id="ring-btn">${icon}</div>

        <div class="side-btn" id="functions-btn">
          <div class="side-icon">${ICONS.hamburger}</div>
          <div class="side-label">Functions</div>
        </div>
      </div>
      <div class="last-message">${this._lastMessage || ""}</div>
    `;
  }

  _renderZones() {
    if (!this.config.zones.length) {
      return `<div class="empty-msg">No zones configured</div>`;
    }
    return `
      <div class="zone-list">
        ${this.config.zones.map((z, i) => {
          const zs = this._hass.states[z.entity];
          const isOpen = zs?.state === "on";
          return `
            <div class="row" data-zone-index="${i}">
              <div class="row-left">
                <div class="dot ${isOpen ? "open" : ""}"></div>
                <span class="row-name">${z.name || zs?.attributes?.friendly_name || z.entity}</span>
              </div>
              <span class="row-state">${isOpen ? "Open" : "Closed"}</span>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  _renderHistory() {
    if (this._historyLoading || !this._historyItems) {
      return `<div class="empty-msg">Loading…</div>`;
    }
    if (!this._historyItems.length) {
      return `<div class="empty-msg">No recent events</div>`;
    }
    return `
      <div class="history-list">
        ${this._historyItems.map((h) => {
          const t = new Date(h.when);
          const time = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          return `
            <div class="history-row">
              <span class="history-time">${time}</span>
              <span class="history-msg">${h.name ? h.name + " " : ""}${h.message || ""}</span>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  _renderOverlay() {
    if (this._overlay === "arm-select") {
      return `
        <div class="overlay">
          <div class="overlay-close" id="overlay-close">${ICONS.close}</div>
          <div class="overlay-title">Arm System</div>
          <div class="arm-choice-btns">
            ${this.config.arm_modes.map((m) => `<div class="arm-choice-btn" data-mode="${m}">${m.replace("_", " ")}</div>`).join("")}
          </div>
        </div>
      `;
    }
    if (this._overlay === "keypad") {
      return `
        <div class="overlay">
          <div class="overlay-close" id="overlay-close">${ICONS.close}</div>
          <div class="pin-dots ${this._error ? "error" : ""}">
            ${Array.from({ length: this.config.code_length }).map((_, i) =>
              `<div class="pin-dot ${i < this._enteredCode.length ? "filled" : ""}"></div>`
            ).join("")}
          </div>
          <div class="keypad-error">${this._error ? "INCORRECT CODE" : ""}</div>
          <div class="keypad">
            ${[1,2,3,4,5,6,7,8,9].map((n) => `<div class="key" data-digit="${n}">${n}</div>`).join("")}
            <div class="key fn" id="keypad-clear">${ICONS.close}</div>
            <div class="key" data-digit="0">0</div>
            <div class="key fn" id="keypad-backspace">${ICONS.backspace}</div>
          </div>
        </div>
      `;
    }
    if (this._overlay === "emergency") {
      return `
        <div class="overlay">
          <div class="overlay-close" id="overlay-close">${ICONS.close}</div>
          <div class="overlay-title">Send Panic Alert?</div>
          <div class="arm-choice-btns">
            <div class="arm-choice-btn danger" id="emergency-confirm">Trigger Alarm</div>
          </div>
        </div>
      `;
    }
    if (this._overlay === "functions") {
      return `
        <div class="overlay">
          <div class="overlay-close" id="overlay-close">${ICONS.close}</div>
          <div class="overlay-title">Functions</div>
          ${this.config.lock ? `
            <div class="row" id="lock-row" style="width:220px;">
              <div class="row-left">
                <span class="lock-icon ${this._hass.states[this.config.lock.entity]?.state === "locked" ? "locked" : "unlocked"}">
                  ${this._hass.states[this.config.lock.entity]?.state === "locked" ? ICONS.lockClosed : ICONS.lockOpen}
                </span>
                <span class="row-name">${this.config.lock.name || "Door Lock"}</span>
              </div>
              <span class="row-state">${this._hass.states[this.config.lock.entity]?.state || ""}</span>
            </div>
          ` : `<div class="empty-msg">No functions configured</div>`}
        </div>
      `;
    }
    return "";
  }

  _css(ring, pending, triggered) {
    return `
      :host { display: block; }
      ha-card {
        background: #000;
        color: #fff;
        font-family: var(--paper-font-body1_-_font-family, "Segoe UI", sans-serif);
        border-radius: var(--ha-card-border-radius, 12px);
        overflow: hidden;
        position: relative;
      }
      .titlebar {
        text-align: center;
        font-size: 22px;
        font-weight: 400;
        padding: 18px 0 14px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
      }
      .tabs {
        display: flex;
        justify-content: center;
        gap: 40px;
        background: rgba(255,255,255,0.04);
        padding: 14px 0;
        border-bottom: 1px solid rgba(255,255,255,0.06);
      }
      .tab {
        font-size: 15px;
        color: rgba(255,255,255,0.45);
        cursor: pointer;
      }
      .tab.active { color: #fff; font-weight: 600; }
      .body { padding: 26px 20px 22px; min-height: 260px; }
      .status-text {
        text-align: center;
        font-size: 22px;
        margin-bottom: 26px;
      }
      .status-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 48px;
      }
      .side-btn { display: flex; flex-direction: column; align-items: center; cursor: pointer; width: 72px; }
      .side-icon {
        width: 64px; height: 64px; border-radius: 50%;
        background: rgba(255,255,255,0.08);
        display: flex; align-items: center; justify-content: center;
        margin-bottom: 8px;
      }
      .side-icon svg { width: 28px; height: 28px; fill: none; stroke: #fff; stroke-width: 0; }
      .side-icon svg path { fill: #fff; }
      .side-label { font-size: 13px; color: rgba(255,255,255,0.85); }
      .ring-btn {
        width: 176px;
        height: 176px;
        border-radius: 50%;
        border: 5px solid ${ring};
        background: rgba(255,255,255,0.05);
        display: flex; align-items: center; justify-content: center;
        cursor: pointer;
        flex-shrink: 0;
        ${pending ? "animation: pulse 1.1s ease-in-out infinite;" : ""}
        ${triggered ? "animation: flash 0.6s ease-in-out infinite;" : ""}
      }
      @keyframes pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(255,167,38,0.35); }
        50% { box-shadow: 0 0 0 12px rgba(255,167,38,0); }
      }
      @keyframes flash {
        0%, 100% { border-color: #e53935; }
        50% { border-color: #7a1f1c; }
      }
      .ring-btn svg { width: 60px; height: 60px; fill: #fff; }
      .last-message { text-align: center; font-size: 15px; color: rgba(255,255,255,0.75); margin-top: 26px; }
      .empty-msg { text-align: center; color: rgba(255,255,255,0.4); padding: 40px 0; }

      .zone-list, .history-list { display: flex; flex-direction: column; }
      .row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 4px; cursor: pointer;
      }
      .row:hover { background: rgba(255,255,255,0.04); }
      .row-left { display: flex; align-items: center; gap: 10px; }
      .row-name { font-size: 15px; }
      .row-state { font-size: 12px; opacity: 0.55; text-transform: uppercase; }
      .dot { width: 10px; height: 10px; border-radius: 50%; background: #4caf1c; flex-shrink: 0; }
      .dot.open { background: #e53935; }
      .lock-icon svg { width: 24px; height: 24px; }
      .lock-icon.locked svg { fill: #4caf1c; }
      .lock-icon.unlocked svg { fill: #e53935; }

      .history-row { display: flex; gap: 14px; padding: 9px 4px; border-bottom: 1px solid rgba(255,255,255,0.05); }
      .history-time { font-size: 12px; opacity: 0.5; width: 52px; flex-shrink: 0; }
      .history-msg { font-size: 14px; }

      .overlay {
        position: absolute; inset: 0;
        background: rgba(0,0,0,0.97);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 20px; z-index: 5;
      }
      .overlay-close { position: absolute; top: 14px; right: 14px; cursor: pointer; opacity: 0.6; }
      .overlay-close svg { width: 22px; height: 22px; fill: #fff; }
      .overlay-title { font-size: 15px; letter-spacing: 0.5px; opacity: 0.75; margin-bottom: 18px; }
      .arm-choice-btns { display: flex; gap: 12px; }
      .arm-choice-btn {
        padding: 14px 22px; border-radius: 10px;
        background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18);
        color: #fff; font-size: 14px; font-weight: 600; letter-spacing: 0.5px;
        cursor: pointer; text-transform: capitalize;
      }
      .arm-choice-btn.danger { background: rgba(229,57,53,0.25); border-color: #e53935; }
      .arm-choice-btn:active { background: rgba(255,255,255,0.18); }
      .pin-dots { display: flex; gap: 10px; margin-bottom: 20px; height: 14px; }
      .pin-dot { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,0.5); }
      .pin-dot.filled { background: #fff; }
      .pin-dots.error .pin-dot { border-color: #e53935; background: #e53935; }
      .keypad-error { color: #e53935; font-size: 12px; margin-bottom: 10px; height: 14px; }
      .keypad { display: grid; grid-template-columns: repeat(3, 56px); gap: 12px; }
      .key {
        width: 56px; height: 56px; border-radius: 50%;
        background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
        color: #fff; font-size: 20px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; user-select: none;
      }
      .key:active { background: rgba(255,255,255,0.2); }
      .key.fn svg { width: 20px; height: 20px; fill: #fff; opacity: 0.7; }
    `;
  }

  _attachListeners() {
    const root = this.shadowRoot;
    root.querySelectorAll("[data-tab]").forEach((el) => {
      el.addEventListener("click", () => this._setTab(el.getAttribute("data-tab")));
    });
    root.getElementById("ring-btn")?.addEventListener("click", () => this._ringTap());
    root.getElementById("emergency-btn")?.addEventListener("click", () => {
      this._overlay = "emergency";
      this._render();
    });
    root.getElementById("functions-btn")?.addEventListener("click", () => {
      this._overlay = "functions";
      this._render();
    });
    root.getElementById("emergency-confirm")?.addEventListener("click", () => this._triggerEmergency());
    root.getElementById("overlay-close")?.addEventListener("click", () => this._closeOverlay());
    root.getElementById("lock-row")?.addEventListener("click", () => this._toggleLock(this.config.lock.entity));
    root.getElementById("keypad-backspace")?.addEventListener("click", () => this._keypadBackspace());
    root.getElementById("keypad-clear")?.addEventListener("click", () => this._closeOverlay());

    root.querySelectorAll("[data-mode]").forEach((el) => {
      el.addEventListener("click", () => {
        const mode = el.getAttribute("data-mode");
        this._startAction(ARM_SERVICE[mode]);
      });
    });
    root.querySelectorAll("[data-digit]").forEach((el) => {
      el.addEventListener("click", () => this._keypadPress(el.getAttribute("data-digit")));
    });
    root.querySelectorAll("[data-zone-index]").forEach((el) => {
      el.addEventListener("click", () => {
        const idx = parseInt(el.getAttribute("data-zone-index"), 10);
        this._moreInfo(this.config.zones[idx].entity);
      });
    });
  }
}

customElements.define("smart-alarm-card", SmartAlarmCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "smart-alarm-card",
  name: "Smart Alarm Card",
  description: "A Control4-style security panel card with Status/Zones/History tabs, Emergency and Functions buttons, and an on-card PIN keypad.",
});
