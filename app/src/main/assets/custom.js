// === PakePlus 专业版授权系统（多应用独立授权版）===

console.log(
    '%cPakePlus Professional Auth System (Multi-App Independent)',
    'color:#4caf50;font-weight:bold;font-size:16px'
);

/* --------------------- 配置区域 --------------------- */
// 每个应用需要修改这里的配置
const APP_CONFIG = {
    // 应用标识符，每个应用需要设置不同的值
    appId: "TR_Locator", // 修改为唯一的应用ID，如：pakeplus_app_1, pakeplus_app_2 等
    
    // 应用名称，用于显示在授权界面
    appName: "TR_Locator", // 修改为实际的应用名称
    
    // 应用密钥种子，每个应用不同（重要！）
    appSecret: "TR_Locator_app_1_secret_2025", // 修改为每个应用唯一的密钥种子
    
    // 可选：自定义数据库名称（通常不需要修改）
    dbName: "pakeplus_auth_db"
};

/* --------------------- 工具函数 --------------------- */

// 生成 UUID
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    }).toUpperCase();
}

// IndexedDB 写入
function saveToIndexedDB(key, value) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(APP_CONFIG.dbName, 1);
        req.onerror = () => reject(req.error);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains("kv")) {
                req.result.createObjectStore("kv");
            }
        };
        req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction("kv", "readwrite");
            tx.onerror = () => reject(tx.error);
            tx.objectStore("kv").put(value, key);
            tx.oncomplete = resolve;
        };
    });
}

// IndexedDB 读取
function readFromIndexedDB(key) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(APP_CONFIG.dbName, 1);
        req.onerror = () => reject(req.error);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains("kv")) {
                req.result.createObjectStore("kv");
            }
        };
        req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction("kv", "readonly");
            tx.onerror = () => reject(tx.error);
            const getReq = tx.objectStore("kv").get(key);
            getReq.onsuccess = () => resolve(getReq.result);
        };
    });
}

/* --------------------- 方案A核心：稳定设备ID --------------------- */

async function getStableDeviceId() {
    const deviceIdKey = "stable_device_id"; // 设备ID保持统一，所有应用共用
    
    // ============ 1. 尝试 Electron 的 machineId ============
    let machineId = null;
    try {
        if (window.require) {
            const { machineIdSync } = window.require("node-machine-id");
            machineId = machineIdSync(true); // hashed machine GUID
            if (machineId) {
                console.log("💻 Using system machineId:", machineId);
                localStorage.setItem(deviceIdKey, machineId);
                await saveToIndexedDB(deviceIdKey, machineId);
                return machineId;
            }
        }
    } catch (e) {
        console.warn("machineId unavailable:", e);
    }

    // ============ 2. localStorage ============
    let idLocal = localStorage.getItem(deviceIdKey);
    if (idLocal) {
        console.log("📦 Using localStorage deviceId:", idLocal);
        return idLocal;
    }

    // ============ 3. IndexedDB 备份 ============
    let idDB = await readFromIndexedDB(deviceIdKey);
    if (idDB) {
        console.log("💾 Restored deviceId from IndexedDB:", idDB);
        localStorage.setItem(deviceIdKey, idDB);
        return idDB;
    }

    // ============ 4. 生成新的 UUID ============
    let newId = "DID-" + generateUUID();
    console.log("🆕 Generated new deviceId:", newId);

    // 保存（双备份）
    localStorage.setItem(deviceIdKey, newId);
    await saveToIndexedDB(deviceIdKey, newId);

    return newId;
}

/* --------------------- 授权系统 --------------------- */

