(function(){
  // ---------- GLOBAL CONFIG ----------
  const API_BASE_URL = 'https://ai-coding-worker.androidbutut.workers.dev';

  // ---------- GLOBAL STATE ----------
  let conversations = [];        // array of { id, title, messages: [{id, text, sender, timestamp}] }
  let currentConversationId = null;
  let isWaitingResponse = false; // mencegah double-submission
  let currentTypingIndicatorElement = null;
  let attachedFiles = [];        // Menyimpan objek file terpilih secara lokal

  // DOM references
  let messagesContainer;
  let emptyPlaceholder;
  let conversationListEl;
  let chatContentEl;
  let messageInput;
  let sendBtn;
  let scrollTopFab;
  let chatTitleEl;
  let attachFileBtn;
  let hiddenFileInput;
  let attachmentPreviewContainer;

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

  // Helper clipboard global untuk integrasi tombol copy code
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

  // Event delegation untuk menangani klik tombol salin secara dinamis
  document.addEventListener('click', function(e) {
    const button = e.target.closest('.copy-btn');
    if (button) {
      e.preventDefault();
      const wrapper = button.closest('.code-block-wrapper');
      const codeElement = wrapper ? wrapper.querySelector('pre code') : null;
      if (codeElement) {
        window.copyToClipboard(button, codeElement.innerText);
      }
    }
  });

  function generateId() {
    return Date.now() + '-' + Math.random().toString(36).substr(2, 6);
  }

  // ---------- ION ALERT KOSTUM (Promise-based) ----------
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

  // ---------- STORAGE MANAGEMENT ----------
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
      console.warn(e);
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
      let newTitle = firstUserMsg.text.length > 30 ? firstUserMsg.text.substring(0, 27) + '...' : firstUserMsg.text;
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

  // ---------- RENDER SIDEBAR ----------
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
        <ion-item class="conversation-item ${activeClass}" data-conv-id="${conv.id}" button detail="false">
          <ion-label class="ion-text-wrap">
            <h3 style="margin: 0; font-size: 0.95rem; font-weight: ${isActive ? '600' : '400'}">${escapeHtml(conv.title)}</h3>
            <p style="font-size: 0.75rem; color: #9ca3af; margin-top: 4px;">${conv.messages.length} pesan</p>
          </ion-label>
          <ion-buttons slot="end">
            <ion-button class="delete-conv-btn" fill="clear" color="danger" data-conv-delete="${conv.id}">
              <ion-icon slot="icon-only" name="trash-outline" style="font-size: 1.1rem;"></ion-icon>
            </ion-button>
          </ion-buttons>
        </ion-item>
      `;
    });
    conversationListEl.innerHTML = html;

    // Pasang Event Listeners
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

  // ---------- RENDER CHAT FLAT (GEMINI STYLE FIXED FLEXBOX) ----------
  function renderCurrentChat() {
    if (!messagesContainer) return;
    const currentConv = conversations.find(c => c.id === currentConversationId);
    if (!currentConv) return;

    messagesContainer.innerHTML = '';
    const messages = currentConv.messages;
    if (messages.length === 0) {
      emptyPlaceholder.style.display = 'flex';
    } else {
      emptyPlaceholder.style.display = 'none';
      messages.forEach(msg => {
        appendMessageToDom(msg.sender, msg.text, false);
      });
    }

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

      // 1. Avatar Bulat Singkat
      const avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      avatar.innerText = sender === 'user' ? 'U' : 'AI';
      messageDiv.appendChild(avatar);

      // 2. Kontainer Badan Utama (untuk penanganan flexbox alignment)
      const bodyContainer = document.createElement('div');
      bodyContainer.className = 'message-body-container';

      const body = document.createElement('div');
      body.className = 'message-body';

      if (sender === 'user') {
        body.innerText = text; // User tidak perlu render HTML/Markdown
      } else {
        // Render Markdown & Sanitasi Aman untuk AI
        body.classList.add('markdown-content');
        const rawHtml = marked.parse(text);
        body.innerHTML = DOMPurify.sanitize(rawHtml);
      }

      bodyContainer.appendChild(body);
      messageDiv.appendChild(bodyContainer);

      // Selalu pastikan ditaruh sebelum typing indicator jika ada
      const indicator = document.getElementById('live-typing-indicator');
      if (indicator) {
        messagesContainer.insertBefore(messageDiv, indicator);
      } else {
        messagesContainer.appendChild(messageDiv);
      }
    } else {
      // Melanjutkan data stream chunk yang masuk ke dalam kontainer
      const body = messageDiv.querySelector('.message-body');
      if (body) {
        const rawHtml = marked.parse(text);
        body.innerHTML = DOMPurify.sanitize(rawHtml);
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

  // ---------- INTEGRASI STREAMING SSE REAL-TIME ----------
  async function executeAIStream(userMessage) {
    if (isWaitingResponse) return;
    isWaitingResponse = true;

    emptyPlaceholder.style.display = 'none';
    showTypingIndicatorOnly();

    const conv = conversations.find(c => c.id === currentConversationId);
    if (!conv) return;

    // Ambil riwayat chat lengkap untuk dikirim ke Worker
    const formattedMessages = conv.messages.map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text
    }));

    let responseTextAccumulator = '';

    try {
      const response = await fetch(`${API_BASE_URL}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': window.location.origin || 'http://localhost:3000'
        },
        body: JSON.stringify({
          sessionId: currentConversationId,
          messages: formattedMessages
        })
      });

      removeTypingIndicator();

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      // Loop pembacaan byte stream
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
            // Update DOM real-time ke user
            appendMessageToDom('ai', responseTextAccumulator, true);
            scrollToBottom();
          }
        }
      }

      // Bersihkan penanda streaming node di DOM
      const streamingNode = document.getElementById('streaming-message-node');
      if (streamingNode) {
        streamingNode.removeAttribute('id');
      }

      // Masukkan jawaban lengkap final ke array State obrolan
      if (responseTextAccumulator.trim()) {
        addMessageToState('ai', responseTextAccumulator.trim());
      }

    } catch (error) {
      console.error(error);
      removeTypingIndicator();

      const streamingNode = document.getElementById('streaming-message-node');
      if (streamingNode) streamingNode.remove();

      await showAlert('Gagal Terhubung', error.message || 'Terjadi gangguan saat memproses balasan AI.');
    } finally {
      isWaitingResponse = false;
      messageInput.value = '';
      messageInput.style.height = '40px'; // Kembalikan tinggi textarea ke default
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

  async function sendUserMessage() {
    if (isWaitingResponse) {
      await showAlert('Tunggu', 'Harap tunggu respons AI saat ini selesai terlebih dahulu.');
      return;
    }
    let rawText = messageInput.value?.trim();
    
    // Gabungkan lampiran berkas jika ada berkas terlampir
    if (attachedFiles.length > 0) {
      const fileNames = attachedFiles.map(f => `[Lampiran Berkas: ${f.name}]`).join(' ');
      rawText = rawText ? `${rawText}\n\n${fileNames}` : `Mengirim berkas terlampir: ${fileNames}`;
    }

    if (!rawText && attachedFiles.length === 0) {
      await showAlert('Pesan kosong', 'Tolong ketikkan isi pesan Anda.');
      return;
    }

    // Reset antrean berkas terlampir
    attachedFiles = [];
    renderFilePreviews();

    addMessageToState('user', rawText);
    messageInput.value = '';
    messageInput.style.height = '40px'; // Reset tinggi input ke satu baris
    renderCurrentChat();

    await executeAIStream(rawText);
  }

  function createNewChat() {
    if (isWaitingResponse) {
      showAlert('Tunggu', 'Selesaikan proses streaming sebelum membuat percakapan baru.');
      return;
    }
    const newId = generateId();
    const newConv = { id: newId, title: 'Obrolan Baru', messages: [] };
    conversations.unshift(newConv);
    currentConversationId = newId;
    saveToLocalStorage();
    renderSidebar();
    renderCurrentChat();
    chatTitleEl.innerText = 'Obrolan Baru';
    scrollToBottom();
  }

  function switchConversation(convId) {
    if (isWaitingResponse) {
      showAlert('Tunggu', 'Selesaikan proses streaming sebelum berpindah riwayat.');
      return;
    }
    const conv = conversations.find(c => c.id === convId);
    if (!conv) return;
    currentConversationId = convId;
    saveToLocalStorage();
    renderSidebar();
    renderCurrentChat();
    chatTitleEl.innerText = conv.title;
    messageInput.value = '';
    messageInput.style.height = '40px'; // Setel ulang tinggi textarea
  }

  async function clearCurrentChat() {
    if (isWaitingResponse) {
      showAlert('Tunggu', 'AI sedang merespon, mohon tunggu beberapa saat.');
      return;
    }
    const conv = conversations.find(c => c.id === currentConversationId);
    if (!conv) return;
    if (conv.messages.length === 0) {
      showAlert('Info', 'Sesi percakapan ini memang sudah bersih.');
      return;
    }
    const confirmed = await confirmDialog('Bersihkan Pesan', `Hapus seluruh isi riwayat pesan pada sesi "${conv.title}"?`);
    if (confirmed) {
      conv.messages = [];
      saveToLocalStorage();
      renderCurrentChat();
      updateConversationTitle(currentConversationId);
      chatTitleEl.innerText = conv.title;
    }
  }

  // SCROLL HELPERS
  async function scrollToBottom() {
    await new Promise(r => setTimeout(r, 40));
    const contentEl = document.querySelector('#chat-content');
    if (contentEl && contentEl.getScrollElement) {
      const scrollEl = await contentEl.getScrollElement();
      if (scrollEl) {
        scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
      }
    }
  }

  async function scrollToTop() {
    const contentEl = document.querySelector('#chat-content');
    if (contentEl && contentEl.getScrollElement) {
      const scrollEl = await contentEl.getScrollElement();
      if (scrollEl) {
        scrollEl.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }

  function initScrollListener() {
    const chatContent = document.querySelector('#chat-content');
    if (!chatContent) return;
    chatContent.addEventListener('ionScroll', (ev) => {
      const scrollTop = ev.detail.scrollTop;
      if (scrollTop > 300) {
        scrollTopFab.style.display = 'flex';
      } else {
        scrollTopFab.style.display = 'none';
      }
    });
  }

  // ---------- LOGIKA INPUT MULTI-ROW & LAMPIRAN BERKAS ----------
  function setupModernInputEvents() {
    // 1. Ekspansi Otomatis Textarea ketika Berfokus (Focus) ke 100px (~3 baris)
    messageInput.addEventListener('focus', () => {
      messageInput.style.height = '100px';
    });

    // 2. Mengempiskan kembali jika tidak berfokus (Blur) dan kosong (1 baris)
    messageInput.addEventListener('blur', () => {
      if (!messageInput.value.trim()) {
        messageInput.style.height = '40px';
      }
    });

    // 3. Menyesuaikan tinggi dinamis sewaktu mengetik
    messageInput.addEventListener('input', () => {
      if (messageInput.value.trim() === '') {
        messageInput.style.height = '40px';
      } else {
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
      }
    });

    // 4. Trigger Tombol Unggah Berkas
    attachFileBtn.addEventListener('click', () => {
      hiddenFileInput.click();
    });

    // 5. Tangkap Berkas Terpilih
    hiddenFileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      files.forEach(file => {
        if (!attachedFiles.some(f => f.name === file.name)) {
          attachedFiles.push(file);
        }
      });
      renderFilePreviews();
      
      // Fokuskan kembali ke textarea setelah memilih berkas agar meluas
      messageInput.focus();
    });
  }

  // Merender cip visual untuk berkas yang siap dikirim
  function renderFilePreviews() {
    attachmentPreviewContainer.innerHTML = '';
    attachedFiles.forEach((file, index) => {
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      chip.innerHTML = `
        <ion-icon name="document-attach-outline"></ion-icon>
        <span style="max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(file.name)}</span>
        <button type="button" data-index="${index}">
          <ion-icon name="close-circle"></ion-icon>
        </button>
      `;

      // Hapus lampiran
      chip.querySelector('button').addEventListener('click', (e) => {
        e.stopPropagation();
        attachedFiles.splice(index, 1);
        renderFilePreviews();
      });

      attachmentPreviewContainer.appendChild(chip);
    });
  }

  // ---------- INITIALIZE APP ----------
  function init() {
    loadFromLocalStorage();
    messagesContainer = document.getElementById('messages-container');
    emptyPlaceholder = document.getElementById('empty-chat-placeholder');
    conversationListEl = document.getElementById('conversation-list');
    messageInput = document.getElementById('message-input');
    sendBtn = document.getElementById('send-message-btn');
    scrollTopFab = document.getElementById('scroll-top-fab');
    chatTitleEl = document.getElementById('chat-title');
    
    // Inisialisasi Elemen Attachment Baru
    attachFileBtn = document.getElementById('attach-file-btn');
    hiddenFileInput = document.getElementById('hidden-file-input');
    attachmentPreviewContainer = document.getElementById('attachment-preview-container');

    renderSidebar();
    renderCurrentChat();
    const curConv = conversations.find(c => c.id === currentConversationId);
    if (curConv) chatTitleEl.innerText = curConv.title;

    sendBtn.addEventListener('click', () => sendUserMessage());
    
    // Penanganan Tombol Keyboard (Shift+Enter untuk baris baru, Enter biasa kirim)
    messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendUserMessage();
      }
    });

    document.getElementById('new-chat-btn')?.addEventListener('click', () => createNewChat());
    document.getElementById('clear-current-chat-btn')?.addEventListener('click', () => clearCurrentChat());
    document.getElementById('scroll-top-btn')?.addEventListener('click', () => scrollToTop());

    // Jalankan listener event kustom input baru
    setupModernInputEvents();
    initScrollListener();

    setTimeout(() => {
      scrollToBottom();
    }, 300);
  }

  window.addEventListener('DOMContentLoaded', () => {
    init();
  });
})();