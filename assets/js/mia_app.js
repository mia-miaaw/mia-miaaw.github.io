(function(){
  // ---------- GLOBAL CONFIG ----------
  const API_BASE_URL = 'https://mia-ai.mvstream.workers.dev';
  const MIDTRANS_SNAP_SCRIPT = 'https://app.sandbox.midtrans.com/snap/snap.js';
  const CLIENT_KEY = 'SB-Mid-client-rAWcUqggvu92k9Ul';

  // ---------- GLOBAL STATE ----------
  let conversations = [];        
  let currentConversationId = null;
  let isWaitingResponse = false; 
  let currentTypingIndicatorElement = null;
  let attachedFiles = []; 
  let userTokenBalance = 0;      
  let sessionToken = localStorage.getItem('mia_session_token');
  let currentUser = null;

  // State untuk Speech-to-Speech & Auto Read Aloud
  let isAutoSpeakActive = false; 
  let speechRecognition = null;
  let isRecording = false;
  let audioContext = null;       

  // DOM references
  let messagesContainer;
  let emptyPlaceholder;
  let conversationListEl;
  let messageInput;
  let sendBtn;
  let scrollTopFab;
  let chatTitleEl;
  let attachFileBtn;
  let hiddenFileInput;
  let attachmentPreviewContainer;
  let micRecordBtn;
  let autoSpeakToggle;
  let tokenBalanceDisplay;
  
  // Modal History References
  let historyModal;
  let historyModalContent;
  let closeHistoryModalBtn;

  // Modal R2 References
  let r2ExplorerModal;
  let r2FilesGrid;
  let closeR2ModalBtn;
  let openR2ExplorerBtn;
  let r2DirectUploadBtn;
  let r2DirectFileInput;

  // Custom Markdown renderer dengan bungkus Copy-Code modern
  const renderer = new marked.Renderer();
  renderer.code = function({ text, lang }) {
    const language = lang || 'code';
    const uid = 'copy-btn-' + Math.random().toString(36).substr(2, 8);
    return `
      <div class="code-block-wrapper">
        <div class="code-header">
          <span>${language.toUpperCase()}</span>
          <button class="copy-btn" data-uid="${uid}">
            <ion-icon name="copy-outline"></ion-icon>
            <span>Salin</span>
          </button>
        </div>
        <pre><code class="language-${language}">${escapeHtml(text)}</code></pre>
      </div>
    `;
  };

  marked.setOptions({ renderer });

  // Clipboard helper
  window.copyToClipboard = function(button, codeText) {
    const textarea = document.createElement('textarea');
    textarea.value = codeText;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
      const span = button.querySelector('span');
      const icon = button.querySelector('ion-icon');

      if (span) span.innerText = 'Tersalin!';
      button.style.color = '#10b981';
      if (icon) icon.setAttribute('name', 'checkmark-outline');

      setTimeout(() => {
        if (span) span.innerText = 'Salin';
        button.style.color = '';
        if (icon) icon.setAttribute('name', 'copy-outline');
      }, 2000);
    } catch (err) {
      console.error('Gagal menyalin:', err);
    } finally {
      document.body.removeChild(textarea);
    }
  };

  function generateId() {
    return Date.now() + '-' + Math.random().toString(36).substr(2, 6);
  }

  // Confirm Dialog (Ionic Alert)
  async function confirmDialog(header, message) {
    return new Promise((resolve) => {
      const alert = document.createElement('ion-alert');
      alert.header = header;
      alert.message = message;
      alert.buttons = [
        { text: 'Batal', role: 'cancel', handler: () => resolve(false) },
        { text: 'Ya, Hapus', role: 'confirm', handler: () => resolve(true) }
      ];
      document.body.appendChild(alert);
      alert.present().then(() => {
        alert.onDidDismiss().then((event) => {
          resolve(event.role === 'confirm');
          alert.remove();
        });
      });
    });
  }

  async function showAlert(header, message) {
    const alert = document.createElement('ion-alert');
    alert.header = header;
    alert.message = message;
    alert.buttons = ['OK'];
    document.body.appendChild(alert);
    await alert.present();
    alert.onDidDismiss().then(() => alert.remove());
  }

  // ---------- SINKRONISASI USER & AUTENTIKASI ----------

  function loginWithGithub() {
    window.location.href = `${API_BASE_URL}/auth/github`;
  }

  async function logout() {
    localStorage.removeItem('mia_session_token');
    localStorage.removeItem('ai_chat_app_data');
    sessionToken = null;
    currentUser = null;
    location.reload();
  }

  async function fetchUserProfile() {
    if (!sessionToken) return null;
    try {
      const res = await fetch(`${API_BASE_URL}/api/user/me`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` }
      });
      if (res.ok) {
        const user = await res.json();
        currentUser = user;
        updateUserUI(user);
        
        const premiumFeaturesList = document.getElementById('premium-features-list');
        if (premiumFeaturesList) premiumFeaturesList.style.display = 'block';

        if (user.userId) {
          userTokenBalance = user.balance ?? 0;
          updateBalanceDisplay();
        }
        return user;
      } else {
        sessionToken = null;
        localStorage.removeItem('mia_session_token');
        showLoginButton();
        return null;
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
      return null;
    }
  }

  function updateUserUI(user) {
    const sidebarProfileContainer = document.getElementById('sidebar-user-container');
    if (sidebarProfileContainer) {
      sidebarProfileContainer.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; width:100%; padding:14px 16px; background:rgba(0,0,0,0.02); border-bottom:1px solid rgba(0,0,0,0.05);">
          <div style="display:flex; align-items:center; gap:10px;">
            <img src="${user.avatarUrl}" style="width:34px; height:34px; border-radius:50%; border:2px solid #4f46e5;">
            <div style="display:flex; flex-direction:column; text-align:left;">
              <span style="font-size:0.85rem; font-weight:700; color:var(--ion-color-dark, #1e293b);">${escapeHtml(user.displayName)}</span>
              <span style="font-size:0.7rem; color:#64748b;">@${escapeHtml(user.userName)}</span>
            </div>
          </div>
          <button id="logout-btn" style="background:transparent; border:none; color:#ef4444; font-size:1.2rem; cursor:pointer; display:flex; align-items:center;">
            <ion-icon name="log-out-outline"></ion-icon>
          </button>
        </div>
      `;
      document.getElementById('logout-btn')?.addEventListener('click', logout);
    }
  }

  function showLoginButton() {
    const sidebarProfileContainer = document.getElementById('sidebar-user-container');
    if (sidebarProfileContainer) {
      sidebarProfileContainer.innerHTML = `
        <div style="padding:14px 16px; border-bottom:1px solid rgba(0,0,0,0.05); text-align:center;">
          <button id="github-login-btn" style="display:inline-flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:10px; background:#1e293b; color:white; border:none; border-radius:12px; font-weight:600; font-size:0.85rem; cursor:pointer; transition:background 0.2s;">
            <ion-icon name="logo-github" style="font-size:1.1rem;"></ion-icon>
            Masuk dengan GitHub
          </button>
        </div>
      `;
      document.getElementById('github-login-btn')?.addEventListener('click', loginWithGithub);
    }
  }

  // ---------- PEMBAYARAN MIDTRANS ----------

  function loadMidtransSnapLibrary() {
    if (window.snap) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = MIDTRANS_SNAP_SCRIPT;
        script.setAttribute('data-client-key', CLIENT_KEY);
        script.onload = () => {
            let attempts = 0;
            const checkSnap = setInterval(() => {
                if (window.snap) {
                    clearInterval(checkSnap);
                    resolve(true);
                } else if (attempts >= 30) {
                    clearInterval(checkSnap);
                    reject(new Error('Midtrans Snap tidak merespons.'));
                }
                attempts++;
            }, 100);
        };
        script.onerror = () => reject(new Error('Gagal memuat library Snap Midtrans.'));
        document.head.appendChild(script);
    });
  }
  
  // polling sistem terintegrasi untuk menangani keterlambatan pemrosesan webhook midtrans
  async function fetchUserBalance(pollCount = 1, interval = 2000) {
    let attempts = 0;
    const initialBalance = userTokenBalance;

    async function performFetch() {
      try {
        const targetId = currentUser ? currentUser.userId : currentConversationId;
        const headers = {};
        if (sessionToken) {
          headers['Authorization'] = `Bearer ${sessionToken}`;
        }
        const response = await fetch(`${API_BASE_URL}/api/balance?userId=${targetId}`, { headers });
        if (response.ok) {
          const data = await response.json();
          const newBalance = data.balance ?? 0;
          userTokenBalance = newBalance;
          if (currentUser) {
            currentUser.balance = newBalance;
          }
          updateBalanceDisplay();

          // jika saldo berhasil meningkat selama polling, selesaikan dini
          if (pollCount > 1 && newBalance > initialBalance) {
            return true;
          }
        }
      } catch (e) {
        console.warn("Gagal sinkronisasi saldo token.", e);
      }
      return false;
    }

    const isUpdated = await performFetch();
    if (isUpdated) return;

    if (pollCount > 1) {
      const intervalId = setInterval(async () => {
        attempts++;
        const shouldStop = await performFetch();
        if (shouldStop || attempts >= pollCount) {
          clearInterval(intervalId);
        }
      }, interval);
    }
  }

  function updateBalanceDisplay() {
    // Sinkronisasi kelas token-balance-container maupun id token-balance-display
    const displayEls = document.querySelectorAll('.token-balance-container, #token-balance-display');
    displayEls.forEach(el => {
      el.innerHTML = `
        <div style="display:inline-flex; align-items:center; gap:6px; background:rgba(16, 185, 129, 0.12); border:1px solid rgba(16, 185, 129, 0.3); padding:5px 12px; border-radius:20px; font-size:0.75rem; font-weight:700; color:#059669; cursor:pointer;" class="topup-trigger-node">
          <ion-icon name="logo-ionic" style="color:#10b981; font-size:1.1rem;"></ion-icon>
          <span>${userTokenBalance.toLocaleString()} Token</span>
        </div>
      `;
    });

    document.querySelectorAll('.topup-trigger-node').forEach(btn => {
      btn.addEventListener('click', () => {
        showTopupPlansDialog();
      });
    });
  }

  async function showTopupPlansDialog() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/plans`);
      if (!response.ok) throw new Error();
      const data = await response.json();
      
      const inputs = data.plans.map(p => ({
        type: 'radio',
        label: `${p.label} - Rp ${p.priceIDR.toLocaleString()}`,
        value: p.sku,
        checked: p.sku === 'P1'
      }));

      const alert = document.createElement('ion-alert');
      alert.header = 'Top-Up Saldo Token MIA';
      alert.message = 'Pilih paket koin di bawah ini. Anda juga bisa menggunakan kode promo seperti "MIAAWBARU" untuk diskon tambahan!';
      alert.inputs = [
        ...inputs,
        {
          name: 'promoCode',
          type: 'text',
          placeholder: 'Masukkan Kode Promo (Opsional)'
        }
      ];
      alert.buttons = [
        { text: 'Batal', role: 'cancel' },
        { 
          text: 'Bayar Sekarang', 
          handler: async (alertData) => {
            const selectedSku = alert.querySelector('input[type="radio"]:checked')?.value || alertData;
            const enteredPromo = alertData.promoCode || '';
            
            if (selectedSku) {
              await startMidtransPaymentProcess(selectedSku, enteredPromo);
            }
          } 
        }
      ];

      document.body.appendChild(alert);
      await alert.present();
    } catch {
      showAlert('Koneksi Gagal', 'Gagal memuat paket harga top-up.');
    }
  }

  async function startMidtransPaymentProcess(sku, promoCode = '') {
    try {
        await loadMidtransSnapLibrary();
        const targetId = currentUser ? currentUser.userId : currentConversationId;
        
        const headers = { 
          'Content-Type': 'application/json' 
        };
        if (sessionToken) {
          headers['Authorization'] = `Bearer ${sessionToken}`;
        }

        const response = await fetch(`${API_BASE_URL}/api/checkout`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ 
              userId: targetId, 
              sku: sku,
              promoCode: promoCode 
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `HTTP ${response.status}`);
        }
        
        const invoice = await response.json();

        if (!invoice.success || !invoice.token) {
            throw new Error('Gagal memvalidasi token invoice.');
        }

        const msgDiskon = promoCode ? ` (Dengan Diskon Promo!)` : '';

        window.snap.pay(invoice.token, {
            onSuccess: async function(result) {
                await showAlert('Sukses', `Pembayaran berhasil dikonfirmasi${msgDiskon}! Saldo Anda segera bertambah.`);
                // Mengaktifkan polling saldo instan setelah transaksi sukses untuk meredam jeda asinkronus webhook
                await fetchUserBalance(5, 2000);
            },
            onPending: function(result) {
                showAlert('Pending', 'Silakan selesaikan tagihan pembayaran Anda.');
            },
            onError: function(result) {
                showAlert('Gagal', 'Sistem pembayaran gagal memproses transaksi.');
            },
            onClose: async function() {
                // Polling antisipasi apabila user telah membayar namun langsung menutup popup
                await fetchUserBalance(5, 2000);
            }
        });

    } catch (err) {
        showAlert('Gangguan Sistem', err.message || 'Gagal terhubung dengan layanan Midtrans.');
    }
  }

  async function loadUserPurchaseHistory() {
    if (!historyModalContent) return;
    
    if (!currentUser) {
      historyModalContent.innerHTML = `
        <div style="text-align: center; padding: 24px;">
          <ion-icon name="lock-closed-outline" style="font-size: 3rem; color: var(--ion-color-medium);"></ion-icon>
          <h3 style="margin-top: 12px; font-weight: 700;">Akses Terbatas</h3>
          <p style="color: var(--ion-color-medium); font-size: 0.9rem;">Silakan login terlebih dahulu dengan GitHub Anda untuk melacak riwayat transaksi pembelian token Anda.</p>
        </div>
      `;
      return;
    }

    try {
      const headers = {};
      if (sessionToken) {
        headers['Authorization'] = `Bearer ${sessionToken}`;
      }
      
      const response = await fetch(`${API_BASE_URL}/api/history`, { headers });
      if (!response.ok) throw new Error();
      
      const data = await response.json();
      const list = data.history || [];
      
      if (list.length === 0) {
        historyModalContent.innerHTML = `
          <div style="text-align: center; padding: 24px;">
            <ion-icon name="receipt-outline" style="font-size: 3rem; color: var(--ion-color-medium);"></ion-icon>
            <h3 style="margin-top: 12px; font-weight: 700;">Belum Ada Transaksi</h3>
            <p style="color: var(--ion-color-medium); font-size: 0.9rem;">Anda belum pernah melakukan pembelian paket token koin tambahan.</p>
          </div>
        `;
        return;
      }

      let html = '<ion-list>';
      list.forEach(p => {
        const tDate = new Date(p.timestamp).toLocaleString('id-ID', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        const promoLabel = p.promoUsed && p.promoUsed !== 'None' ? ` <span style="background: #e0e7ff; color: #4338ca; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem;">Kupon: ${p.promoUsed}</span>` : '';
        
        html += `
          <ion-item>
            <ion-icon name="checkmark-circle" color="success" slot="start"></ion-icon>
            <ion-label>
              <h2>Paket: ${p.sku} (+${p.tokens.toLocaleString()} Token)${promoLabel}</h2>
              <p>ID Transaksi: ${p.orderId}</p>
              <p style="font-size: 0.75rem;">Diproses pada: ${tDate}</p>
            </ion-label>
            <ion-note slot="end" color="success">
              Rp ${(p.pricePaid || 0).toLocaleString()}
            </ion-note>
          </ion-item>
        `;
      });
      html += '</ion-list>';
      historyModalContent.innerHTML = html;

    } catch (err) {
      historyModalContent.innerHTML = '<p class="ion-text-center" color="danger">Gagal memuat riwayat pembelian dari database.</p>';
    }
  }

  // ---------- PENYIMPANAN SESI DATA CHAT ----------
  function saveToLocalStorage() {
    localStorage.setItem('ai_chat_app_data', JSON.stringify({
      conversations,
      currentConversationId
    }));
  }

  function loadFromLocalStorage() {
    const raw = localStorage.getItem('ai_chat_app_data');
    if (!raw) {
      const defaultId = generateId();
      conversations = [{ id: defaultId, title: 'Obrolan Baru', messages: [] }];
      currentConversationId = defaultId;
      saveToLocalStorage();
      return;
    }
    try {
      const data = JSON.parse(raw);
      conversations = data.conversations || [];
      currentConversationId = data.currentConversationId || (conversations[0]?.id || null);
      if (!conversations.length) {
        const newId = generateId();
        conversations = [{ id: newId, title: 'Obrolan Baru', messages: [] }];
        currentConversationId = newId;
        saveToLocalStorage();
      }
    } catch(e) {
      const defaultId = generateId();
      conversations = [{ id: defaultId, title: 'Obrolan Baru', messages: [] }];
      currentConversationId = defaultId;
    }
  }

  function updateConversationTitle(convId) {
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;
    const firstUserMsg = conv.messages.find(m => m.sender === 'user');
    if (firstUserMsg && firstUserMsg.text) {
      let titleText = firstUserMsg.text;
      
      const autoReaderIndex = titleText.indexOf('[MIA AUTO-READER');
      const fileIndex = titleText.indexOf('--- ISI BERKAS LAMPIRAN:');
      
      if (autoReaderIndex !== -1) {
        titleText = titleText.substring(0, autoReaderIndex).trim() || "Membaca Tautan Web";
      } else if (fileIndex !== -1) {
        titleText = titleText.substring(0, fileIndex).trim() || "Mengirim Berkas";
      } else if (titleText.startsWith('[MENGIRIM GAMBAR]')) {
        const lines = titleText.split('\n');
        titleText = lines.slice(1).join('\n').trim() || "Mengirim Gambar";
      }
      
      let newTitle = titleText.length > 7 ? titleText.substring(0, 7) + '...' : titleText;
      conv.title = newTitle;
    } else {
      conv.title = 'Obrolan Baru';
    }
    saveToLocalStorage();
    renderSidebar();
    if (currentConversationId === convId) {
      chatTitleEl.innerText = conv.title;
    }
  }

  // ---------- RENDER SIDEBAR LIST CHAT ----------
  function renderSidebar() {
    if (!conversationListEl) return;
    if (conversations.length === 0) {
      conversationListEl.innerHTML = `<ion-item lines="none" class="ion-text-center"><ion-label color="medium">Tidak ada percakapan</ion-label></ion-item>`;
      return;
    }
    let html = '';
    conversations.forEach(conv => {
      const isActive = (currentConversationId === conv.id);
      const activeClass = isActive ? 'active' : '';
      html += `
        <ion-item class="conversation-item ${activeClass}" data-conv-id="${conv.id}" button detail="false" lines="full">
          <ion-icon name="chatbubble-ellipses-outline" slot="start" style="font-size: 1.15rem; color: ${isActive ? '#4f46e5' : '#6b7280'}; margin-inline-end: 12px;"></ion-icon>
          <ion-label class="ion-text-wrap">
            <h3 style="margin: 0; font-size: 0.88rem; font-weight: ${isActive ? '600' : '400'}">${escapeHtml(conv.title)}</h3>
            <p style="font-size: 0.72rem; color: #9ca3af; margin-top: 4px;">${conv.messages.length} pesan</p>
          </ion-label>
          <ion-buttons slot="end">
            <ion-button class="delete-conv-btn" fill="clear" color="danger" data-conv-delete="${conv.id}">
              <ion-icon slot="icon-only" name="trash-outline" style="font-size: 1.05rem;"></ion-icon>
            </ion-button>
          </ion-buttons>
        </ion-item>
      `;
    });
    conversationListEl.innerHTML = html;

    document.querySelectorAll('.conversation-item').forEach(item => {
      const convId = item.getAttribute('data-conv-id');
      item.addEventListener('click', (e) => {
        if (e.target.closest('.delete-conv-btn')) return;
        if (convId !== currentConversationId) {
          switchConversation(convId);
        }
      });
    });

    document.querySelectorAll('.delete-conv-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const convId = e.currentTarget.getAttribute('data-conv-delete');
        if (convId) deleteConversation(convId);
      });
    });
  }

  async function deleteConversation(convId) {
    const convToDelete = conversations.find(c => c.id === convId);
    if (!convToDelete) return;
    const confirmed = await confirmDialog('Hapus Percakapan', `Hapus "${convToDelete.title}" dari riwayat Anda?`);
    if (!confirmed) return;

    const index = conversations.findIndex(c => c.id === convId);
    if (index !== -1) conversations.splice(index, 1);

    if (conversations.length === 0) {
      const newId = generateId();
      conversations.push({ id: newId, title: 'Obrolan Baru', messages: [] });
      currentConversationId = newId;
    } else if (currentConversationId === convId) {
      currentConversationId = conversations[0].id;
    }
    saveToLocalStorage();
    renderSidebar();
    renderCurrentChat();
    const currentConv = conversations.find(c => c.id === currentConversationId);
    chatTitleEl.innerText = currentConv ? currentConv.title : 'AI Chat';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => {
      if (m === '&') return '&amp;';
      if (m === '<') return '&lt;';
      if (m === '>') return '&gt;';
      return m;
    });
  }

  // ---------- DISPLAY BUBBLE CHAT ----------
  function renderCurrentChat() {
    if (!messagesContainer) return;
    
    messagesContainer.innerHTML = '';

    if (conversations.length === 0 || !currentConversationId) {
      if (emptyPlaceholder) emptyPlaceholder.style.setProperty('display', 'flex', 'important');
      messagesContainer.style.setProperty('display', 'none', 'important');
      return;
    }

    const currentConv = conversations.find(c => c.id === currentConversationId);

    if (!currentConv || !currentConv.messages || currentConv.messages.length === 0) {
      if (emptyPlaceholder) emptyPlaceholder.style.setProperty('display', 'flex', 'important');
      messagesContainer.style.setProperty('display', 'none', 'important');
      removeTypingIndicator();
      return;
    }

    if (emptyPlaceholder) emptyPlaceholder.style.setProperty('display', 'none', 'important');
    messagesContainer.style.setProperty('display', 'flex', 'important');

    currentConv.messages.forEach(msg => {
      appendMessageToDom(msg.sender, msg.text, false);
    });

    if (isWaitingResponse) {
      showTypingIndicatorOnly();
    } else {
      removeTypingIndicator();
    }
    
    scrollToBottom();
  }

  function appendMessageToDom(sender, text, isStreamChunk = false) {
    let messageDiv;

    if (isStreamChunk) {
      messageDiv = document.getElementById('streaming-message-node');
    }

    if (!messageDiv) {
      messageDiv = document.createElement('div');
      messageDiv.className = `message ${sender}`;
      if (isStreamChunk) {
        messageDiv.id = 'streaming-message-node';
      }

      const avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      avatar.innerText = sender === 'user' ? 'U' : 'AI';
      messageDiv.appendChild(avatar);

      const bodyContainer = document.createElement('div');
      bodyContainer.className = 'message-body-container';
      bodyContainer.style.display = 'flex';
      bodyContainer.style.flexDirection = 'column';

      const body = document.createElement('div');
      body.className = 'message-body';

      if (sender === 'user') {
        const autoReaderIndex = text.indexOf('[MIA AUTO-READER');
        const fileIndex = text.indexOf('--- ISI BERKAS LAMPIRAN:');

        if (autoReaderIndex !== -1) {
          const displayDiv = document.createElement('div');
          
          const userPrompt = text.substring(0, autoReaderIndex).trim();
          if (userPrompt) {
            const promptEl = document.createElement('p');
            promptEl.innerText = userPrompt;
            promptEl.style.marginBottom = '12px';
            displayDiv.appendChild(promptEl);
          }

          const extractedText = text.substring(autoReaderIndex);
          const githubRegex = /--- DATA REPOSITORY GITHUB \(([^)]+)\)/g;
          const webRegex = /--- DOKUMEN SOURCE WEBSITE \/ RAW WEB READER KONTEN \(([^)]+)\)/g;
          const searchRegex = /--- HASIL PENELUSURAN GOOGLE SEARCH REALTIME ---/g;
          
          let match;
          const sources = [];
          const isGoogleSearchUsed = searchRegex.test(extractedText);
          
          while ((match = githubRegex.exec(extractedText)) !== null) {
            sources.push({ type: 'github', url: match[1] });
          }
          while ((match = webRegex.exec(extractedText)) !== null) {
            sources.push({ type: 'web', url: match[1] });
          }

          const badgeContainer = document.createElement('div');
          badgeContainer.style.display = 'flex';
          badgeContainer.style.flexDirection = 'column';
          badgeContainer.style.gap = '6px';
          badgeContainer.style.padding = '10px 14px';
          badgeContainer.style.background = 'rgba(79, 70, 229, 0.08)';
          badgeContainer.style.border = '1px solid rgba(99, 102, 241, 0.2)';
          badgeContainer.style.borderRadius = '12px';
          badgeContainer.style.fontSize = '0.82rem';
          badgeContainer.style.marginTop = '4px';

          let sourcesHtml = '';
          if (isGoogleSearchUsed) {
            sourcesHtml += `
              <div style="display:flex; align-items:center; gap:8px;">
                <ion-icon name="search-outline" style="font-size: 1.1rem; color: #3b82f6;"></ion-icon>
                <span><strong>Google Search:</strong> Melakukan pencarian web realtime untuk informasi terbaru.</span>
              </div>
            `;
          }

          sources.forEach(src => {
            const icon = src.type === 'github' ? 'logo-github' : 'globe-outline';
            const label = src.type === 'github' ? 'Membaca Repository GitHub' : 'Membaca Halaman Web';
            const color = src.type === 'github' ? '#3b82f6' : '#10b981';
            
            sourcesHtml += `
              <div style="display:flex; align-items:center; gap:8px;">
                <ion-icon name="${icon}" style="font-size: 1.1rem; color: ${color};"></ion-icon>
                <span><strong>${label}:</strong> <a href="${src.url}" target="_blank" style="color: #4f46e5; text-decoration: underline; word-break: break-all;">${escapeHtml(src.url)}</a></span>
              </div>
            `;
          });
          
          badgeContainer.innerHTML = sourcesHtml || `
            <div style="display:flex; align-items:center; gap:8px;">
              <ion-icon name="cloud-download-outline" style="font-size: 1.1rem; color: #4f46e5;"></ion-icon>
              <span><strong>MIA Auto-Reader:</strong> Konteks eksternal berhasil dilampirkan.</span>
            </div>
          `;

          displayDiv.appendChild(badgeContainer);
          body.appendChild(displayDiv);
        } else if (fileIndex !== -1) {
          const displayDiv = document.createElement('div');
          
          const userPrompt = text.substring(0, fileIndex).trim();
          if (userPrompt) {
            const promptEl = document.createElement('p');
            promptEl.innerText = userPrompt;
            promptEl.style.marginBottom = '12px';
            displayDiv.appendChild(promptEl);
          }

          const regex = /--- ISI BERKAS LAMPIRAN:\s*([^\s-]+)/g;
          let match;
          const detectedFileNames = [];
          while ((match = regex.exec(text)) !== null) {
            detectedFileNames.push(match[1]);
          }

          const attachmentMarker = document.createElement('div');
          attachmentMarker.style.display = 'flex';
          attachmentMarker.style.flexDirection = 'column';
          attachmentMarker.style.gap = '4px';
          attachmentMarker.style.padding = '8px 12px';
          attachmentMarker.style.background = 'rgba(0, 0, 0, 0.04)';
          attachmentMarker.style.borderRadius = '8px';
          attachmentMarker.style.fontSize = '0.82rem';
          
          let fileListText = detectedFileNames.length > 0 ? detectedFileNames.join(', ') : 'Berkas';

          attachmentMarker.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
              <ion-icon name="document-text-outline" style="font-size: 1.2rem; color: #0284c7;"></ion-icon>
              <span><strong>Membaca ${detectedFileNames.length} berkas:</strong> ${escapeHtml(fileListText)}</span>
            </div>
          `;
          
          displayDiv.appendChild(attachmentMarker);
          body.appendChild(displayDiv);
        } else if (text.startsWith('[MENGIRIM GAMBAR]')) {
          const displayDiv = document.createElement('div');
          const lines = text.split('\n');
          const promptLine = lines.slice(1).join('\n').trim();

          if (promptLine) {
            const promptEl = document.createElement('p');
            promptEl.innerText = promptLine;
            promptEl.style.marginBottom = '12px';
            displayDiv.appendChild(promptEl);
          }

          const imageMarker = document.createElement('div');
          imageMarker.style.display = 'flex';
          imageMarker.style.alignItems = 'center';
          imageMarker.style.gap = '8px';
          imageMarker.style.padding = '8px 12px';
          imageMarker.style.background = 'rgba(0,0,0,0.04)';
          imageMarker.style.borderRadius = '8px';
          imageMarker.style.fontSize = '0.82rem';
          imageMarker.innerHTML = `
            <ion-icon name="image-outline" style="font-size: 1.2rem; color: #10b981;"></ion-icon>
            <span><strong>Mengunggah Gambar untuk dianalisis oleh AI</strong></span>
          `;
          displayDiv.appendChild(imageMarker);
          body.appendChild(displayDiv);
        } else {
          body.innerText = text; 
        }
        
        bodyContainer.appendChild(body);
      } else {
        body.classList.add('markdown-content');
        const rawHtml = marked.parse(text);
        body.innerHTML = DOMPurify.sanitize(rawHtml);

        bodyContainer.appendChild(body);

        const cleanTextForSpeak = text
          .replace(/<\/?[^>]+(>|$)/g, "")
          .replace(/\*/g, "")
          .trim();

        const speakBtnHtml = `
          <div class="ai-speak-footer" style="width: 100%; display: flex; justify-content: flex-start; margin-top: 8px;">
            <button class="ai-speak-btn" data-text="${escapeHtml(cleanTextForSpeak)}" title="Dengarkan balasan" style="margin: 0; padding: 4px 8px; background: rgba(0,0,0,0.03); border-radius: 6px; border: none; cursor: pointer; display: flex; align-items: center; color: var(--ion-color-medium, #666);">
              <ion-icon name="volume-medium-outline" style="font-size: 1.1rem;"></ion-icon>
              <span style="font-size: 0.75rem; margin-left: 4px; font-weight: 500;">Bicara</span>
            </button>
          </div>
        `;
        bodyContainer.insertAdjacentHTML('beforeend', speakBtnHtml);
      }

      messageDiv.appendChild(bodyContainer);

      const indicator = document.getElementById('live-typing-indicator');
      if (indicator) {
        messagesContainer.insertBefore(messageDiv, indicator);
      } else {
        messagesContainer.appendChild(messageDiv);
      }
    } else {
      const body = messageDiv.querySelector('.message-body');
      if (body) {
        const rawHtml = marked.parse(text);
        body.innerHTML = DOMPurify.sanitize(rawHtml);

        const speakBtn = messageDiv.querySelector('.ai-speak-btn');
        if (speakBtn) {
          const cleanTextForSpeak = text
            .replace(/<\/?[^>]+(>|$)/g, "")
            .replace(/\*/g, "")
            .trim();
          speakBtn.setAttribute('data-text', cleanTextForSpeak);
        }
      }
    }
  }

  function showTypingIndicatorOnly() {
    removeTypingIndicator();
    const typingDiv = document.createElement('div');
    typingDiv.className = 'typing-indicator';
    typingDiv.id = 'live-typing-indicator';
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('div');
      dot.className = 'typing-dot';
      typingDiv.appendChild(dot);
    }
    messagesContainer.appendChild(typingDiv);
    scrollToBottom();
    currentTypingIndicatorElement = typingDiv;
  }

  function stopAllSpeechSynthesis() {
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    document.querySelectorAll('.ai-speak-btn').forEach(btn => {
      btn.classList.remove('active-speaking');
      const icon = btn.querySelector('ion-icon');
      if (icon) icon.setAttribute('name', 'volume-medium-outline');
    });
  }

  function removeTypingIndicator() {
    if (currentTypingIndicatorElement && currentTypingIndicatorElement.parentNode) {
      currentTypingIndicatorElement.remove();
      currentTypingIndicatorElement = null;
    }
    const existing = document.getElementById('live-typing-indicator');
    if (existing) existing.remove();
  }

  function addMessageToState(sender, text) {
    const conv = conversations.find(c => c.id === currentConversationId);
    if (!conv) return false;

    conv.messages.push({
      id: generateId(),
      text: text,
      sender: sender,
      timestamp: Date.now()
    });

    if (sender === 'user' && conv.messages.filter(m => m.sender === 'user').length === 1) {
      updateConversationTitle(currentConversationId);
    }
    saveToLocalStorage();
    return true;
  }

  // ---------- PEMERIKSA PICUAN AUTO-CHAT TRANS-HALAMAN ----------
  function checkPaymentRedirectTrigger() {
    const hash = window.location.hash || "";
    if (hash.includes("auto_check_payment=true")) {
      const params = new URLSearchParams(hash.replace('#', ''));
      const orderId = params.get('order_id') || "";
      
      // Bersihkan hash dari address bar agar saat di-refresh tidak mengirim pesan berulang
      window.history.replaceState(null, null, ' ');

      if (orderId && messageInput) {
        // Otomatis isi pesan teks ke input field, pemicu desain masukan aktif
        messageInput.value = `Halo MIA, apakah koin saya sudah bertambah dari order ${orderId}?`;
        messageInput.style.height = '80px';
        messageInput.focus();

        // Kirim otomatis setelah delay mikro-detik agar DOM & state benar-benar siap
        setTimeout(() => {
          sendUserMessage();
        }, 600);
      }
    }
  }

  // ---------- ALIRAN STREAMING SSE ----------
  async function executeAIStream(userMessage, imageBase64 = null) {
    if (isWaitingResponse) return;
    isWaitingResponse = true;

    stopAllSpeechSynthesis();

    emptyPlaceholder.style.display = 'none';
    showTypingIndicatorOnly();

    const conv = conversations.find(c => c.id === currentConversationId);
    if (!conv) return;

    const formattedMessages = conv.messages.map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text
    }));

    let responseTextAccumulator = '';

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (sessionToken) {
        headers['Authorization'] = `Bearer ${sessionToken}`;
      }

      const response = await fetch(`${API_BASE_URL}`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          sessionId: currentConversationId,
          messages: formattedMessages,
          image: imageBase64,
          ack: "agree" 
        })
      });

      removeTypingIndicator();

      if (response.status === 429) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || "Aktivitas mengirim pesan Anda terlalu cepat. Silakan tunggu beberapa saat.");
      }

      if (response.status === 402) {
        showTopupPlansDialog();
        throw new Error("Token Anda tidak mencukupi untuk melakukan percakapan ini.");
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Error status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            responseTextAccumulator += parseSSELine(buffer);
            appendMessageToDom('ai', responseTextAccumulator, true);
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const textContent = parseSSELine(line);
          if (textContent) {
            responseTextAccumulator += textContent;
            appendMessageToDom('ai', responseTextAccumulator, true);
            scrollToBottom();
          }
        }
      }

      const streamingNode = document.getElementById('streaming-message-node');
      if (streamingNode) {
        streamingNode.removeAttribute('id');
      }

      if (responseTextAccumulator.trim()) {
        addMessageToState('ai', responseTextAccumulator.trim());
        
        if (isAutoSpeakActive) {
          const cleanText = responseTextAccumulator.replace(/<\/?[^>]+(>|$)/g, "").trim();
          const readText = cleanText.split(/```[\s\S]*?```/g).join(' [Blok kode terlampir] ');
          speakWithCloudflareTTS(readText);
        }
      }

      await fetchUserBalance();

    } catch (error) {
      console.error(error);
      removeTypingIndicator();

      const streamingNode = document.getElementById('streaming-message-node');
      if (streamingNode) streamingNode.remove();

      await showAlert('Pemberitahuan', error.message || 'Gagal tersambung dengan asisten AI.');
    } finally {
      isWaitingResponse = false;
      messageInput.value = '';
      messageInput.style.height = '40px'; 
      renderCurrentChat();
    }
  }

  function parseSSELine(line) {
    if (!line.startsWith('data: ')) return '';
    const data = line.slice(6).trim();
    if (data === '[DONE]') return '';
    try {
      const parsed = JSON.parse(data);
      return parsed.choices?.[0]?.delta?.content || parsed.response || '';
    } catch {
      return '';
    }
  }

  // ---------- CLOUDFLARE R2 FILE MANAGER (PREMIUM STORAGE) ----------
  
  async function loadR2FilesLibrary() {
    if (!currentUser || !sessionToken) return false;
    try {
      const response = await fetch(`${API_BASE_URL}/api/files`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` }
      });
      
      // Jika server mendeteksi token habis atau belum pernah membeli paket premium
      if (response.status === 402 || response.status === 401 || response.status === 403) {
        const errData = await response.json().catch(() => ({}));
        const msg = errData.message || 'Akses ditolak. Fitur Pustaka terkunci.';
        showAlert('Akses Ditolak 🔒', msg);
        r2FilesGrid.innerHTML = `<p class="ion-text-center" style="color:#ef4444; padding:16px;">${escapeHtml(msg)}</p>`;
        return false;
      }
      
      if (!response.ok) throw new Error();
      const data = await response.json();
      const files = data.files || [];
      
      if (files.length === 0) {
        r2FilesGrid.innerHTML = `
          <div style="text-align: center; padding: 24px; color: var(--ion-color-medium);">
            <ion-icon name="cloud-offline-outline" style="font-size: 2.5rem;"></ion-icon>
            <p style="font-size: 0.85rem; margin-top: 8px;">Pustaka penyimpanan Anda kosong.</p>
          </div>
        `;
        return true;
      }

      let html = '';
      files.forEach(f => {
        const isImg = f.contentType.startsWith('image/');
        const fileIcon = isImg ? 'image-outline' : 'document-text-outline';
        const formattedSize = (f.size / 1024).toFixed(1) + ' KB';
        
        html += `
          <div style="display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); padding:10px 14px; border-radius:12px;">
            <div style="display:flex; align-items:center; gap:10px; width: 70%; cursor:pointer;" class="r2-select-item" data-url="${f.url}" data-name="${f.name}" data-type="${f.contentType}">
              <ion-icon name="${fileIcon}" style="font-size:1.4rem; color:#4f46e5;"></ion-icon>
              <div style="text-align:left; overflow:hidden;">
                <h4 style="margin:0; font-size:0.82rem; font-weight:600; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; color:var(--ion-color-dark);">${escapeHtml(f.name)}</h4>
                <p style="margin:0; font-size:0.7rem; color:var(--ion-color-medium);">${formattedSize}</p>
              </div>
            </div>
            <div style="display:flex; gap:4px;">
              <ion-button size="small" fill="clear" color="primary" class="r2-inject-btn" data-url="${f.url}"> Sisipkan </ion-button>
              <ion-button size="small" fill="clear" color="danger" class="r2-delete-btn" data-key="${f.key}">
                <ion-icon name="trash-outline" slot="icon-only"></ion-icon>
              </ion-button>
            </div>
          </div>
        `;
      });
      r2FilesGrid.innerHTML = html;

      r2FilesGrid.querySelectorAll('.r2-inject-btn, .r2-select-item').forEach(el => {
        el.addEventListener('click', (e) => {
          const target = e.currentTarget;
          const fileUrl = target.getAttribute('data-url');
          const name = target.getAttribute('data-name') || "Berkas";
          const type = target.getAttribute('data-type') || "text/plain";
          
          injectR2FileIntoAttachment(fileUrl, name, type);
          r2ExplorerModal.dismiss();
        });
      });

      r2FilesGrid.querySelectorAll('.r2-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const key = e.currentTarget.getAttribute('data-key');
          const confirm = await confirmDialog("Hapus File", "Hapus file ini secara permanen dari Cloud Storage?");
          if (confirm) {
            await deleteR2File(key);
          }
        });
      });

      return true;

    } catch (err) {
      r2FilesGrid.innerHTML = `<p class="ion-text-center" style="color:var(--ion-color-danger); padding:16px;">Gagal memuat file dari Cloud Storage.</p>`;
      return false;
    }
  }

  async function deleteR2File(key) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/files/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`
        },
        body: JSON.stringify({ key })
      });
      if (response.ok) {
        await loadR2FilesLibrary();
      } else {
        showAlert("Gagal", "Tidak memiliki wewenang atau token habis.");
      }
    } catch {
      showAlert("Error", "Gagal menghapus file cloud.");
    }
  }

  function injectR2FileIntoAttachment(url, name, type) {
    const isExist = attachedFiles.some(f => f.url === url);
    if (isExist) return;

    attachedFiles.push({
      isR2: true,
      name: name,
      type: type,
      url: url
    });
    renderFilePreviews();
    messageInput.focus();
  }

  // ---------- PROSES UPLOAD FILE PREMIUM & TAMU ----------

  async function uploadFileToR2(file) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE_URL}/api/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      },
      body: formData
    });

    if (response.status === 402 || response.status === 401 || response.status === 403) {
      const errData = await response.json().catch(() => ({}));
      const msg = errData.message || "Penyimpanan cloud premium ditangguhkan.";
      showTopupPlansDialog();
      throw new Error(msg);
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || "Gagal mengunggah ke Cloud.");
    }

    return await response.json();
  }

  // ---------- TEXT-TO-SPEECH (TTS) ----------
  async function speakWithCloudflareTTS(text, buttonElement = null) {
    stopAllSpeechSynthesis();

    if (buttonElement) {
      buttonElement.classList.add('active-speaking');
      const icon = buttonElement.querySelector('ion-icon');
      if (icon) icon.setAttribute('name', 'volume-high-outline');
    }

    const cleanText = text
      .replace(/\*/g, '') 
      .replace(/[\u{1F600}-\u{1F64F}]/gu, '') 
      .replace(/[\u{1F300}-\u{1F5FF}]/gu, '') 
      .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') 
      .replace(/[\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') 
      .replace(/\s+/g, ' ') 
      .trim();

    if (!cleanText) {
      if (buttonElement) {
        buttonElement.classList.remove('active-speaking');
        const icon = buttonElement.querySelector('ion-icon');
        if (icon) icon.setAttribute('name', 'volume-medium-outline');
      }
      return;
    }

    if (window.speechSynthesis) {
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = 'id-ID'; 
      const voices = window.speechSynthesis.getVoices();
      
      const localIndoVoice = voices.find(v => 
        (v.lang.includes('id') || v.lang.includes('ID')) && 
        (v.name.toLowerCase().includes('google') || v.name.toLowerCase().includes('female'))
      ) || voices.find(v => v.lang.includes('id') || v.lang.includes('ID'));

      if (localIndoVoice) utterance.voice = localIndoVoice;
      utterance.rate = 1.05; 
      utterance.pitch = 1.1; 

      utterance.onend = function() {
        if (buttonElement) {
          buttonElement.classList.remove('active-speaking');
          const icon = buttonElement.querySelector('ion-icon');
          if (icon) icon.setAttribute('name', 'volume-medium-outline');
        }
      };

      utterance.onerror = function() {
        fetchAuraFallback(cleanText, buttonElement);
      };

      window.speechSynthesis.speak(utterance);
    } else {
      fetchAuraFallback(cleanText, buttonElement);
    }
  }

  async function fetchAuraFallback(cleanText, buttonElement) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (sessionToken) {
        headers['Authorization'] = `Bearer ${sessionToken}`;
      }

      const response = await fetch(`${API_BASE_URL}/api/tts`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ text: cleanText, userId: currentConversationId })
      });
      if (response.status === 402) {
        showTopupPlansDialog();
        throw new Error("Token tidak cukup.");
      }
      if (!response.ok) throw new Error();
      
      const audioBufferArray = await response.arrayBuffer();
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const decodedBuffer = await audioContext.decodeAudioData(audioBufferArray);
      
      const source = audioContext.createBufferSource();
      source.buffer = decodedBuffer;
      source.connect(audioContext.destination);
      source.onended = () => {
        if (buttonElement) {
          buttonElement.classList.remove('active-speaking');
          const icon = buttonElement.querySelector('ion-icon');
          if (icon) icon.setAttribute('name', 'volume-medium-outline');
        }
      };
      source.start(0);
      await fetchUserBalance();
    } catch (err) {
      console.error(err);
      if (buttonElement) {
        buttonElement.classList.remove('active-speaking');
        const icon = buttonElement.querySelector('ion-icon');
        if (icon) icon.setAttribute('name', 'volume-medium-outline');
      }
    }
  }

  function toggleSpeechOutput(text, buttonElement) {
    const isCurrentlySpeaking = (audioContext && audioContext.state === 'running') || (window.speechSynthesis && window.speechSynthesis.speaking);
    if (isCurrentlySpeaking && buttonElement.classList.contains('active-speaking')) {
      stopAllSpeechSynthesis();
    } else {
      speakWithCloudflareTTS(text, buttonElement);
    }
  }

  // ---------- SPEECH TO TEXT ----------
  function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (micRecordBtn) micRecordBtn.style.display = 'none'; 
      return;
    }

    speechRecognition = new SpeechRecognition();
    speechRecognition.continuous = false; 
    speechRecognition.interimResults = false;
    speechRecognition.lang = 'id-ID'; 

    speechRecognition.onstart = function() {
      isRecording = true;
      if (micRecordBtn) {
        micRecordBtn.classList.add('recording-active');
        const icon = micRecordBtn.querySelector('ion-icon');
        if (icon) icon.setAttribute('name', 'mic-off-circle');
      }
      messageInput.placeholder = "Mendengarkan...";
    };

    speechRecognition.onend = function() {
      isRecording = false;
      if (micRecordBtn) {
        micRecordBtn.classList.remove('recording-active');
        const icon = micRecordBtn.querySelector('ion-icon');
        if (icon) icon.setAttribute('name', 'mic-circle');
      }
      messageInput.placeholder = "Tanyakan sesuatu...";
    };

    speechRecognition.onerror = function() {
      isRecording = false;
    };

    speechRecognition.onresult = function(event) {
      const transcriptResult = event.results[0][0].transcript;
      if (transcriptResult && messageInput) {
        messageInput.value = transcriptResult;
        messageInput.style.height = '60px'; 
        messageInput.focus();
        
        setTimeout(() => {
          sendUserMessage();
        }, 800);
      }
    };
  }

  function toggleSpeechRecording() {
    if (!speechRecognition) {
      showAlert('Pemberitahuan', 'Perekaman suara tidak didukung di browser ini.');
      return;
    }
    if (isRecording) {
      speechRecognition.stop();
    } else {
      stopAllSpeechSynthesis();
      speechRecognition.start();
    }
  }

  // ---------- PROSES DAN KIRIM PESAN KLIEN ----------
  async function readAndFormatFiles() {
    if (attachedFiles.length === 0) return { textPayload: "", imagePayload: null };
    let textPayload = "";
    let imagePayload = null;

    const readPromises = attachedFiles.map(file => {
      return new Promise((resolve) => {
        if (file.isR2) {
          textPayload += `\n[File Premium R2 Terlampir: ${file.name}] Sila analisis dokumen di URL: ${file.url}`;
          resolve({ type: 'r2' });
        } else {
          if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function(e) {
              imagePayload = e.target.result;
              resolve({ type: 'image', name: file.name });
            };
            reader.onerror = () => resolve({ type: 'error' });
            reader.readAsDataURL(file);
          } else {
            const reader = new FileReader();
            reader.onload = function(e) {
              resolve({ type: 'text', content: `\n\n--- ISI BERKAS LAMPIRAN: ${file.name} ---\n\`\`\`\n${e.target.result || ""}\n\`\`\`\n--- AKHIR BERKAS ---` });
            };
            reader.onerror = () => resolve({ type: 'text', content: `\n\n--- ISI BERKAS LAMPIRAN: ${file.name} ---\n[Gagal membaca isi berkas]\n--- AKHIR BERKAS ---` });
            reader.readAsText(file);
          }
        }
      });
    });

    await Promise.all(readPromises);
    return { textPayload, imagePayload };
  }

  async function sendUserMessage() {
    if (isWaitingResponse) {
      await showAlert('Sabar', 'Harap menunggu asisten menyelesaikan respon sebelumnya.');
      return;
    }
    
    let rawText = messageInput.value?.trim();
    let fileContentsText = "";
    let imageBase64Data = null;

    if (attachedFiles.length > 0) {
      try {
        const processed = await readAndFormatFiles();
        fileContentsText = processed.textPayload;
        imageBase64Data = processed.imagePayload;
      } catch (fileError) {
        await showAlert('Error', 'Terjadi kendala saat memuat lampiran.');
        return;
      }
    }

    if (fileContentsText) {
      rawText = rawText ? `${rawText}${fileContentsText}` : `Berikut adalah berkas lampiran:${fileContentsText}`;
    } else if (imageBase64Data) {
      rawText = rawText ? `[MENGIRIM GAMBAR]\n${rawText}` : `[MENGIRIM GAMBAR]\nTolong jelaskan gambar ini.`;
    }

    if (!rawText && !imageBase64Data && attachedFiles.length === 0) {
      return;
    }

    attachedFiles = [];
    renderFilePreviews();

    addMessageToState('user', rawText);
    messageInput.value = '';
    messageInput.style.height = '40px'; 
    renderCurrentChat();

    await executeAIStream(rawText, imageBase64Data);
  }

  function createNewChat() {
    if (isWaitingResponse) {
      showAlert('Sabar', 'Selesaikan proses streaming sebelum membuka obrolan baru.');
      return;
    }
    stopAllSpeechSynthesis();
    const newId = generateId();
    const newConv = { id: newId, title: 'Obrolan Baru', messages: [] };
    conversations.unshift(newConv);
    currentConversationId = newId;
    saveToLocalStorage();
    renderSidebar();
    
    if (messagesContainer) {
      messagesContainer.innerHTML = '';
    }
    
    renderCurrentChat();
    
    if (emptyPlaceholder) {
      emptyPlaceholder.style.setProperty('display', 'flex', 'important');
    }
    
    chatTitleEl.innerText = 'Obrolan Baru';
    if (messageInput) {
      messageInput.value = '';
      messageInput.style.height = '40px';
    }
    
    fetchUserBalance();
    scrollToBottom();
  }

  function switchConversation(convId) {
    if (isWaitingResponse) {
      showAlert('Sabar', 'Selesaikan proses streaming sebelum berpindah riwayat.');
      return;
    }
    stopAllSpeechSynthesis();
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;
    currentConversationId = convId;
    saveToLocalStorage();
    renderSidebar();
    
    if (messagesContainer) {
      messagesContainer.innerHTML = '';
    }
    
    renderCurrentChat();
    
    if (conv.messages.length === 0 && emptyPlaceholder) {
      emptyPlaceholder.style.setProperty('display', 'flex', 'important');
    }
    
    chatTitleEl.innerText = conv.title;
    if (messageInput) {
      messageInput.value = '';
      messageInput.style.height = '40px'; 
    }
    
    fetchUserBalance();
  }

  async function clearCurrentChat() {
    if (isWaitingResponse) {
      showAlert('Pemberitahuan', 'Harap tunggu hingga asisten AI selesai mengetik.');
      return;
    }
    stopAllSpeechSynthesis();
    const conv = conversations.find(c => c.id === currentConversationId);
    if (!conv) return;
    if (conv.messages.length === 0) {
      return;
    }
    const confirmed = await confirmDialog('Sapu Bersih Sesi', `Kosongkan riwayat pesan pada sesi "${conv.title}"?`);
    if (confirmed) {
      conv.messages = [];
      saveToLocalStorage();
      
      if (messagesContainer) {
        messagesContainer.innerHTML = '';
      }
      
      renderCurrentChat();
      
      if (emptyPlaceholder) {
        emptyPlaceholder.style.setProperty('display', 'flex', 'important');
      }
      
      updateConversationTitle(currentConversationId);
      chatTitleEl.innerText = conv.title;
    }
  }

  async function scrollToBottom() {
    await new Promise(r => setTimeout(r, 60));
    const contentEl = document.querySelector('#chat-content');
    if (contentEl && contentEl.getScrollElement) {
      const scrollEl = await contentEl.getScrollElement();
      if (scrollEl) {
        scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
      }
    }
  }

  async function initScrollListener() {
    const chatContent = document.querySelector('#chat-content');
    if (!chatContent) return;

    const scrollEl = await chatContent.getScrollElement();
    if (!scrollEl) return;

    chatContent.addEventListener('ionScroll', (ev) => {
      const scrollTop = ev.detail.scrollTop;
      const scrollHeight = scrollEl.scrollHeight;
      const clientHeight = scrollEl.clientHeight;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

      if (distanceFromBottom > 280) {
        scrollTopFab.style.display = 'flex';
      } else {
        scrollTopFab.style.display = 'none';
      }
    });
  }

  function setupModernInputEvents() {
    messageInput.addEventListener('focus', () => {
      messageInput.style.height = '80px';
    });

    messageInput.addEventListener('blur', () => {
      if (!messageInput.value.trim()) {
        messageInput.style.height = '40px';
      }
    });

    messageInput.addEventListener('input', () => {
      if (messageInput.value.trim() === '') {
        messageInput.style.height = '40px';
      } else {
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
      }
    });

    attachFileBtn.addEventListener('click', (e) => {
      e.preventDefault();
      hiddenFileInput.click();
    });

    hiddenFileInput.addEventListener('change', async function(e) {
      const files = Array.from(e.target.files);
      if (files.length === 0) return;

      for (const file of files) {
        if (currentUser && sessionToken) {
          const loadingAlert = document.createElement('ion-loading');
          loadingAlert.message = `Mengunggah ${escapeHtml(file.name)} ke Cloud Storage...`;
          document.body.appendChild(loadingAlert);
          await loadingAlert.present();

          try {
            const r2Data = await uploadFileToR2(file);
            if (r2Data.success) {
              injectR2FileIntoAttachment(r2Data.url, r2Data.fileName, file.type);
            }
          } catch (uploadErr) {
            showAlert("Upload Gagal", uploadErr.message);
          } finally {
            loadingAlert.dismiss().then(() => loadingAlert.remove());
          }
        } else {
          const isExist = attachedFiles.some(f => f.name === file.name && f.size === file.size);
          if (!isExist) {
            if (file.size > 4 * 1024 * 1024) {
              showAlert("Batas Tamu", "Ukuran lampiran tamu dibatasi maks 4MB. Masuk dengan GitHub untuk membuka penyimpanan cloud Storage tanpa batas.");
              continue;
            }
            attachedFiles.push(file);
          }
        }
      }
      
      renderFilePreviews();
      this.value = '';
      messageInput.focus();
    });

    document.addEventListener('click', function(e) {
      const card = e.target.closest('.suggestion-card');
      if (card) {
        const promptText = card.getAttribute('data-prompt');
        if (promptText && messageInput) {
          messageInput.value = promptText;
          messageInput.style.height = '80px';
          messageInput.focus();
        }
      }
    });

    if (micRecordBtn) {
      micRecordBtn.addEventListener('click', () => {
        toggleSpeechRecording();
      });
    }

    if (autoSpeakToggle) {
      autoSpeakToggle.addEventListener('click', () => {
        isAutoSpeakActive = !isAutoSpeakActive;
        const icon = autoSpeakToggle.querySelector('ion-icon');
        
        if (isAutoSpeakActive) {
          autoSpeakToggle.classList.add('speaking-active');
          if (icon) icon.setAttribute('name', 'volume-high-outline');
          showAlert('Suara Aktif', 'MIA akan membacakan otomatis setiap jawaban dari balasan AI.');
        } else {
          autoSpeakToggle.classList.remove('speaking-active');
          if (icon) icon.setAttribute('name', 'volume-mute-outline');
          stopAllSpeechSynthesis();
        }
      });
    }
  }

  function renderFilePreviews() {
    if (!attachmentPreviewContainer) return;
    attachmentPreviewContainer.innerHTML = '';
    
    if (attachedFiles.length === 0) {
      attachmentPreviewContainer.style.display = 'none';
      return;
    }

    attachmentPreviewContainer.style.display = 'flex';
    attachedFiles.forEach((file, index) => {
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      
      const isImg = file.type?.startsWith('image/');
      const iconName = isImg ? 'image-outline' : (file.isR2 ? 'cloud-done-outline' : 'document-attach-outline');
      const colorStyle = isImg ? 'color: #10b981;' : (file.isR2 ? 'color: #6366f1;' : '');

      chip.innerHTML = `
        <ion-icon name="${iconName}" style="${colorStyle}"></ion-icon>
        <span style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(file.name)}</span>
        <button type="button" class="remove-file-btn" data-index="${index}">
          <ion-icon name="close-circle"></ion-icon>
        </button>
      `;

      chip.querySelector('.remove-file-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        attachedFiles.splice(index, 1);
        renderFilePreviews();
      });

      attachmentPreviewContainer.appendChild(chip);
    });
  }

  // ---------- INISIALISASI UTAMA ----------
  async function init() {
    if (window.location.hash.includes('token=')) {
      const tokenMatch = window.location.hash.match(/token=([^&]+)/);
      if (tokenMatch) {
        sessionToken = tokenMatch[1];
        localStorage.setItem('mia_session_token', sessionToken);
        window.location.hash = '';
      }
    }

    loadFromLocalStorage();
    
    messagesContainer = document.getElementById('messages-container');
    emptyPlaceholder = document.getElementById('empty-chat-placeholder');
    conversationListEl = document.getElementById('conversation-list');
    messageInput = document.getElementById('message-input');
    sendBtn = document.getElementById('send-message-btn');
    scrollTopFab = document.getElementById('scroll-top-fab');
    chatTitleEl = document.getElementById('chat-title');
    
    attachFileBtn = document.getElementById('attach-file-btn');
    hiddenFileInput = document.getElementById('hidden-file-input');
    attachmentPreviewContainer = document.getElementById('attachment-preview-container');

    micRecordBtn = document.getElementById('mic-record-btn');
    autoSpeakToggle = document.getElementById('auto-speak-toggle');
    tokenBalanceDisplay = document.getElementById('token-balance-display');
    
    // Modal References
    historyModal = document.getElementById('history-modal');
    historyModalContent = document.getElementById('history-modal-content');
    closeHistoryModalBtn = document.getElementById('close-history-modal-btn');

    r2ExplorerModal = document.getElementById('r2-explorer-modal');
    r2FilesGrid = document.getElementById('r2-files-grid');
    closeR2ModalBtn = document.getElementById('close-r2-modal-btn');
    openR2ExplorerBtn = document.getElementById('open-r2-explorer-btn');
    r2DirectUploadBtn = document.getElementById('r2-direct-upload-btn');
    r2DirectFileInput = document.getElementById('r2-direct-file-input');

    if (sessionToken) {
      await fetchUserProfile();
    } else {
      showLoginButton();
    }

    renderSidebar();
    renderCurrentChat();
    
    const curConv = conversations.find(c => c.id === currentConversationId);
    if (curConv) chatTitleEl.innerText = curConv.title;

    sendBtn.addEventListener('click', () => sendUserMessage());
    
    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendUserMessage();
      }
    });

    document.getElementById('new-chat-btn')?.addEventListener('click', () => createNewChat());
    document.getElementById('clear-current-chat-btn')?.addEventListener('click', () => clearCurrentChat());
    
    const scrollBtn = document.getElementById('scroll-top-btn');
    if (scrollBtn) {
      scrollBtn.addEventListener('click', () => scrollToBottom());
    }

    if (messagesContainer) {
      messagesContainer.addEventListener('click', (e) => {
        const speakBtn = e.target.closest('.ai-speak-btn');
        if (speakBtn) {
          e.preventDefault();
          e.stopPropagation();
          const textToSpeak = speakBtn.getAttribute('data-text');
          toggleSpeechOutput(textToSpeak, speakBtn);
        }
      });
    }

    document.getElementById('open-history-btn')?.addEventListener('click', () => {
      loadUserPurchaseHistory();
    });
    
    closeHistoryModalBtn?.addEventListener('click', () => {
      historyModal.dismiss();
    });

    // SISTEM FILTER PUSTAKA MEDIA R2 YANG WATER-TIGHT
    openR2ExplorerBtn?.addEventListener('click', async () => {
      // 1. Cek jika Pengguna Tamu (Belum login)
      if (!currentUser || !sessionToken) {
        showAlert(
          'Akses Terbatas 🔒', 
          'Fitur Cloud Storage hanya tersedia bagi pengguna terdaftar. Silakan masuk (login) dengan akun GitHub Anda.'
        );
        return;
      }

      // 2. Cek jika Saldo Token Pengguna Habis (0 Token)
      if (userTokenBalance <= 0) {
        showAlert(
          'Saldo Token Habis 🪙', 
          'Saldo koin token Anda saat ini adalah 0. Silakan lakukan top-up paket koin terlebih dahulu agar dapat mengelola pustaka media R2.'
        );
        return;
      }

      // 3. Muat pustaka file R2, jika gagal/di-reject backend (misal: user free tanpa riwayat beli), modal tidak akan dibuka
      const loadSuccess = await loadR2FilesLibrary();
      if (loadSuccess) {
        r2ExplorerModal.present();
      }
    });

    closeR2ModalBtn?.addEventListener('click', () => {
      r2ExplorerModal.dismiss();
    });

    r2DirectUploadBtn?.addEventListener('click', () => {
      r2DirectFileInput.click();
    });

    r2DirectFileInput?.addEventListener('change', async function(e) {
      const file = e.target.files[0];
      if (!file) return;

      const loadingAlert = document.createElement('ion-loading');
      loadingAlert.message = `Mengunggah berkas cloud baru...`;
      document.body.appendChild(loadingAlert);
      await loadingAlert.present();

      try {
        await uploadFileToR2(file);
        await loadR2FilesLibrary();
      } catch (err) {
        showAlert("Upload Gagal", err.message);
      } finally {
        loadingAlert.dismiss().then(() => loadingAlert.remove());
        this.value = '';
      }
    });

    initSpeechRecognition();
    setupModernInputEvents();
    initScrollListener();

    await fetchUserBalance();

    loadMidtransSnapLibrary().catch(err => console.warn('Pemuatan library Midtrans Snap tertunda:', err.message));

    // Periksa apakah ada pemicu URL redirect pembayaran sukses untuk dikirim otomatis
    checkPaymentRedirectTrigger();

    setTimeout(() => {
      scrollToBottom();
    }, 300);
  }

  window.addEventListener('DOMContentLoaded', () => {
    init();
  });
})();