const MACAuthSystem = {
    // 使用应用特定的密钥
    get secretKey() {
        return APP_CONFIG.appSecret;
    },

    async init() {
        console.log(`🚀 Initializing ${APP_CONFIG.appName} Auth (Multi-App Independent)`);

        this.deviceId = await getStableDeviceId();
        console.log("🔑 Final Device ID:", this.deviceId);

        const ok = this.checkAuth();
        if (!ok) {
            this.showAuthInterface();
            return false;
        }
        return true;
    },

    // 检查授权状态
    checkAuth() {
        const authKey = `${APP_CONFIG.appId}_auth`; // 应用特定的授权键名
        let auth = localStorage.getItem(authKey);
        if (!auth) return false;

        try {
            auth = JSON.parse(auth);
            if (!auth.authorized) return false;
            if (auth.deviceId !== this.deviceId) return false;

            const expire = auth.timestamp + auth.expireDays * 86400000;
            if (Date.now() > expire) {
                console.log("⚠ 授权已过期");
                return false;
            }

            console.log("✅ 授权有效");
            return true;

        } catch (e) {
            return false;
        }
    },

    // 验证密钥
    validateLicense(licenseKey) {
        if (!licenseKey.startsWith(`PLUS-${APP_CONFIG.appId}-`)) return false;
        const parts = licenseKey.split("-");
        if (parts.length !== 5) return false;

        // 格式：PLUS-{appId}-{timestamp}-{days}-{hash}
        const appIdPart = parts[1];
        const timestamp = parseInt(parts[2]);
        const expireDays = parseInt(parts[3]);
        const hash = parts[4];

        // 检查应用ID是否匹配
        if (appIdPart !== APP_CONFIG.appId) return false;

        const expected = this.generateHash(this.deviceId, timestamp, expireDays);

        return {
            valid: hash === expected,
            expireDays
        };
    },

    generateHash(deviceId, ts, days) {
        // 使用应用特定的密钥生成哈希
        const data = deviceId + "-" + ts + "-" + days + "-" + this.secretKey;

        let h = 0;
        for (let i = 0; i < data.length; i++)
            h = (h << 5) - h + data.charCodeAt(i);

        return Math.abs(h).toString(36).toUpperCase().substring(0, 12);
    },

    // 显示授权界面
    showAuthInterface() {
        // 创建授权界面
        const authContainer = document.createElement('div');
        authContainer.id = 'pakeplus-auth-container';
        authContainer.innerHTML = `
            <div class="auth-overlay">
                <div class="auth-modal">
                    <div class="auth-header">
                        <h2>🔐 ${APP_CONFIG.appName} 授权验证</h2>
                        <p>请使用设备标识码获取 <strong>${APP_CONFIG.appName}</strong> 的授权密钥</p>
                    </div>
                    
                    <div class="app-info-section">
                        <div class="app-info">
                            <strong>应用ID:</strong> ${APP_CONFIG.appId}
                        </div>
                    </div>
                    
                    <div class="device-id-section">
                        <label>设备标识码：</label>
                        <div class="device-id-display">
                            <span id="device-id-text">${this.deviceId}</span>
                            <button id="copy-device-id" class="copy-btn" title="复制设备标识码">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                </svg>
                            </button>
                        </div>
                        <div class="device-id-hint">
                            <small>请复制此设备标识码发送给管理员获取 <strong>${APP_CONFIG.appName}</strong> 的授权密钥</small>
                        </div>
                    </div>
                    
                    <div class="license-input-section">
                        <label for="license-input">${APP_CONFIG.appName} 授权密钥</label>
                        <div class="input-group">
                            <input type="text" id="license-input" placeholder="请输入 ${APP_CONFIG.appName} 的授权密钥" autocomplete="off">
                            <button id="verify-btn" class="verify-btn">验证授权</button>
                        </div>
                    </div>
                    
                    <div id="auth-message" class="auth-message"></div>
                    
                    <div class="auth-footer">
                        <p>如需获取 <strong>${APP_CONFIG.appName}</strong> 的授权密钥，请联系系统管理员</p>
                    </div>
                </div>
            </div>
        `;

        // 添加样式
        const style = document.createElement('style');
        style.textContent = `
            #pakeplus-auth-container {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 9999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            
            .auth-overlay {
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                align-items: center;
                justify-content: center;
                width: 100%;
                height: 100%;
                padding: 20px;
                box-sizing: border-box;
            }
            
            .auth-modal {
                background: white;
                border-radius: 12px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
                max-width: 500px;
                width: 100%;
                overflow: hidden;
            }
            
            .auth-header {
                background: linear-gradient(135deg, #4caf50, #45a049);
                color: white;
                padding: 25px 30px;
                text-align: center;
            }
            
            .auth-header h2 {
                margin: 0 0 8px 0;
                font-size: 24px;
                font-weight: 600;
            }
            
            .auth-header p {
                margin: 0;
                opacity: 0.9;
                font-size: 14px;
            }
            
            .app-info-section {
                padding: 15px 30px;
                background: #f8f9fa;
                border-bottom: 1px solid #eee;
            }
            
            .app-info {
                text-align: center;
                font-size: 13px;
                color: #333;
                font-weight: 500;
            }
            
            .device-id-section, .license-input-section {
                padding: 25px 30px;
                border-bottom: 1px solid #eee;
            }
            
            .device-id-section label, .license-input-section label {
                display: block;
                margin-bottom: 12px;
                font-weight: 800;
                color: #000000 !important; /* 强制纯黑色，提高对比度 */
                font-size: 18px;
                line-height: 1.5;
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
                z-index: 10000;
                position: relative;
                opacity: 1;
                background-color: #ffffff;
                padding: 8px 0;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
            }
            
            .device-id-display {
                display: flex;
                align-items: center;
                background: #1a1a1a;
                border: 2px solid #333;
                border-radius: 8px;
                padding: 15px;
                font-family: 'Monaco', 'Consolas', 'Courier New', monospace;
                font-size: 15px;
                font-weight: 600;
                color: #4caf50;
                letter-spacing: 0.5px;
            }
            
            #device-id-text {
                flex: 1;
                word-break: break-all;
                line-height: 1.4;
                text-shadow: 0 0 1px rgba(76, 175, 80, 0.3);
            }
            
            .device-id-hint {
                margin-top: 8px;
                text-align: center;
            }
            
            .device-id-hint small {
                color: #555;
                font-size: 13px;
                line-height: 1.4;
            }
            
            .copy-btn {
                background: #4caf50;
                border: none;
                color: white;
                cursor: pointer;
                padding: 8px;
                border-radius: 6px;
                margin-left: 12px;
                transition: all 0.2s;
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .copy-btn:hover {
                background: #45a049;
                transform: translateY(-1px);
            }
            
            .copy-btn:active {
                transform: translateY(0);
            }
            
            .input-group {
                display: flex;
                gap: 10px;
            }
            
            #license-input {
                flex: 1;
                padding: 12px 15px;
                border: 2px solid #ddd;
                border-radius: 8px;
                font-size: 15px;
                font-family: 'Monaco', 'Consolas', monospace;
                transition: all 0.2s;
                color: #222;
            }
            
            #license-input:focus {
                outline: none;
                border-color: #4caf50;
                box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.2);
            }
            
            #license-input::placeholder {
                color: #888;
            }
            
            .verify-btn {
                background: #4caf50;
                color: white;
                border: none;
                border-radius: 8px;
                padding: 0 24px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                white-space: nowrap;
                font-size: 15px;
            }
            
            .verify-btn:hover {
                background: #45a049;
                transform: translateY(-1px);
            }
            
            .verify-btn:active {
                transform: translateY(0);
            }
            
            .auth-message {
                padding: 0 30px 25px;
                min-height: 24px;
                text-align: center;
                font-weight: 500;
                font-size: 14px;
            }
            
            .auth-message.success {
                color: #28a745;
            }
            
            .auth-message.error {
                color: #dc3545;
            }
            
            .auth-footer {
                padding: 20px 30px;
                background: #f8f9fa;
                text-align: center;
                font-size: 13px;
                color: #555;
            }
            
            .auth-footer p {
                margin: 0;
                line-height: 1.5;
            }
            
            /* 提高所有文字对比度 */
            .auth-modal {
                color: #333;
            }
            
            strong {
                color: #222;
            }
            
            @media (max-width: 600px) {
                .auth-overlay {
                    padding: 10px;
                }
                
                .auth-header, .device-id-section, .license-input-section {
                    padding: 20px;
                }
                
                .device-id-display {
                    padding: 12px;
                    font-size: 14px;
                }
                
                .input-group {
                    flex-direction: column;
                }
                
                .verify-btn {
                    padding: 12px;
                    margin-top: 5px;
                }
                
                .copy-btn {
                    margin-left: 8px;
                    padding: 6px;
                }
                
                .device-id-section label, .license-input-section label {
                    font-size: 14px;
                }
            }
        `;
        
        
        document.head.appendChild(style);
        document.body.appendChild(authContainer);
        
        // 添加事件监听
        document.getElementById('copy-device-id').addEventListener('click', () => {
            const deviceIdText = document.getElementById('device-id-text').textContent;
            navigator.clipboard.writeText(deviceIdText).then(() => {
                const copyBtn = document.getElementById('copy-device-id');
                const originalHTML = copyBtn.innerHTML;
                copyBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                `;
                copyBtn.style.background = '#28a745';
                
                // 显示复制成功提示
                const messageEl = document.getElementById('auth-message');
                messageEl.textContent = "✅ 设备标识码已复制到剪贴板";
                messageEl.className = "auth-message success";
                
                setTimeout(() => {
                    copyBtn.innerHTML = originalHTML;
                    copyBtn.style.background = '#4caf50';
                    messageEl.textContent = "";
                    messageEl.className = "auth-message";
                }, 2000);
            }).catch(err => {
                console.error('复制失败:', err);
                const messageEl = document.getElementById('auth-message');
                messageEl.textContent = "❌ 复制失败，请手动选择复制";
                messageEl.className = "auth-message error";
            });
        });
        
        document.getElementById('license-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.verifyLicense();
            }
        });
        
        document.getElementById('verify-btn').addEventListener('click', () => {
            this.verifyLicense();
        });
        
        // 自动聚焦到授权密钥输入框
        setTimeout(() => {
            document.getElementById('license-input').focus();
        }, 500);
    },
    
    verifyLicense() {
        const licenseInput = document.getElementById('license-input');
        const messageEl = document.getElementById('auth-message');
        const key = licenseInput.value.trim();
        
        if (!key) {
            messageEl.textContent = "请输入授权密钥";
            messageEl.className = "auth-message error";
            licenseInput.focus();
            return;
        }
        
        const res = this.validateLicense(key);
        
        if (!res.valid) {
            messageEl.textContent = "授权密钥无效或不是本应用的密钥，请检查后重试";
            messageEl.className = "auth-message error";
            licenseInput.focus();
            licenseInput.select();
            return;
        }
        
        // 保存授权信息（使用应用特定的键名）
        const authKey = `${APP_CONFIG.appId}_auth`;
        localStorage.setItem(authKey, JSON.stringify({
            authorized: true,
            deviceId: this.deviceId,
            timestamp: Date.now(),
            expireDays: res.expireDays
        }));
        
        messageEl.textContent = "✅ 授权成功！应用即将重新加载...";
        messageEl.className = "auth-message success";
        
        // 禁用按钮防止重复点击
        document.getElementById('verify-btn').disabled = true;
        document.getElementById('verify-btn').textContent = '授权成功...';
        document.getElementById('verify-btn').style.background = '#28a745';
        
        setTimeout(() => {
            location.reload();
        }, 1500);
    }
};

/* --------------------- 入口函数 --------------------- */

async function initializeApp() {
    const ok = await MACAuthSystem.init();
    if (ok) {
        console.log(`🎉 ${APP_CONFIG.appName} 授权成功，加载应用内容...`);
        loadApplicationContent(); // ← 你的应用内容
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeApp);
} else {
    initializeApp();
}

console.log(`📦 ${APP_CONFIG.appName} Auth System Ready`);