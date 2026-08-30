/**
 * Smart-Alarm-Card for Home Assistant
 * -----------------------------------------------------
 * A Home Assistant alarm card styled for a more modern looking security
 * panel: a dark title bar, Status / Zones / History tabs, a large
 * Arm/Disarm ring button, Emergency function, Lock buttons, and an
 * on-card PIN keypad.
 *
 * All icons are real Material Design Icons rendered via <ha-icon>,
 * which is already available globally inside the Home Assistant frontend.
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
 * entity: alarm_control_panel.house
 * name: Security System
 * require_code: true
 * code_length: 4
 * arm_modes:
 *   - away
 *   - home
 * zones:
 *   - entity: binary_sensor.reed1_front_door
 *     name: Front Door
 *     type: door
 *     icon: mdi:door
 *   - entity: binary_sensor.pir1_living_room
 *     name: Living Room
 *     type: motion
 *     icon: mdi:motion-sensor
 * lock:
 *   entity: lock.garage_door_lock
 *   name: Garage Door Lock
 *   icon: mdi:garage
 */

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

// Icon shown on the ring button and in the arm-mode picker, per alarm state
const ARM_ICONS = {
  disarmed: "mdi:shield-off",
  armed_home: "mdi:shield-home",
  armed_away: "mdi:shield-lock",
  armed_night: "mdi:shield-moon",
  armed_vacation: "mdi:shield-airplane",
  armed_custom_bypass: "mdi:shield-check",
  triggered: "mdi:shield-alert",
  pending: "mdi:shield-refresh",
  arming: "mdi:shield-refresh",
  disarming: "mdi:shield-refresh",
};

// Same icons, keyed by the arm_modes config values (home/away/night/vacation/custom_bypass)
const ARM_MODE_ICONS = {
  home: "mdi:shield-home",
  away: "mdi:shield-lock",
  night: "mdi:shield-moon",
  vacation: "mdi:shield-airplane",
  custom_bypass: "mdi:shield-check",
};

// Default icon + active/inactive labels per zone type (used as a fallback only ---
// the entity's own icon / device_class is preferred, see _zoneIcon())
const ZONE_TYPES = {
  door: { icon: "mdi:door", activeLabel: "Open", inactiveLabel: "Closed" },
  window: { icon: "mdi:window-closed-variant", activeLabel: "Open", inactiveLabel: "Closed" },
  motion: { icon: "mdi:motion-sensor", activeLabel: "Motion", inactiveLabel: "Clear" },
};

// Mirrors Home Assistant's default binary_sensor device_class icons (on/off)
const DEVICE_CLASS_ICONS = {
  door: { on: "mdi:door-open", off: "mdi:door-closed" },
  garage_door: { on: "mdi:garage-open", off: "mdi:garage" },
  window: { on: "mdi:window-open", off: "mdi:window-closed" },
  opening: { on: "mdi:door-open", off: "mdi:door-closed" },
  motion: { on: "mdi:motion-sensor", off: "mdi:motion-sensor-off" },
  moving: { on: "mdi:arrow-right", off: "mdi:stop" },
  occupancy: { on: "mdi:home", off: "mdi:home-outline" },
  presence: { on: "mdi:home", off: "mdi:home-outline" },
  safety: { on: "mdi:alert", off: "mdi:check-circle" },
  smoke: { on: "mdi:smoke-detector-variant-alert", off: "mdi:smoke-detector-variant" },
  gas: { on: "mdi:alert-circle", off: "mdi:check-circle" },
  vibration: { on: "mdi:vibrate", off: "mdi:crop-portrait" },
  lock: { on: "mdi:lock-open-outline", off: "mdi:lock-outline" },
};

function ha(iconStr, opts = {}) {
  const size = opts.size || 24;
  const color = opts.color || "currentColor";
  const extra = opts.style || "";
  return `<ha-icon icon="${iconStr}" style="--mdc-icon-size:${size}px; color:${color}; ${extra}"></ha-icon>`;
}

class SmartAlarmCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tab = "status"; // status | zones | history
    this._overlay = null; // null | 'arm-select' | 'keypad' | 'emergency' | 'locks' | 'lock-confirm'
    this._pickerMode = null; // 'arm' | 'disarm' — which tiles the arm-select overlay shows
    this._pendingLock = null; // entity_id awaiting lock/unlock confirmation
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
      zones: (config.zones || []).map((z) => ({ type: "door", ...z })),
      lock: config.lock || null,
      ...config,
    };
  }

  set hass(hass) {
    const prevHass = this._hass;
    const prev = prevHass ? prevHass.states[this.config.entity] : undefined;
    this._hass = hass;
    const cur = this._stateObj();
    if (prev && cur && prev.state !== cur.state) {
      this._lastMessage = `State is now: ${cur.state.toUpperCase()}`;
    }
    if (!this._relevantStateChanged(prevHass, hass)) return;
    this._render();
  }

  // HA replaces a state object's reference only when that entity actually
  // changes, so a reference check here is a cheap way to skip re-rendering
  // (and rebuilding the whole shadow DOM) on unrelated state updates.
  _relevantStateChanged(prevHass, hass) {
    if (!prevHass) return true;
    const entities = [this.config.entity, ...this.config.zones.map((z) => z.entity)];
    if (this.config.lock) entities.push(this.config.lock.entity);
    return entities.some((id) => prevHass.states[id] !== hass.states[id]);
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

  _ringIcon(state) {
    return ARM_ICONS[state] || "mdi:shield-outline";
  }

  // Resolve a zone's icon: explicit config override > the entity's own icon
  // (respects any custom icon set in HA) > device_class default > type default.
  _zoneIcon(zone, stateObj, isActive) {
    if (zone.icon) return zone.icon;
    if (stateObj?.attributes?.icon) return stateObj.attributes.icon;
    const deviceClass = stateObj?.attributes?.device_class;
    const dcIcons = DEVICE_CLASS_ICONS[deviceClass];
    if (dcIcons) return isActive ? dcIcons.on : dcIcons.off;
    const typeInfo = ZONE_TYPES[zone.type] || ZONE_TYPES.door;
    return typeInfo.icon;
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
        this._pickerMode = "arm";
        this._overlay = "arm-select";
        this._render();
      }
    } else {
      this._pickerMode = "disarm";
      this._overlay = "arm-select";
      this._render();
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

  _confirmLock(entityId) {
    this._pendingLock = entityId;
    this._overlay = "lock-confirm";
    this._render();
  }

  _toggleLockConfirmed() {
    const entityId = this._pendingLock;
    if (!entityId) return;
    const lockState = this._hass.states[entityId]?.state;
    this._hass.callService("lock", lockState === "locked" ? "unlock" : "lock", {
      entity_id: entityId,
    });
    this._pendingLock = null;
    this._closeOverlay();
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
    const pending = state === "pending" || state === "arming" || state === "disarming";
    const triggered = state === "triggered";

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
          ${this._tab === "status" ? this._renderStatus(state, ring) : ""}
          ${this._tab === "zones" ? this._renderZones() : ""}
          ${this._tab === "history" ? this._renderHistory() : ""}
        </div>
        ${this._overlay ? this._renderOverlay() : ""}
      </ha-card>
    `;
    this._attachListeners();
  }

  _renderStatus(state, ring) {
    return `
      <div class="status-text" style="color:${ring}">${this._statusText(state)}</div>
      <div class="status-row">
        <div class="side-btn" id="emergency-btn">
          <div class="side-icon">${ha("mdi:alert-octagon-outline", { size: 28 })}</div>
          <div class="side-label">Emergency</div>
        </div>

        <div class="ring-btn" id="ring-btn">${ha(this._ringIcon(state), { size: 56, color: ring })}</div>

        <div class="side-btn" id="locks-btn">
          <div class="side-icon">${ha("mdi:lock-outline", { size: 28 })}</div>
          <div class="side-label">Locks</div>
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
          const typeInfo = ZONE_TYPES[z.type] || ZONE_TYPES.door;
          const isActive = zs?.state === "on";
          const icon = this._zoneIcon(z, zs, isActive);
          const color = isActive ? "#e53935" : "#4caf1c";
          return `
            <div class="row" data-zone-index="${i}">
              <div class="row-left">
                ${ha(icon, { size: 22, color })}
                <span class="row-name">${z.name || zs?.attributes?.friendly_name || z.entity}</span>
              </div>
              <span class="row-state" style="color:${color}">${isActive ? typeInfo.activeLabel : typeInfo.inactiveLabel}</span>
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
      const isDisarm = this._pickerMode === "disarm";
      const tiles = isDisarm
        ? [{ mode: "disarm", label: "disarm", icon: ARM_ICONS.disarmed }]
        : this.config.arm_modes.map((m) => ({ mode: m, label: m.replace("_", " "), icon: ARM_MODE_ICONS[m] || "mdi:shield-lock" }));
      return `
        <div class="overlay">
          <div class="overlay-close" id="overlay-close">${ha("mdi:close", { size: 22 })}</div>
          <div class="overlay-title">${isDisarm ? "Disarm System" : "Arm System"}</div>
          <div class="arm-choice-btns">
            ${tiles.map((t) => `
              <div class="arm-choice-btn ${isDisarm ? "tile-disarm" : "tile-arm"}" data-mode="${t.mode}">
                ${ha(t.icon, { size: 26, color: isDisarm ? "#4caf1c" : "#e53935" })}
                <span>${t.label}</span>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    }
    if (this._overlay === "keypad") {
      return `
        <div class="overlay">
          <div class="overlay-close" id="overlay-close">${ha("mdi:close", { size: 22 })}</div>
          <div class="pin-dots ${this._error ? "error" : ""}">
            ${Array.from({ length: this.config.code_length }).map((_, i) =>
              `<div class="pin-dot ${i < this._enteredCode.length ? "filled" : ""}"></div>`
            ).join("")}
          </div>
          <div class="keypad-error">${this._error ? "INCORRECT CODE" : ""}</div>
          <div class="keypad">
            ${[1,2,3,4,5,6,7,8,9].map((n) => `<div class="key" data-digit="${n}">${n}</div>`).join("")}
            <div class="key fn" id="keypad-clear">${ha("mdi:close-circle-outline", { size: 20 })}</div>
            <div class="key" data-digit="0">0</div>
            <div class="key fn" id="keypad-backspace">${ha("mdi:backspace-outline", { size: 20 })}</div>
          </div>
        </div>
      `;
    }
    if (this._overlay === "emergency") {
      return `
        <div class="overlay">
          <div class="overlay-close" id="overlay-close">${ha("mdi:close", { size: 22 })}</div>
          <div class="overlay-title">Send Panic Alert?</div>
          <div class="arm-choice-btns">
            <div class="arm-choice-btn danger" id="emergency-confirm">Trigger Alarm</div>
          </div>
        </div>
      `;
    }
    if (this._overlay === "locks") {
      return `
        <div class="overlay">
          <div class="overlay-close" id="overlay-close">${ha("mdi:close", { size: 22 })}</div>
          <div class="overlay-title">Locks</div>
          ${this.config.lock ? `
            <div class="row" id="lock-row" style="width:220px;">
              <div class="row-left">
                ${(() => {
                  const locked = this._hass.states[this.config.lock.entity]?.state === "locked";
                  const icon = this.config.lock.icon || (locked ? "mdi:lock-outline" : "mdi:lock-open-outline");
                  const color = locked ? "#4caf1c" : "#e53935";
                  return ha(icon, { size: 24, color });
                })()}
                <span class="row-name">${this.config.lock.name || "Door Lock"}</span>
              </div>
              <span class="row-state">${this._hass.states[this.config.lock.entity]?.state || ""}</span>
            </div>
          ` : `<div class="empty-msg">No locks configured</div>`}
        </div>
      `;
    }
    if (this._overlay === "lock-confirm") {
      const entityId = this._pendingLock;
      const locked = this._hass.states[entityId]?.state === "locked";
      const action = locked ? "Unlock" : "Lock";
      const name = this.config.lock?.name || "this lock";
      const icon = locked ? "mdi:lock-open-outline" : "mdi:lock-outline";
      return `
        <div class="overlay">
          <div class="overlay-close" id="overlay-close">${ha("mdi:close", { size: 22 })}</div>
          <div class="overlay-title">${action} ${name}?</div>
          <div class="arm-choice-btns">
            <div class="arm-choice-btn danger" id="lock-confirm-btn">
              ${ha(icon, { size: 24 })}
              <span>${action}</span>
            </div>
          </div>
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
        color: #fff;
      }
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
        color: #fff;
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
      .last-message { text-align: center; font-size: 15px; color: rgba(255,255,255,0.75); margin-top: 26px; }
      .empty-msg { text-align: center; color: rgba(255,255,255,0.4); padding: 40px 0; }

      .zone-list, .history-list { display: flex; flex-direction: column; }
      .row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 4px; cursor: pointer;
      }
      .row:hover { background: rgba(255,255,255,0.04); }
      .row-left { display: flex; align-items: center; gap: 12px; }
      .row-name { font-size: 15px; }
      .row-state { font-size: 12px; opacity: 0.85; text-transform: uppercase; }

      .history-row { display: flex; gap: 14px; padding: 9px 4px; border-bottom: 1px solid rgba(255,255,255,0.05); }
      .history-time { font-size: 12px; opacity: 0.5; width: 52px; flex-shrink: 0; }
      .history-msg { font-size: 14px; }

      .overlay {
        position: absolute; inset: 0;
        background: rgba(0,0,0,0.97);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 20px; z-index: 5;
      }
      .overlay-close { position: absolute; top: 14px; right: 14px; cursor: pointer; opacity: 0.6; color: #fff; }
      .overlay-title { font-size: 15px; letter-spacing: 0.5px; opacity: 0.75; margin-bottom: 18px; }
      .arm-choice-btns { display: flex; gap: 14px; }
      .arm-choice-btn {
        display: flex; flex-direction: column; align-items: center; gap: 8px;
        padding: 16px 20px; border-radius: 12px; min-width: 84px;
        background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18);
        color: #fff; font-size: 13px; font-weight: 600; letter-spacing: 0.5px;
        cursor: pointer; text-transform: capitalize;
      }
      .arm-choice-btn.danger { background: rgba(229,57,53,0.25); border-color: #e53935; flex-direction: row; }
      .arm-choice-btn.tile-arm { background: rgba(229,57,53,0.18); border-color: #e53935; }
      .arm-choice-btn.tile-disarm { background: rgba(76,175,28,0.18); border-color: #4caf1c; }
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
      .key.fn { opacity: 0.7; }
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
    root.getElementById("locks-btn")?.addEventListener("click", () => {
      this._overlay = "locks";
      this._render();
    });
    root.getElementById("emergency-confirm")?.addEventListener("click", () => this._triggerEmergency());
    root.getElementById("overlay-close")?.addEventListener("click", () => this._closeOverlay());
    root.getElementById("lock-row")?.addEventListener("click", () => this._confirmLock(this.config.lock.entity));
    root.getElementById("lock-confirm-btn")?.addEventListener("click", () => this._toggleLockConfirmed());
    root.getElementById("keypad-backspace")?.addEventListener("click", () => this._keypadBackspace());
    root.getElementById("keypad-clear")?.addEventListener("click", () => this._closeOverlay());

    root.querySelectorAll("[data-mode]").forEach((el) => {
      el.addEventListener("click", () => {
        const mode = el.getAttribute("data-mode");
        if (mode === "disarm") {
          this._startAction("alarm_disarm");
        } else {
          this._startAction(ARM_SERVICE[mode]);
        }
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
  description: "A Home Assistant alarm card styled for a more modern looking security panel, featuring a dark title bar, Status/Zones/History tabs, a large Arm/Disarm ring button, Emergency function, Lock buttons, and an on-card PIN keypad.",
});
