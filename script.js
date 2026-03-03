    // --- Data & State (RAM Only) ---
    // لا يتم تحميل أي شيء من LocalStorage يتعلق بالبيانات
    let accounts = []; 
    let folders = ["عام"];
    
    let longPressTimer, isLongPress = false;
    let currentCtxId = null, currentCtxType = null;
    let pendingCallback = null;
    let activeFolder = 'All'; 
    let isSelectionMode = false;
    let selectedIds = new Set();
    let isMoveAction = false; 
    let folderRenameTarget = null;
    let vaultPressTimer = null;
    let saveTimeout = null;

    // --- Google API Config ---
    const GOOGLE_CLIENT_ID = '979816526016-ukb9vqtb6u2hlutombpf8rumbjr3o2ua.apps.googleusercontent.com';
    const SCOPES = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile';
    const FILENAME = 'secret_vault_unified.json';
    let tokenClient;
    // نحتفظ برمز الدخول لتجنب ظهور شاشة الدخول عند التحديث
    let gAccessToken = localStorage.getItem('gAccessToken');

    // --- Auth Functions ---
    function initGoogleLib() {
        if(window.google) {
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: GOOGLE_CLIENT_ID, scope: SCOPES,
                callback: (resp) => {
                    if (resp.access_token) {
                        gAccessToken = resp.access_token;
                        localStorage.setItem('gAccessToken', gAccessToken);
                        document.getElementById('loginOverlay').style.display = 'none';
                        showToast("تم الدخول ✅");
                        checkGoogleLoginState();
                        fetchUserInfo();
                        forceSyncFromCloud(true); // جلب تلقائي عند الدخول
                    }
                }
            });
            
            // عند بدء التشغيل:
            if(gAccessToken) {
                // إذا كان الرمز موجوداً، اخفِ شاشة الدخول فوراً وابدأ المزامنة
                document.getElementById('loginOverlay').style.display = 'none';
                checkGoogleLoginState();
                fetchUserInfo();
                forceSyncFromCloud(true);
            } else {
                // إذا لم يكن مسجلاً، أظهر شاشة الدخول
                document.getElementById('loginOverlay').style.display = 'flex';
            }
        }
    }

    function startGoogleLogin() {
        document.getElementById('loginStatus').style.display = 'block';
        if(tokenClient) tokenClient.requestAccessToken();
    }

    function checkGoogleLoginState() {
        // لا حاجة لتغيير الأزرار، فالتطبيق لا يعمل بدون دخول
    }

    async function fetchUserInfo() {
        if(!gAccessToken) return;
        const localPic = localStorage.getItem('userPhotoVault');
        if(localPic) updateLogoutIcon(localPic);

        try {
            let res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { 'Authorization': `Bearer ${gAccessToken}` }
            });
            if(res.ok) {
                let data = await res.json();
                if(data.picture) {
                    localStorage.setItem('userPhotoVault', data.picture);
                    updateLogoutIcon(data.picture);
                }
            }
        } catch(e) {}
    }

    function updateLogoutIcon(url) {
        const area = document.getElementById('googleLogoutIcon');
        if(area) area.innerHTML = `<img src="${url}" class="user-profile-img" alt="User">`;
    }

    function handleGoogleLogout() {
        document.getElementById('mainMenu').style.display = 'none';
        customConfirm("سيتم مسح البيانات من الشاشة (تبقى في السحابة). خروج؟", () => {
            localStorage.removeItem('gAccessToken');
            localStorage.removeItem('userPhotoVault');
            localStorage.removeItem('appPass'); // Optional: Clear preferences
            localStorage.removeItem('vaultPass');
            gAccessToken = null;
            accounts = [];
            folders = ["عام"];
            document.getElementById('loginOverlay').style.display = 'flex';
            renderVault();
            showToast("تم تسجيل الخروج");
        });
    }

    // --- SYNC ENGINE ---
    
    function setSyncLoader(show) { document.getElementById('syncLoader').style.display = show ? 'inline-block' : 'none'; }

    function triggerAutoSave() {
        if(saveTimeout) clearTimeout(saveTimeout);
        setSyncLoader(true); 
        // تأخير بسيط لتجميع التعديلات السريعة
        saveTimeout = setTimeout(() => {
            forceUploadToDrive(true);
        }, 1500);
    }

    async function forceUploadToDrive(silent = false) {
        if(!gAccessToken) return;
        if(!silent) {
            document.getElementById('mainMenu').style.display = 'none';
            showToast("جاري الرفع...");
        }
        setSyncLoader(true);

        try {
            const q = `name = '${FILENAME}' and 'appDataFolder' in parents and trashed = false`;
            const searchResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=appDataFolder`, {
                headers: { 'Authorization': `Bearer ${gAccessToken}` }
            });

            if(searchResp.status === 401) {
                // إذا انتهت صلاحية الجلسة
                localStorage.removeItem('gAccessToken'); gAccessToken=null; 
                document.getElementById('loginOverlay').style.display = 'flex';
                return;
            }

            const data = await searchResp.json();
            let fileId = null;
            if(data.files && data.files.length > 0) fileId = data.files[0].id;

            const payload = { 
                accounts: accounts, 
                folders: folders,
                appPass: localStorage.getItem('appPass'),
                vaultPass: localStorage.getItem('vaultPass') 
            };
            const fileBlob = new Blob([JSON.stringify(payload)], { type: 'application/json' });

            if(fileId) {
                await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
                    method: 'PATCH',
                    headers: { 'Authorization': `Bearer ${gAccessToken}`, 'Content-Type': 'application/json' },
                    body: fileBlob
                });
            } else {
                const metadata = { name: FILENAME, mimeType: 'application/json', parents: ['appDataFolder'] };
                const form = new FormData();
                form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
                form.append('file', fileBlob);
                await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${gAccessToken}` },
                    body: form
                });
            }
            if(!silent) showToast("تم الحفظ سحابياً ✅");
        } catch(e) {
            console.error(e);
            if(!silent) showToast("فشل الرفع ❌");
        }
        setSyncLoader(false);
    }

    async function forceSyncFromCloud(silent = false) {
        if(!gAccessToken) return;
        if(!silent) document.getElementById('mainMenu').style.display = 'none';
        setSyncLoader(true);
        if(!silent) showToast("جاري جلب البيانات...");

        try {
            const q = `name = '${FILENAME}' and 'appDataFolder' in parents and trashed = false`;
            const searchResp = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=appDataFolder`, {
                headers: { 'Authorization': `Bearer ${gAccessToken}` }
            });
            
            if(searchResp.status === 401) {
                localStorage.removeItem('gAccessToken'); gAccessToken=null; 
                document.getElementById('loginOverlay').style.display = 'flex';
                return;
            }

            const data = await searchResp.json();
            if(data.files && data.files.length > 0) {
                const fileId = data.files[0].id;
                const fileResp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                    headers: { 'Authorization': `Bearer ${gAccessToken}` }
                });
                const cloudContent = await fileResp.json();
                
                if(cloudContent) {
                    if(cloudContent.accounts) accounts = cloudContent.accounts;
                    if(cloudContent.folders) folders = cloudContent.folders;
                    
                    if(cloudContent.appPass) localStorage.setItem('appPass', cloudContent.appPass);
                    if(cloudContent.vaultPass) localStorage.setItem('vaultPass', cloudContent.vaultPass);

                    renderVault();
                    if(!silent) showToast("تم التحديث من السحابة ✅");
                }
            } else {
                if(!silent) showToast("الخزنة السحابية فارغة ℹ️");
            }
        } catch(e) {
            console.error(e);
            if(!silent) showToast("فشل الجلب ❌");
        }
        setSyncLoader(false);
    }

    // --- Helper Functions ---
    function pushHistory(type = 'modal') { 
        window.history.pushState({modal: type}, null, ''); 
    }
    
    function goBack() { 
        if(window.history.state) {
            window.history.back();
            return;
        }
        const overlays = document.querySelectorAll('.overlay');
        let visible = false;
        overlays.forEach(o => { 
            if(o.classList.contains('show')) { 
                o.classList.remove('show'); 
                setTimeout(()=>o.style.display='none',200); 
                visible=true; 
            } 
        });
        
        if(!visible && document.getElementById('vaultPage').style.display === 'flex') {
            document.getElementById('vaultPage').style.display = 'none';
        }
    }
    
    window.onpopstate = () => {
        const overlays = document.querySelectorAll('.overlay');
        let closedModal = false;
        overlays.forEach(o => {
            if(o.classList.contains('show')) {
                o.classList.remove('show');
                setTimeout(()=>o.style.display='none', 200);
                closedModal = true;
            }
        });

        if(!closedModal) {
            const vault = document.getElementById('vaultPage');
            if(vault.style.display === 'flex') {
                vault.style.display = 'none';
            }
        }
        
        // منع إغلاق شاشة الدخول إذا لم يكن مسجلاً
        if(!gAccessToken && document.getElementById('loginOverlay').style.display === 'flex') {
             history.pushState(null, null, location.href);
        }
    };

    function showOverlay(id) {
        pushHistory();
        const el = document.getElementById(id);
        el.style.display = 'flex';
        el.offsetHeight; 
        el.classList.add('show');
    }

    // --- App Actions ---
    function submitPassword() {
        const val = document.getElementById('globalPassInput').value;
        const cb = pendingCallback;
        goBack(); 
        if(cb) { setTimeout(() => { cb(val); }, 200); }
        pendingCallback = null;
    }

    function prepareSaveAccount() {
        const email = document.getElementById('emailInput').value;
        const pass = document.getElementById('passInput').value;
        if (!email) { showToast("أدخل البيانات أولاً ⚠️"); return; }
        
        isMoveAction = false;
        openFolderSelectModal("حفظ في...");
    }

    function saveAccount(targetFolder) {
        const email = document.getElementById('emailInput').value;
        const pass = document.getElementById('passInput').value;
        
        accounts.unshift({ id: Date.now(), email, pass, folder: targetFolder });
        triggerAutoSave();

        document.getElementById('emailInput').value = '';
        document.getElementById('passInput').value = '';
        showToast("جاري الحفظ...");
        renderVault();
    }

    // --- Rendering ---
    function renderFoldersBar() {
        const bar = document.getElementById('foldersBar');
        bar.innerHTML = '';
        
        const totalCount = accounts.length;
        
        const allChip = document.createElement('div');
        allChip.className = `folder-chip ${activeFolder === 'All' ? 'active' : ''}`;
        allChip.innerHTML = `<span>الكل</span> <span dir="ltr">(${totalCount})</span>`;
        allChip.onclick = () => { activeFolder = 'All'; renderVault(); renderFoldersBar(); };
        bar.appendChild(allChip);

        folders.forEach(f => {
            const folderCount = accounts.filter(acc => acc.folder === f).length;
            
            const chip = document.createElement('div');
            chip.className = `folder-chip ${activeFolder === f ? 'active' : ''}`;
            chip.innerHTML = `<span>${f}</span> <span dir="ltr">(${folderCount})</span>`;
            chip.onclick = () => { activeFolder = f; renderVault(); renderFoldersBar(); };
            
            chip.onmousedown = () => startFolderPress(f);
            chip.ontouchstart = () => startFolderPress(f);
            chip.ontouchmove = cancelPress;
            chip.onmouseup = cancelPress;
            chip.ontouchend = cancelPress;
            bar.appendChild(chip);
        });
        const addBtn = document.createElement('div');
        addBtn.className = 'add-folder-btn';
        addBtn.innerText = '+';
        addBtn.onclick = () => openAddFolderModal();
        bar.appendChild(addBtn);
    }

    function renderVault() {
        const list = document.getElementById('vaultList');
        const searchVal = document.getElementById('searchInput').value.toLowerCase();
        list.innerHTML = '';
        
        let displayAccounts = accounts;
        if (activeFolder !== 'All') displayAccounts = displayAccounts.filter(acc => acc.folder === activeFolder);
        if(searchVal) displayAccounts = displayAccounts.filter(acc => (acc.email && acc.email.toLowerCase().includes(searchVal)) || (acc.pass && acc.pass.toLowerCase().includes(searchVal)));

        if(displayAccounts.length === 0) { list.innerHTML = '<p style="text-align:center;color:#ccc;margin-top:40px">لا توجد بيانات</p>'; return; }

        displayAccounts.forEach(acc => {
            const card = document.createElement('div');
            card.className = `account-card ${selectedIds.has(acc.id) ? 'selected-card' : ''}`;
            card.setAttribute('data-id', acc.id);
            
            const displayName = acc.email || "بدون عنوان";
            const displayPass = acc.pass || "...";

            let leftSide = '';
            if (isSelectionMode) {
                leftSide = `<div class="selection-check"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><polyline points="20 6 9 17 4 12"></polyline></svg></div>`;
            } else if (!searchVal && activeFolder !== 'All') {
                leftSide = `<div class="drag-handle-visible" onmousedown="initDrag(event)" ontouchstart="initDrag(event)"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg></div>`;
            } else {
                 leftSide = `<div style="width:24px; display:flex; justify-content:center"><div style="width:6px; height:6px; background:#e5e7eb; border-radius:50%"></div></div>`;
            }

            card.innerHTML = `
                ${leftSide}
                <div class="card-main" onclick="handleCardClick(event, ${acc.id})">
                    <div class="card-email" 
                         onmousedown="startPress('email', ${acc.id})" ontouchstart="startPress('email', ${acc.id})" 
                         ontouchmove="cancelPress()"
                         onmouseup="cancelPress()" ontouchend="cancelPress()">
                        <span>${displayName}</span>
                    </div>
                    <div id="pass-${acc.id}" class="card-pass-pill hidden-pass"
                        onmousedown="startPress('pass', ${acc.id})" ontouchstart="startPress('pass', ${acc.id})" 
                        ontouchmove="cancelPress()"
                        onmouseup="cancelPress()" ontouchend="cancelPress()">••••••••</div>
                </div>
            `;
            list.appendChild(card);
        });
    }

    // --- Interactive Logic ---
    function toggleSelectionMode() {
        isSelectionMode = !isSelectionMode;
        selectedIds.clear();
        const btn = document.getElementById('selectToggleBtn');
        const bottomBar = document.getElementById('bottomBar');
        if (isSelectionMode) {
            btn.classList.add('active');
            bottomBar.classList.add('visible');
            document.getElementById('selectedCount').innerText = "0 محدد";
        } else {
            btn.classList.remove('active');
            bottomBar.classList.remove('visible');
        }
        renderVault();
    }

    function deleteSelected() {
        if(selectedIds.size === 0) return;
        customConfirm(`هل أنت متأكد من حذف ${selectedIds.size} عنصر؟`, () => {
             accounts = accounts.filter(acc => !selectedIds.has(acc.id));
             triggerAutoSave();
             toggleSelectionMode(); 
             renderVault();
             renderFoldersBar();
             showToast("تم الحذف");
        });
    }

    function handleCardClick(e, id) {
        if (isSelectionMode) {
            if (selectedIds.has(id)) selectedIds.delete(id);
            else selectedIds.add(id);
            document.getElementById('selectedCount').innerText = selectedIds.size + " محدد";
            renderVault();
        } else {
            if(e.target.closest('.drag-handle-visible')) return;
            handlePassClick(id);
        }
    }

    function handlePassClick(id) {
        if(isLongPress) return;
        const el = document.getElementById(`pass-${id}`);
        const acc = accounts.find(a => a.id === id);
        if(el.classList.contains('hidden-pass')) {
             el.innerText = acc.pass || '...'; 
             el.classList.remove('hidden-pass');
             el.style.fontSize = "16px"; el.style.letterSpacing = "0";
        } else { 
            el.innerText = '••••••••'; 
            el.classList.add('hidden-pass'); 
            el.style.fontSize = "20px"; el.style.letterSpacing = "2px";
        }
    }

    // --- Folders & Modals ---
    function openFolderSelectModal(title) {
        showOverlay('folderSelectModal');
        document.getElementById('folderModalTitle').innerText = title;
        const listBody = document.getElementById('folderListModalBody');
        listBody.innerHTML = '';
        const addRow = document.createElement('div');
        addRow.className = 'folder-item-row';
        addRow.style.color = 'var(--primary)';
        addRow.innerText = '+ مجلد جديد';
        addRow.onclick = () => { goBack(); setTimeout(openAddFolderModal, 200); };
        listBody.appendChild(addRow);

        folders.forEach(f => {
            const row = document.createElement('div');
            row.className = 'folder-item-row';
            row.innerText = f;
            row.onclick = () => {
                goBack();
                if (isMoveAction) executeMove(f);
                else saveAccount(f);
            };
            listBody.appendChild(row);
        });
    }

    function openMoveModal() {
        if(selectedIds.size === 0) return;
        isMoveAction = true;
        openFolderSelectModal("نقل " + selectedIds.size + " عنصر إلى:");
    }

    function executeMove(targetFolder) {
        accounts.forEach(acc => { if(selectedIds.has(acc.id)) acc.folder = targetFolder; });
        triggerAutoSave();
        toggleSelectionMode(); activeFolder = targetFolder; renderFoldersBar(); renderVault();
        showToast("تم النقل ✅");
    }

    function openAddFolderModal(renameTarget = null) {
        folderRenameTarget = renameTarget;
        document.getElementById('addFolderTitle').innerText = renameTarget ? "تعديل المجلد" : "مجلد جديد";
        const input = document.getElementById('folderNameInput');
        input.value = renameTarget || '';
        showOverlay('addFolderModal');
        input.focus();
    }

    function submitFolder() {
        const name = document.getElementById('folderNameInput').value.trim();
        if(!name) return;
        if (folderRenameTarget) {
            const index = folders.indexOf(folderRenameTarget);
            if(index !== -1) folders[index] = name;
            accounts.forEach(acc => { if(acc.folder === folderRenameTarget) acc.folder = name; });
        } else {
            if(!folders.includes(name)) folders.push(name);
        }
        triggerAutoSave(); 
        goBack(); renderFoldersBar(); renderVault();
    }

    function startFolderPress(f) {
        isLongPress = false;
        longPressTimer = setTimeout(() => { isLongPress = true; if(f!=='عام') openAddFolderModal(f); }, 600);
    }

    // --- Drag n Drop Logic ---
    let draggingItem = null;
    function initDrag(e) {
        if(isSelectionMode) return;
        const handle = e.target.closest('.drag-handle-visible');
        if(!handle) return;
        draggingItem = handle.closest('.account-card');
        const list = document.getElementById('vaultList');
        
        list.addEventListener('mousemove', onDragMove);
        list.addEventListener('touchmove', onDragMove, {passive: false});
        document.addEventListener('mouseup', onDragEnd);
        document.addEventListener('touchend', onDragEnd);
        
        draggingItem.classList.add('dragging');
        if(navigator.vibrate) navigator.vibrate(20);
    }
    function onDragMove(e) {
        if(!draggingItem) return;
        e.preventDefault();
        const list = document.getElementById('vaultList');
        let clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
        const siblings = [...list.querySelectorAll('.account-card:not(.dragging)')];
        let nextSibling = siblings.find(sibling => clientY <= sibling.getBoundingClientRect().top + sibling.offsetHeight / 2);
        list.insertBefore(draggingItem, nextSibling);
    }
    function onDragEnd() {
        if(!draggingItem) return;
        draggingItem.classList.remove('dragging');
        draggingItem = null;
        document.removeEventListener('mouseup', onDragEnd);
        document.removeEventListener('touchend', onDragEnd);
        saveNewOrder();
    }
    function saveNewOrder() {
        const list = document.getElementById('vaultList');
        const cards = list.querySelectorAll('.account-card');
        
        const reorderedIds = [];
        cards.forEach(c => reorderedIds.push(Number(c.getAttribute('data-id'))));
        
        if(activeFolder !== 'All') {
            const folderItems = accounts.filter(a => a.folder === activeFolder);
            const sortedFolderItems = [];
            reorderedIds.forEach(id => {
                const item = folderItems.find(a => a.id === id);
                if(item) sortedFolderItems.push(item);
            });
            const otherItems = accounts.filter(a => a.folder !== activeFolder);
            accounts = [...sortedFolderItems, ...otherItems]; 
        } else {
             const newAccounts = [];
             reorderedIds.forEach(id => {
                 const acc = accounts.find(a => a.id === id);
                 if(acc) newAccounts.push(acc);
             });
             accounts = newAccounts;
        }

        triggerAutoSave();
    }

    // --- Context Menu ---
    function startPress(type, id) {
        isLongPress = false;
        longPressTimer = setTimeout(() => { isLongPress = true; openContextMenu(type, id); }, 600);
    }
    function cancelPress() { clearTimeout(longPressTimer); }

    function openContextMenu(type, id) {
        currentCtxId = id; currentCtxType = type;
        showOverlay('contextModal');
        if (navigator.vibrate) navigator.vibrate(50);
    }

    function ctxAction(action) {
        goBack();
        const acc = accounts.find(a => a.id === currentCtxId);
        setTimeout(() => {
            if (!acc) return;
            if (action === 'copy') copyToClipboard(currentCtxType === 'email' ? acc.email : acc.pass);
            else if (action === 'delete') {
                customConfirm("حذف نهائي؟", () => {
                    const idToDelete = currentCtxId; 
                    accounts = accounts.filter(a => a.id !== idToDelete);
                    triggerAutoSave();
                    renderVault();
                    renderFoldersBar();
                    showToast("تم الحذف");
                });
            } else if (action === 'edit') {
                document.getElementById('emailInput').value = acc.email;
                document.getElementById('passInput').value = acc.pass;
                accounts = accounts.filter(a => a.id !== currentCtxId);
                renderVault(); 
                if(document.getElementById('vaultPage').style.display==='flex') goBack();
                showToast("جاري التعديل... اضغط حفظ عند الانتهاء");
            }
        }, 200);
    }

    // --- Menu & Settings Buttons ---
    function safeToggleMenu(e) {
        if(e) e.stopPropagation();
        const m = document.getElementById('mainMenu');
        const appPass = localStorage.getItem('appPass');
        
        document.getElementById('lockMenuText').innerText = appPass ? "إلغاء قفل التطبيق" : "تعيين قفل للتطبيق";
        
        if (m.style.display === 'flex') {
            m.style.display = 'none';
        } else {
            if (appPass) {
                openPasswordModal("رمز القائمة", (v) => {
                    if (v === appPass) m.style.display = 'flex'; else showToast("خطأ");
                });
            } else m.style.display = 'flex';
        }
    }

    function handleAppLockSettings() {
        document.getElementById('mainMenu').style.display = 'none';
        const appPass = localStorage.getItem('appPass');
        if(appPass) {
            openPasswordModal("أدخل الرمز الحالي لإزالته", (v) => {
                if(v === appPass) { 
                    localStorage.removeItem('appPass'); 
                    showToast("تم إزالة القفل 🔓");
                    triggerAutoSave();
                }
                else showToast("خطأ في الرمز");
            });
        } else {
            openPasswordModal("تعيين رمز جديد", (v) => { 
                if(v) { 
                    localStorage.setItem('appPass', v); 
                    showToast("تم القفل 🔒");
                    triggerAutoSave();
                } 
            });
        }
    }

    // --- File Export/Import ---
    function exportDataAuto() {
        document.getElementById('mainMenu').style.display = 'none';
        const dataToSave = { accounts: accounts, folders: folders };
        const blob = new Blob([JSON.stringify(dataToSave)], {type: "application/json"});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = "secrets_vault_backup.json";
        a.click();
    }

    function importDataWrapper(e) {
        document.getElementById('mainMenu').style.display = 'none';
        const reader = new FileReader();
        reader.onload = (f) => {
            try {
                const imported = JSON.parse(f.target.result);
                const newAccounts = Array.isArray(imported) ? imported : (imported.accounts || []);
                const newFolders = imported.folders || ["عام"];
                
                const clean = newAccounts.map(a => ({ id: a.id || Date.now()+Math.random(), email: a.email || a.title || "مستورد", pass: a.pass||"...", folder: a.folder||"عام" }));
                accounts = [...accounts, ...clean];
                
                newFolders.forEach(f => { if(!folders.includes(f)) folders.push(f); });

                triggerAutoSave();
                renderVault();
                showToast('تم استعادة البيانات بنجاح ✅');
            } catch(e){
                showToast('ملف غير صالح ❌');
            }
        };
        if(e.target.files.length > 0) reader.readAsText(e.target.files[0]);
    }

    // --- Utils ---
    function openPasswordModal(t, cb) {
        document.getElementById('passModalTitle').innerText = t;
        document.getElementById('globalPassInput').value = '';
        showOverlay('passwordModal');
        pendingCallback = cb;
        setTimeout(()=>document.getElementById('globalPassInput').focus(), 100);
    }
    
    function customConfirm(m, cb) {
        document.getElementById('confirmMessage').innerText = m;
        const btn = document.getElementById('confirmYesBtn');
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.onclick = () => { goBack(); setTimeout(cb, 100); };
        showOverlay('confirmModal');
    }

    function startVaultPress() {
        isLongPress = false;
        vaultPressTimer = setTimeout(() => { isLongPress = true; handleVaultLongPress(); }, 800);
    }
    function cancelVaultPress() { clearTimeout(vaultPressTimer); }
    function handleVaultLongPress() {
        const vp = localStorage.getItem('vaultPass');
        if(vp) openPasswordModal("إزالة قفل الخزنة", v => { 
            if(v===vp){ 
                localStorage.removeItem('vaultPass'); 
                showToast("تم الإلغاء"); 
                triggerAutoSave();
            } else showToast("خطأ"); 
        });
        else openPasswordModal("قفل الخزنة", v => { 
            if(v){ 
                localStorage.setItem('vaultPass', v); 
                showToast("تم القفل");
                triggerAutoSave();
            } 
        });
    }
    function openVaultCheck() {
        if(isLongPress) return;
        const vp = localStorage.getItem('vaultPass');
        if(vp) openPasswordModal("رمز الخزنة", v => { if(v===vp) openVault(); else showToast("خطأ"); });
        else openVault();
    }
    function openVault() {
        pushHistory('vault');
        document.getElementById('vaultPage').style.display = 'flex';
        renderFoldersBar(); renderVault();
    }

    function showBackupModal() {
        document.getElementById('mainMenu').style.display = 'none';
        document.getElementById('backupText').value = JSON.stringify({accounts, folders});
        showOverlay('backupModal');
    }
    function copyBackup() {
        document.getElementById('backupText').select(); document.execCommand('copy'); showToast("تم النسخ");
    }
    function showImportModal() {
        document.getElementById('mainMenu').style.display = 'none';
        document.getElementById('importText').value = '';
        showOverlay('importModal');
    }
    function performImport() {
        try {
            const data = JSON.parse(document.getElementById('importText').value);
            const raw = Array.isArray(data) ? data : (data.accounts || []);
            const clean = raw.map(a => ({ id: a.id || Date.now()+Math.random(), email: a.email || a.title || "مستورد", pass: a.pass||"...", folder: a.folder||"عام" }));
            accounts = [...accounts, ...clean];
            triggerAutoSave();
            goBack(); showToast(`تم استيراد ${clean.length} عنصر`); renderVault();
        } catch(e) { showToast("كود غير صالح ❌"); }
    }
    function pasteFromClipboard() { navigator.clipboard.readText().then(t => document.getElementById('importText').value = t); }
    function copyToClipboard(t) { navigator.clipboard.writeText(t).then(()=>showToast("تم النسخ")); }
    function showToast(m) { const t=document.getElementById('toast'); t.innerText=m; t.style.opacity='1'; setTimeout(()=>t.style.opacity='0',2000); }

    window.onclick = (e) => { if(!e.target.closest('.menu-btn')) document.getElementById('mainMenu').style.display = 'none'; }