// Pembatasan Sederhana Lisensi
document.addEventListener('DOMContentLoaded', function () {
    const dev = 'aHR0cHM6Ly9taWEtbWlhYXcuZ2l0aHViLmlv';
    const myLicense = atob(dev);
    const metaLicenseEl = document.querySelector('meta[name="license"]');
    const metaLicense = metaLicenseEl ? metaLicenseEl.getAttribute('content') : null;

    let second = 10;
    if (metaLicense && metaLicense === myLicense) return;

    const lockStyleAndHtml = `
        <style>
            body { background: #000000b3 !important; overflow: hidden !important; }
            #peringatan { z-index: 99999999999999; position: fixed; top: 0; right: 0; left: 0; height: 100%; padding: 16% 0; text-align: center; background: #000000f2; color: #fff; font-family: sans-serif; }
            #peringatan h4 { margin-bottom: 35px; font-size: 32px; }
            #peringatan p { margin-top: 20px; font-size: 18px; letter-spacing: 2px; line-height: 30px; }
            #aktivasi { font-size: 50px; display: block; margin-top: 20px; color: #ff4444; }
            @media only screen and (max-width:680px) { #peringatan { padding: 60% 0; } #peringatan h4 { font-size: 20px !important; } }
        </style>
        <div id="peringatan">
            <h4>🔒︄ Template is Locked Up</h4>
            <p>Meta license template tidak valid.<br>Mohon jangan menghapus / merubah license.</p>
            <span id="aktivasi">${second}</span>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', lockStyleAndHtml);
    const aktivasiEl = document.getElementById('aktivasi');
    const lockInterval = setInterval(function () {
        second--;
        if (aktivasiEl) aktivasiEl.textContent = second;
        if (second <= 0) {
            clearInterval(lockInterval);
            window.location.href = "https://mia-miaaw.github.io/blog/";
        }
    }, 1000);
});
